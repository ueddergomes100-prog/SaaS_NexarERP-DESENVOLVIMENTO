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
import { db } from './firebase';
import { reserveTenantSequence } from '../utils/firestoreAtomic';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { addDaysToDateInput } from '../utils/dateTime';
import { CATEGORIA_DESPESA_ROTA, descricaoDaDespesaNoFinanceiro, type DespesaRota } from '../utils/rotaDomain';
import {
  acertoParaGravar,
  erroDoAcerto,
  erroDoPedidoParaRomaneio,
  erroDoRegistroDeEntrega,
  erroParaCancelar,
  erroParaFechar,
  erroParaLiberar,
  montarEntregaDoPedido,
  normalizarEntrega,
  situacaoDoPedidoAoEncerrar,
  tituloDoRomaneio,
  type EntregaRomaneio,
  type LancamentoAcerto,
  type PedidoParaRomaneio,
  type Romaneio,
  type StatusEntrega,
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
const LOTE_IN = 30;

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
): Promise<PedidoDisponivel[]> => {
  const datas = datasDoPeriodo(de, ate);
  if (datas.length === 0) return [];

  const pedidos: PedidoParaRomaneio[] = [];
  for (const lote of pedacos(datas)) {
    const snap = await getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId), where('dataVenda', 'in', lote)));
    snap.forEach((d) => {
      const dados = { id: d.id, ...d.data() } as PedidoParaRomaneio;
      if (!erroDoPedidoParaRomaneio(dados)) pedidos.push(dados);
    });
  }
  if (pedidos.length === 0) return [];

  const ids = pedidos.map((p) => p.id);
  const travas = new Map<string, { romaneioId: string; situacao: SituacaoTrava; titulo: string }>();
  const clientes = new Map<string, Record<string, unknown>>();
  const notas = new Map<string, { numero: unknown; tipo: string }>();

  for (const lote of pedacos(ids)) {
    const snap = await getDocs(query(collection(db, COLECAO_TRAVAS), where('tenantId', '==', tenantId), where(documentId(), 'in', lote)));
    snap.forEach((d) => {
      const t = d.data();
      travas.set(d.id, { romaneioId: String(t.romaneioId || ''), situacao: t.situacao as SituacaoTrava, titulo: String(t.romaneioTitulo || 'outra rota') });
    });
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
  for (const lote of pedacos(clienteIds)) {
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
      };
    })
    .sort((a, b) => b.dataVenda.localeCompare(a.dataVenda) || b.numeroPedido.localeCompare(a.numeroPedido, 'pt-BR', { numeric: true }));
};

/** Romaneio lido do Firestore, com todo campo completo (documento parcial nao quebra a tela). */
export const lerRomaneio = (dados: Record<string, unknown>): Romaneio => ({
  numero: Number(dados.numero) || 0,
  nome: String(dados.nome || ''),
  status: (['montagem', 'em_rota', 'fechado', 'cancelado'].includes(String(dados.status)) ? dados.status : 'montagem') as Romaneio['status'],
  dataSaida: String(dados.dataSaida || ''),
  horarioSaida: String(dados.horarioSaida || ''),
  motoristaId: String(dados.motoristaId || ''),
  motoristaNome: String(dados.motoristaNome || ''),
  veiculoId: String(dados.veiculoId || ''),
  veiculoDescricao: String(dados.veiculoDescricao || ''),
  veiculoPlaca: String(dados.veiculoPlaca || ''),
  kmSaida: Number.isFinite(Number(dados.kmSaida)) && dados.kmSaida !== null && dados.kmSaida !== '' ? Number(dados.kmSaida) : null,
  kmChegada: Number.isFinite(Number(dados.kmChegada)) && dados.kmChegada !== null && dados.kmChegada !== '' ? Number(dados.kmChegada) : null,
  horarioChegada: String(dados.horarioChegada || ''),
  observacao: String(dados.observacao || ''),
  entregas: Array.isArray(dados.entregas) ? (dados.entregas as Array<Partial<EntregaRomaneio> & { pedidoId: string }>).filter((e) => e?.pedidoId).map(normalizarEntrega) : [],
  acerto: Array.isArray(dados.acerto) ? (dados.acerto as LancamentoAcerto[]) : [],
  observacaoAcerto: String(dados.observacaoAcerto || ''),
});

