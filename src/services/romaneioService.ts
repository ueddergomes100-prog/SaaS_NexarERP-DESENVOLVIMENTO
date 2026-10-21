import {
  collection,
  doc,
  documentId,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { fetchComTimeout, mensagemDeFalhaDeRede } from '../utils/fetchComTimeout';
import { reserveTenantSequence } from '../utils/firestoreAtomic';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { addDaysToDateInput } from '../utils/dateTime';
import { LOTE_IN_POR_CAMPO, LOTE_IN_POR_ID } from '../utils/firestoreLimites';
import { STATUS_PRE_VENDA } from '../utils/preVendaDomain';
import { erroDePreVendaParaLiberar, pedidosSemFaturar } from '../utils/rotaPreVendaDomain';
import {
  acertoParaGravar,
  camposEditaveisDaRota,
  caminhosDoRegistro,
  erroDoAcerto,
  erroDoPedidoParaRomaneio,
  erroDoRegistroDeEntrega,
  erroParaLiberar,
  montarEntregaDoPedido,
  registroParaGravar,
  romaneioDoDocumento,
  tituloDoRomaneio,
  type AlteracaoDoRomaneio,
  type DadosDoRegistro,
  type EntregaRomaneio,
  type PedidoParaRomaneio,
  type Romaneio,
} from '../utils/romaneioDomain';

/**
 * Acesso ao Firestore do ROMANEIO DE ENTREGA (2026-10-01). A regra mora em
 * romaneioDomain.ts; aqui so' le e grava.
 *
 * TRAVA POR PEDIDO: `romaneio_pedidos/{pedidoId}` diz em que rota o pedido
 * esta. Conferida DENTRO da transacao -- duas pessoas montando rota ao mesmo
 * tempo nao conseguem colocar o mesmo pedido nas duas. Nunca e' apagada:
 * ao sair da rota (ou nao ser entregue) vira `liberado`.
 */

export const COLECAO_ROMANEIOS = 'romaneios';
const COLECAO_TRAVAS = 'romaneio_pedidos';
// Por campo (data, pedidoId) o Firestore aceita 30; POR ID so' 10 -- acima de ~17
// ids as regras passam do limite e a busca voltava "sem permissao" (15/10/2026,
// ver firestoreLimites.ts).
const LOTE_IN = LOTE_IN_POR_CAMPO;

type SituacaoTrava = 'em_romaneio' | 'entregue' | 'liberado';

const pedacos = <T>(lista: T[], tamanho = LOTE_IN): T[][] => {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
};

/** Todas as datas AAAA-MM-DD de `de` a `ate` (inclusive). */
const datasDoPeriodo = (de: string, ate: string): string[] => {
  const datas: string[] = [];
  let atual = de;
  while (atual && atual <= ate && datas.length < 93) {
    datas.push(atual);
    atual = addDaysToDateInput(atual, 1);
  }
  return datas;
};

export interface PedidoDisponivel extends EntregaRomaneio {
  /** Rota onde o pedido ja' esta (so' para avisar); vazio = livre. */
  emOutraRota: string;
  /** Pre-venda ainda nao faturada (so' aparece com a configuracao "rota na pre-venda" ligada). */
  preVenda: boolean;
}

/**
 * Pedidos FATURADOS no periodo (pela data da venda), com o cliente e a nota de
 * cada um, marcando os que ja' estao em outra rota. `romaneioId` = a rota que
 * esta sendo editada (os pedidos dela nao contam como "em outra rota").
 */
export const carregarPedidosParaRomaneio = async (
  tenantId: string,
  de: string,
  ate: string,
  romaneioId?: string,
  aceitaPreVenda = false,
): Promise<PedidoDisponivel[]> => {
  const datas = datasDoPeriodo(de, ate);
  if (datas.length === 0) return [];

  const pedidos: PedidoParaRomaneio[] = [];
  for (const lote of pedacos(datas)) {
    const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('dataVenda', 'in', lote)));
    snap.forEach((d) => {
      const dados = { id: d.id, ...d.data() } as PedidoParaRomaneio;
      if (!erroDoPedidoParaRomaneio(dados, aceitaPreVenda)) pedidos.push(dados);
    });
  }
  if (pedidos.length === 0) return [];

  const ids = pedidos.map((p) => p.id);
  const travas = new Map<string, { romaneioId: string; situacao: SituacaoTrava; titulo: string }>();
  const clientes = new Map<string, Record<string, unknown>>();
  const notas = new Map<string, { numero: unknown; tipo: string }>();

  for (const lote of pedacos(ids, LOTE_IN_POR_ID)) {
    const snap = await getDocs(query(collection(db, COLECAO_TRAVAS), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.forEach((d) => {
      const t = d.data();
      travas.set(d.id, { romaneioId: String(t.romaneioId || ''), situacao: t.situacao as SituacaoTrava, titulo: String(t.romaneioTitulo || 'outra rota') });
    });
  }
  for (const lote of pedacos(ids)) {
    const snapNotas = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('pedidoId', 'in', lote)));
    snapNotas.forEach((d) => {
      const n = d.data();
      if (n.status !== 'authorized' || !n.number) return;
      const atual = notas.get(String(n.pedidoId));
      // NF-e vale mais que cupom: e' ela que acompanha a mercadoria.
      if (!atual || (n.tipo === 'NF-e' && atual.tipo !== 'NF-e')) notas.set(String(n.pedidoId), { numero: n.number, tipo: String(n.tipo || '') });
    });
  }

  const clienteIds = [...new Set(pedidos.map((p) => String(p.clienteId || '')).filter(Boolean))];
  for (const lote of pedacos(clienteIds, LOTE_IN_POR_ID)) {
    const snap = await getDocs(query(collection(db, 'clientes'), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.forEach((d) => clientes.set(d.id, d.data()));
  }

  return pedidos
    .map((p) => {
      const trava = travas.get(p.id);
      const ocupado = trava && trava.situacao !== 'liberado' && trava.romaneioId !== romaneioId;
      return {
        ...montarEntregaDoPedido(p, clientes.get(String(p.clienteId || '')) || null, notas.get(p.id) || null),
        emOutraRota: ocupado ? (trava!.situacao === 'entregue' ? `Já entregue na ${trava!.titulo}` : `Já está na ${trava!.titulo}`) : '',
        preVenda: String(p.status ?? '').trim() === STATUS_PRE_VENDA,
      };
    })
    .sort((a, b) => b.dataVenda.localeCompare(a.dataVenda) || b.numeroPedido.localeCompare(a.numeroPedido, 'pt-BR', { numeric: true }));
};

/** Romaneio lido do Firestore (regra no dominio: o servidor le do mesmo jeito). */
export const lerRomaneio = romaneioDoDocumento;

/** Campos que a tela edita, sem nada `undefined` (o Firestore recusa). */
const camposDaRota = camposEditaveisDaRota;

const travaRef = (pedidoId: string) => doc(db, COLECAO_TRAVAS, pedidoId);

/**
 * Cria ou regrava um romaneio EM MONTAGEM. Trava os pedidos que entraram e
 * libera os que sairam, tudo na mesma transacao. Devolve o id.
 */
export const salvarRomaneioEmMontagem = async (args: {
  tenantId: string;
  uid: string;
  id?: string;
  romaneio: Romaneio;
}): Promise<{ id: string; numero: number }> => {
  const { tenantId, uid, romaneio } = args;
  const ref: DocumentReference = args.id ? doc(db, COLECAO_ROMANEIOS, args.id) : doc(collection(db, COLECAO_ROMANEIOS));

  return runTransaction(db, async (transaction) => {
    let numero = romaneio.numero;
    let anteriores: string[] = [];
    if (args.id) {
      const snap = await transaction.get(ref);
      if (!snap.exists() || snap.data().tenantId !== tenantId) throw new Error('Este romaneio não existe mais. Atualize a página.');
      const atual = lerRomaneio(snap.data());
      if (atual.status !== 'montagem') throw new Error(`Esta rota já está "${atual.status === 'em_rota' ? 'em rota' : atual.status}" e não pode mais ter pedidos trocados.`);
      numero = atual.numero;
      anteriores = atual.entregas.map((e) => e.pedidoId);
    }

    const novos = romaneio.entregas.map((e) => e.pedidoId);
    const entraram = novos.filter((id) => !anteriores.includes(id));
    const sairam = anteriores.filter((id) => !novos.includes(id));

    const travas = await Promise.all(entraram.map((id) => transaction.get(travaRef(id))));
    travas.forEach((snap, i) => {
      if (!snap.exists()) return;
      const t = snap.data();
      if (t.situacao !== 'liberado' && t.romaneioId !== ref.id) {
        const entrega = romaneio.entregas.find((e) => e.pedidoId === entraram[i]);
        throw new Error(`O pedido #${entrega?.numeroPedido || '?'} já está na ${t.romaneioTitulo || 'outra rota'}. Tire-o de lá antes, ou deixe-o fora desta rota.`);
      }
    });

    if (!args.id) numero = await reserveTenantSequence(transaction, db, tenantId, 'romaneios', 0);
    const titulo = tituloDoRomaneio(numero, romaneio.nome);
    const agora = serverTimestamp();

    entraram.forEach((pedidoId) => {
      const entrega = romaneio.entregas.find((e) => e.pedidoId === pedidoId)!;
      transaction.set(travaRef(pedidoId), {
        tenantId,
        romaneioId: ref.id,
        romaneioTitulo: titulo,
        pedidoNumero: entrega.numeroPedido,
        situacao: 'em_romaneio' as SituacaoTrava,
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(uid, agora, `Pedido colocado na ${titulo}`),
      });
    });
    sairam.forEach((pedidoId) => {
      transaction.set(travaRef(pedidoId), {
        tenantId, situacao: 'liberado' as SituacaoTrava, updatedAt: agora,
        ...buildDocumentUpdateMetadata(uid, agora, `Pedido tirado da ${titulo}`),
      }, { merge: true });
    });

    const dados = {
      ...camposDaRota(romaneio),
      entregas: romaneio.entregas,
      pedidoIds: novos,
      tenantId,
      updatedAt: agora,
    };
    if (args.id) {
      transaction.update(ref, { ...dados, ...buildDocumentUpdateMetadata(uid, agora, 'Romaneio alterado') });
    } else {
      transaction.set(ref, {
        ...dados,
        numero,
        status: 'montagem',
        kmChegada: null,
        horarioChegada: '',
        acerto: [],
        observacaoAcerto: '',
        createdAt: agora,
        ...buildDocumentMetadata(uid, agora),
      });
    }
    return { id: ref.id, numero };
  });
};

const lerNaTransacao = async (transaction: Parameters<Parameters<typeof runTransaction>[1]>[0], tenantId: string, id: string) => {
  const ref = doc(db, COLECAO_ROMANEIOS, id);
  const snap = await transaction.get(ref);
  if (!snap.exists() || snap.data().tenantId !== tenantId) throw new Error('Este romaneio não existe mais. Atualize a página.');
  return { ref, romaneio: lerRomaneio(snap.data()) };
};

/**
 * Situacao atual de cada pedido (por id). Pra tela marcar o que ainda e'
 * pre-venda na rota em montagem (rota na pre-venda, 21/10/2026).
 */
export const statusDosPedidos = async (tenantId: string, pedidoIds: string[]): Promise<Record<string, string>> => {
  const saida: Record<string, string> = {};
  for (const lote of pedacos([...new Set(pedidoIds)], LOTE_IN_POR_ID)) {
    const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.forEach((d) => { saida[d.id] = String(d.data().status ?? ''); });
  }
  return saida;
};

/** Libera a rota pro motorista: a lista de pedidos fica fechada. */
export const liberarRomaneio = async (tenantId: string, uid: string, id: string): Promise<void> => {
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio } = await lerNaTransacao(transaction, tenantId, id);
    const erro = erroParaLiberar(romaneio);
    if (erro) throw new Error(erro);
    // Rota na pre-venda (21/10/2026): o motorista so' sai com tudo faturado.
    // Le a situacao de cada pedido AGORA, dentro da transacao (a pre-venda
    // pode ter sido faturada depois que a tela abriu).
    const snaps = await Promise.all(romaneio.entregas.map((e) => transaction.get(doc(db, 'pedidos_venda', e.pedidoId))));
    const statusPorPedido = Object.fromEntries(snaps.map((s, i) => [romaneio.entregas[i].pedidoId, s.exists() ? s.data().status : '']));
    const erroPreVenda = erroDePreVendaParaLiberar(pedidosSemFaturar(romaneio.entregas, statusPorPedido));
    if (erroPreVenda) throw new Error(erroPreVenda);
    transaction.update(ref, {
      status: 'em_rota',
      liberadoEm: serverTimestamp(),
      liberadoPor: uid,
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Rota liberada para entrega'),
    });
  });
};