/** Campos que a tela edita, sem nada `undefined` (o Firestore recusa). */
const camposDaRota = (r: Romaneio) => ({
  nome: r.nome.trim().toUpperCase(),
  dataSaida: r.dataSaida,
  horarioSaida: r.horarioSaida,
  motoristaId: r.motoristaId,
  motoristaNome: r.motoristaNome,
  veiculoId: r.veiculoId,
  veiculoDescricao: r.veiculoDescricao,
  veiculoPlaca: r.veiculoPlaca,
  kmSaida: r.kmSaida,
  observacao: r.observacao.trim(),
});

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

/** Libera a rota pro motorista: a lista de pedidos fica fechada. */
export const liberarRomaneio = async (tenantId: string, uid: string, id: string): Promise<void> => {
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio } = await lerNaTransacao(transaction, tenantId, id);
    const erro = erroParaLiberar(romaneio);
    if (erro) throw new Error(erro);
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

export interface RegistroDeEntrega {
  status: StatusEntrega;
  recebedorNome: string;
  recebedorDocumento: string;
  motivo: string;
  recebidoCentavos: number;
  recebidoForma: string;
  observacao: string;
}

/** Entregue, nao entregue ou de volta a "falta entregar" -- uma entrega por vez. */
export const registrarEntrega = async (args: {
  tenantId: string;
  uid: string;
  nomeUsuario: string;
  id: string;
  pedidoId: string;
  registro: RegistroDeEntrega;
}): Promise<void> => {
  const erro = erroDoRegistroDeEntrega(args.registro);
  if (erro) throw new Error(erro);
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio } = await lerNaTransacao(transaction, args.tenantId, args.id);
    if (romaneio.status !== 'em_rota') throw new Error('Só dá para registrar entrega numa rota que já saiu e ainda não foi fechada.');
    const indice = romaneio.entregas.findIndex((e) => e.pedidoId === args.pedidoId);
    if (indice < 0) throw new Error('Este pedido não está mais nesta rota. Atualize a página.');
    const r = args.registro;
    const pendente = r.status === 'pendente';
    const entregas = romaneio.entregas.map((e, i) => (i !== indice ? e : {
      ...e,
      status: r.status,
      recebedorNome: r.status === 'entregue' ? r.recebedorNome.trim().toUpperCase() : '',
      recebedorDocumento: r.status === 'entregue' ? r.recebedorDocumento.trim() : '',
      motivo: r.status === 'nao_entregue' ? r.motivo : '',
      recebidoCentavos: pendente ? 0 : Math.max(0, Math.round(r.recebidoCentavos || 0)),
      recebidoForma: pendente || !(r.recebidoCentavos > 0) ? '' : r.recebidoForma,
      observacao: r.observacao.trim(),
      registradoEm: pendente ? '' : new Date().toISOString(),
      registradoPor: pendente ? '' : args.nomeUsuario,
    }));
    transaction.update(ref, {
      entregas,
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(args.uid, serverTimestamp(), `Entrega do pedido #${romaneio.entregas[indice].numeroPedido}: ${r.status}`),
    });
  });
};

/**
 * Fecha o acerto. Entregue fica preso a esta rota; nao entregue volta a ficar
 * livre. Com `lancarDespesas`, cada despesa do acerto vira um lancamento PAGO
 * em "DESPESAS DE ROTA" (igual a tela Rotas e Despesas) -- a BAIXA dos titulos
 * dos clientes continua em Contas a Receber (decisao do dono).
 */