/** Dados que ainda mudam com a rota na rua: KM, horarios, observacao e o acerto em andamento. */
export const salvarDadosEmRota = async (tenantId: string, uid: string, id: string, romaneio: Romaneio): Promise<void> => {
  const erroAcerto = erroDoAcerto(romaneio.acerto);
  if (erroAcerto) throw new Error(erroAcerto);
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio: atual } = await lerNaTransacao(transaction, tenantId, id);
    if (atual.status !== 'em_rota') throw new Error('Esta rota não está mais em andamento. Atualize a página.');
    transaction.update(ref, {
      ...camposDaRota(romaneio),
      kmChegada: romaneio.kmChegada,
      horarioChegada: romaneio.horarioChegada,
      acerto: acertoParaGravar(romaneio.acerto),
      observacaoAcerto: romaneio.observacaoAcerto.trim(),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Dados da rota alterados'),
    });
  });
};

export type RegistroDeEntrega = DadosDoRegistro;

/** Entregue, nao entregue ou de volta a "falta entregar" -- uma entrega por vez. */
export const registrarEntrega = async (args: {
  tenantId: string;
  uid: string;
  nomeUsuario: string;
  id: string;
  pedidoId: string;
  registro: RegistroDeEntrega;
}): Promise<void> => {
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio } = await lerNaTransacao(transaction, args.tenantId, args.id);
    if (romaneio.status !== 'em_rota') throw new Error('Só dá para registrar entrega numa rota que já saiu e ainda não foi fechada.');
    const indice = romaneio.entregas.findIndex((e) => e.pedidoId === args.pedidoId);
    if (indice < 0) throw new Error('Este pedido não está mais nesta rota. Atualize a página.');
    const atual = romaneio.entregas[indice];
    // A regra da justificativa compara com o valor do pedido que esta' na rota.
    const erro = erroDoRegistroDeEntrega({ ...args.registro, valorTotalCentavos: atual.valorTotalCentavos });
    if (erro) throw new Error(erro);
    // Grava na lista E no mapa `registros` (o app do motorista le e grava no mapa);
    // o canhoto que o app ja' tiver enviado e' preservado.
    const gravado = registroParaGravar(atual, args.registro, { nome: args.nomeUsuario, via: 'sistema', agoraIso: new Date().toISOString() });
    const entregas = romaneio.entregas.map((e, i) => (i !== indice ? e : { ...e, ...gravado }));
    transaction.update(ref, {
      entregas,
      ...caminhosDoRegistro(args.pedidoId, gravado),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(args.uid, serverTimestamp(), `Entrega do pedido #${atual.numeroPedido}: ${args.registro.status}`),
    });
  });
};

// ---------------------------------------------------------------------------
// FECHAR, REABRIR E CANCELAR: PELO SERVIDOR (15/10/2026)
// ---------------------------------------------------------------------------
// Fechar mexe no Financeiro (as despesas da rota acompanham o acerto) e
// reabrir/cancelar rota fechada pede permissao propria: quem grava e' o
// servidor (server/routes/romaneios.routes.js), com log. As firestore.rules
// nao deixam a tela gravar romaneio fechado ou cancelado.

const rawApiUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
const API_URL = rawApiUrl ? rawApiUrl.replace(/\/$/, '') : (import.meta.env.DEV ? 'http://localhost:3001' : '');

const chamarServidor = async <T>(caminho: string, corpo: Record<string, unknown>): Promise<T> => {
  if (!API_URL) throw new Error('Esta operação precisa do servidor da empresa, que não está configurado neste ambiente. Avise o suporte.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  let resposta: Response;
  try {
    resposta = await fetchComTimeout(`${API_URL}/api/romaneios${caminho}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new Error(`${mensagemDeFalhaDeRede(erro)} Atualize a página para ver se a operação foi registrada antes de repetir.`, { cause: erro });
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || 'Não foi possível concluir a operação. Tente de novo.');
  return dados as T;
};

export interface ResultadoDoFechamento {
  despesasLancadas: number;
  contagem: { novas: number; alteradas: number; canceladas: number };
  refechamento: boolean;
  alteracoes: AlteracaoDoRomaneio[];
}

/**
 * Fecha o acerto. Entregue fica preso a esta rota; nao entregue volta a ficar
 * livre. Com `lancarDespesas`, cada despesa do acerto vira um lancamento PAGO
 * em "DESPESAS DE ROTA"; rota que ja' tinha lancamentos (reaberta) faz eles
 * acompanharem o acerto. A BAIXA dos titulos dos clientes continua em Contas a
 * Receber (decisao do dono).
 */
export const fecharRomaneio = async (args: {
  id: string;
  romaneio: Romaneio;
  lancarDespesas: boolean;
}): Promise<ResultadoDoFechamento> => {
  const erroAcerto = erroDoAcerto(args.romaneio.acerto);
  if (erroAcerto) throw new Error(erroAcerto);
  const r = args.romaneio;
  return chamarServidor<ResultadoDoFechamento>('/fechar', {
    id: args.id,
    lancarDespesas: args.lancarDespesas,
    romaneio: {
      ...camposDaRota(r),
      kmChegada: r.kmChegada,
      horarioChegada: r.horarioChegada,
      acerto: acertoParaGravar(r.acerto),
      observacaoAcerto: r.observacaoAcerto.trim(),
    },
  });
};

/** Rota fechada volta inteira para "Em rota" (permissao propria + motivo). */
export const reabrirRomaneio = (id: string, motivo: string) => (
  chamarServidor<{ titulo: string; saem: Array<{ pedidoId: string; numeroPedido: string; outraRota: string }> }>('/reabrir', { id, motivo })
);

/** Cancela a rota. Fechada ou com entrega: desfaz tudo (permissao propria + motivo). */
export const cancelarRomaneio = (id: string, motivo: string) => (
  chamarServidor<{ titulo: string; desfez: boolean; liberados: number; despesasCanceladas: number }>('/cancelar', { id, motivo })
);