export const fecharRomaneio = async (args: {
  tenantId: string;
  uid: string;
  id: string;
  romaneio: Romaneio;
  lancarDespesas: boolean;
}): Promise<{ despesasLancadas: number }> => {
  const { tenantId, uid } = args;
  const erroAcerto = erroDoAcerto(args.romaneio.acerto);
  if (erroAcerto) throw new Error(erroAcerto);
  const acerto = acertoParaGravar(args.romaneio.acerto);

  return runTransaction(db, async (transaction) => {
    const { ref, romaneio: gravado } = await lerNaTransacao(transaction, tenantId, args.id);
    const final: Romaneio = {
      ...gravado,
      ...camposDaRota(args.romaneio),
      kmChegada: args.romaneio.kmChegada,
      horarioChegada: args.romaneio.horarioChegada,
      acerto,
      observacaoAcerto: args.romaneio.observacaoAcerto.trim(),
    };
    const erro = erroParaFechar(final);
    if (erro) throw new Error(erro);

    const titulo = tituloDoRomaneio(final.numero, final.nome);
    const agora = serverTimestamp();
    final.entregas.forEach((e) => {
      transaction.set(travaRef(e.pedidoId), {
        tenantId,
        romaneioId: ref.id,
        romaneioTitulo: titulo,
        situacao: situacaoDoPedidoAoEncerrar(e, false),
        updatedAt: agora,
        ...buildDocumentUpdateMetadata(uid, agora, `Acerto da ${titulo}`),
      }, { merge: true });
    });

    const despesas: DespesaRota[] = args.lancarDespesas
      ? acerto.filter((l) => l.natureza === 'despesa').map((l) => ({ tipo: l.tipo, descricao: l.descricao, valor: l.valorCentavos / 100, comprovante: '' }))
      : [];
    let rotaId = '';
    if (despesas.length > 0) {
      const rotaRef = doc(collection(db, 'rotas'));
      rotaId = rotaRef.id;
      const metadata = buildDocumentMetadata(uid, agora);
      const transacaoIds: string[] = [];
      despesas.forEach((despesa) => {
        const transacaoRef = doc(collection(db, 'transacoes'));
        transacaoIds.push(transacaoRef.id);
        transaction.set(transacaoRef, {
          descricao: `${descricaoDaDespesaNoFinanceiro(despesa, final.motoristaNome, final.dataSaida)} - ${titulo}`,
          data: final.dataSaida,
          dataPagamento: final.dataSaida,
          valor: despesa.valor,
          valorCentavos: Math.round(despesa.valor * 100),
          categoria: CATEGORIA_DESPESA_ROTA,
          // Mesmo desenho da tela Rotas e Despesas: o motorista ja pagou na estrada,
          // nao saiu do caixa da loja.
          status: 'Paga',
          tipo: 'saida',
          movimentaCaixaFisico: false,
          rotaId,
          romaneioId: ref.id,
          motoristaId: final.motoristaId,
          motoristaNome: final.motoristaNome,
          ...(final.veiculoId ? { veiculoId: final.veiculoId, veiculoNome: final.veiculoDescricao, veiculoPlaca: final.veiculoPlaca } : {}),
          tipoDespesaRota: despesa.tipo,
          tenantId,
          createdAt: agora,
          ...metadata,
        });
      });
      transaction.set(rotaRef, {
        motoristaId: final.motoristaId,
        motoristaNome: final.motoristaNome,
        veiculo: final.veiculoDescricao,
        data: final.dataSaida,
        observacao: `Lançada pelo acerto da ${titulo}`,
        despesas,
        totalCentavos: despesas.reduce((t, d) => t + Math.round(d.valor * 100), 0),
        total: despesas.reduce((t, d) => t + Math.round(d.valor * 100), 0) / 100,
        transacaoIds,
        romaneioId: ref.id,
        tenantId,
        createdAt: agora,
        ...metadata,
      });
    }

    transaction.update(ref, {
      ...camposDaRota(final),
      kmChegada: final.kmChegada,
      horarioChegada: final.horarioChegada,
      acerto,
      observacaoAcerto: final.observacaoAcerto,
      status: 'fechado',
      fechadoEm: agora,
      fechadoPor: uid,
      despesasRotaId: rotaId,
      updatedAt: agora,
      ...buildDocumentUpdateMetadata(uid, agora, 'Acerto fechado'),
    });
    return { despesasLancadas: despesas.length };
  });
};

/** Desiste da rota antes de qualquer entrega: todos os pedidos voltam a ficar livres. */
export const cancelarRomaneio = async (tenantId: string, uid: string, id: string): Promise<void> => {
  await runTransaction(db, async (transaction) => {
    const { ref, romaneio } = await lerNaTransacao(transaction, tenantId, id);
    const erro = erroParaCancelar(romaneio);
    if (erro) throw new Error(erro);
    const titulo = tituloDoRomaneio(romaneio.numero, romaneio.nome);
    romaneio.entregas.forEach((e) => {
      transaction.set(travaRef(e.pedidoId), {
        tenantId, situacao: situacaoDoPedidoAoEncerrar(e, true), updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(uid, serverTimestamp(), `${titulo} cancelada`),
      }, { merge: true });
    });
    transaction.update(ref, {
      status: 'cancelado',
      canceladoEm: serverTimestamp(),
      canceladoPor: uid,
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(uid, serverTimestamp(), 'Romaneio cancelado'),
    });
  });
};
