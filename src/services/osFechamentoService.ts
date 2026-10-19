/*
 * FINALIZAR, REABRIR E CANCELAR A OS PELA TELA (item 8, fatia 3d -- 19/10/2026).
 *
 * Caminho de quem esta' com a chave "Venda pelo servidor" DESLIGADA: executa,
 * com o SDK do navegador, o MESMO plano que o servidor executa
 * (src/utils/osFechamentoDomain.ts e server/services/osServidor.js). Com a
 * chave ligada a tela chama osServidorService.ts no lugar destas funcoes.
 *
 * O SDK web nao consulta dentro de transacao: os ids dos lancamentos sao
 * buscados antes e relidos la dentro, um a um.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { CAMPO_CREDITO_VERSAO, MENSAGEM_CREDITO_CONCORRENTE, creditoFoiAlteradoDurante, parseCreditoVersao } from '../utils/creditoDomain';
import { bloqueioParaRefazerParcelas } from '../utils/alteracaoValorTituloDomain';
import type { PaymentRecord } from '../utils/financeDomain';
import type { StockFieldDelta } from '../utils/estoqueReservaDomain';
import type { LoteUsado } from '../utils/loteRetornoDomain';
import type { TituloDaVenda } from '../utils/cancelamentoVendaDomain';
import {
  idDoTituloDaOs,
  idsDosTitulosGravados,
  novoSaldoDoProduto,
  planoDaFinalizacaoDaOs,
  planoDaReaberturaDaOs,
  planoDoCancelamentoDaOs,
  titulosQueSaemNaFinalizacao,
  type PerfilDoMecanico,
} from '../utils/osFechamentoDomain';

export interface ContextoDaOs {
  db: Firestore;
  tenantId: string;
  usuarioId: string;
  usuarioNome: string;
}

/** Erro de regra, ja' em portugues: a tela mostra como esta'. */
export class ErroDaOs extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroDaOs';
  }
}

const lerOs = async (ctx: ContextoDaOs, osId: string): Promise<DocumentData> => {
  const snap = await getDoc(doc(ctx.db, 'ordens_de_servico', osId));
  if (!snap.exists() || snap.data().tenantId !== ctx.tenantId) throw new ErroDaOs('Esta OS não existe mais. Atualize a lista de Ordens de Serviço.');
  return snap.data();
};

const lerOsNaTransacao = async (tx: Transaction, ctx: ContextoDaOs, osId: string): Promise<DocumentData> => {
  const snap = await tx.get(doc(ctx.db, 'ordens_de_servico', osId));
  if (!snap.exists() || snap.data().tenantId !== ctx.tenantId) throw new ErroDaOs('Esta OS não existe mais. Atualize a lista de Ordens de Serviço.');
  return snap.data();
};

/** Ids dos lancamentos da OS: os dos pagamentos gravados + os que apontam para a OS (recebimento parcial). */
const idsDosTitulosDaOs = async (ctx: ContextoDaOs, osId: string, pagamentos: unknown): Promise<string[]> => {
  const snap = await getDocs(query(collection(ctx.db, 'transacoes'), where('tenantId', '==', ctx.tenantId), where('osId', '==', osId)));
  return [...new Set([...idsDosTitulosGravados(osId, pagamentos), ...snap.docs.map((d) => d.id)])];
};

const lerTitulos = async (tx: Transaction, ctx: ContextoDaOs, ids: string[]): Promise<TituloDaVenda[]> => {
  const titulos: TituloDaVenda[] = [];
  for (const id of ids) {
    const snap = await tx.get(doc(ctx.db, 'transacoes', id));
    if (snap.exists() && snap.data().tenantId === ctx.tenantId) titulos.push({ id, dados: snap.data() });
  }
  return titulos;
};

const lerSaldos = async (tx: Transaction, ctx: ContextoDaOs, ids: string[]): Promise<Map<string, number>> => {
  const saldos = new Map<string, number>();
  for (const bancoId of ids) {
    const snap = await tx.get(doc(ctx.db, 'bancos', bancoId));
    if (snap.exists() && snap.data().tenantId === ctx.tenantId) saldos.set(bancoId, Number(snap.data().saldoCentavos || 0));
  }
  return saldos;
};

const lerProdutos = async (tx: Transaction, ctx: ContextoDaOs, ids: string[]): Promise<Record<string, DocumentData>> => {
  const produtos: Record<string, DocumentData> = {};
  for (const id of [...new Set(ids)]) {
    const snap = await tx.get(doc(ctx.db, 'estoque', id));
    if (!snap.exists()) continue;
    if (snap.data().tenantId !== ctx.tenantId) throw new ErroDaOs('Uma das peças da OS não é desta empresa. Remova a peça e lance de novo.');
    produtos[id] = snap.data();
  }
  return produtos;
};

/** Novos saldos do estoque (conferidos ANTES de qualquer escrita). */
const saldosDoEstoque = (deltas: StockFieldDelta[], produtos: Record<string, DocumentData>, permitirSemEstoque: boolean) => deltas.flatMap((d) => {
  const saldo = novoSaldoDoProduto(d, produtos[d.id], permitirSemEstoque);
  if (!saldo) return [];
  if ('erro' in saldo) throw new ErroDaOs(saldo.erro);
  return [{ id: d.id, ...saldo }];
});

// ===========================================================================
// FINALIZAR
// ===========================================================================

export interface FinalizacaoPelaTela {
  osId: string;
  dataSaida: string;
  /** Ja' normalizados e explodidos pela tela (mesma conta do servidor). */
  pagamentos: PaymentRecord[];
  lotesPorLinha: Record<string, LoteUsado[]>;
  permitirSemEstoque: boolean;
  percentualDoServico: (id: string) => number | undefined;
  percentualDaPeca: (id: string) => number | undefined;
  comissaoPadraoServicos?: number;
  comissaoPadraoPecas?: number;
  /** OS a prazo com limite de credito: versao lida junto com o saldo do cliente. */
  guardaDoCredito: { clienteId: string; versaoNaChecagem: number } | null;
}

export const finalizarOsPelaTela = async (ctx: ContextoDaOs, f: FinalizacaoPelaTela) => {
  const antes = await lerOs(ctx, f.osId);
  const idsDosTitulos = [...new Set([
    ...idsDosTitulosGravados(f.osId, antes.pagamentos),
    ...f.pagamentos.map((_, indice) => idDoTituloDaOs(f.osId, indice)),
  ])];
  const osRef = doc(ctx.db, 'ordens_de_servico', f.osId);

  return runTransaction(ctx.db, async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = await lerOsNaTransacao(tx, ctx, f.osId);
    const numeroOS = String(os.numeroOS || '');
    const mecanicoId = String(os.mecanicoId || '');
    let mecanico: PerfilDoMecanico | null = null;
    if (mecanicoId) {
      const snap = await tx.get(doc(ctx.db, 'usuarios', mecanicoId));
      if (snap.exists()) mecanico = snap.data() as PerfilDoMecanico;
    }
    const pecas = Array.isArray(os.pecas) ? os.pecas as Array<{ id?: string }> : [];
    const produtos = await lerProdutos(tx, ctx, pecas.map((p) => String(p?.id || '')).filter((id) => id && id !== 'avulso'));
    const titulos = await lerTitulos(tx, ctx, idsDosTitulos);
    const bloqueio = bloqueioParaRefazerParcelas(titulos.map((t) => t.dados), 'OS');
    if (bloqueio) throw new ErroDaOs(bloqueio);

    const clienteRef = f.guardaDoCredito ? doc(ctx.db, 'clientes', f.guardaDoCredito.clienteId) : null;
    let creditoVersaoAtual = 0;
    if (clienteRef && f.guardaDoCredito) {
      const snap = await tx.get(clienteRef);
      creditoVersaoAtual = parseCreditoVersao(snap.data()?.[CAMPO_CREDITO_VERSAO]);
      if (creditoFoiAlteradoDurante(f.guardaDoCredito.versaoNaChecagem, creditoVersaoAtual)) throw new ErroDaOs(MENSAGEM_CREDITO_CONCORRENTE);
    }

    const resultado = planoDaFinalizacaoDaOs({
      osId: f.osId,
      tenantId: ctx.tenantId,
      usuarioId: ctx.usuarioId,
      os,
      dataSaida: f.dataSaida,
      pagamentos: f.pagamentos,
      lotesPorLinha: f.lotesPorLinha,
      mecanico,
      percentualDoServico: f.percentualDoServico,
      percentualDaPeca: f.percentualDaPeca,
      comissaoPadraoServicos: f.comissaoPadraoServicos,
      comissaoPadraoPecas: f.comissaoPadraoPecas,
      agoraIso: new Date().toISOString(),
    });
    if ('erro' in resultado) throw new ErroDaOs(resultado.erro);
    const plano = resultado.plano;

    const saldos = await lerSaldos(tx, ctx, [...plano.creditoPorBanco.keys()]);
    plano.creditoPorBanco.forEach((_, bancoId) => {
      if (!saldos.has(bancoId)) throw new ErroDaOs('O banco de destino selecionado não foi encontrado.');
    });
    const estoque = saldosDoEstoque(plano.estoque, produtos, f.permitirSemEstoque);

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      finalizadaPor: ctx.usuarioId,
      finalizadaEm: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'OS finalizada'),
    });
    estoque.forEach(({ id, ...campos }) => tx.update(doc(ctx.db, 'estoque', id), { ...campos, updatedAt: serverTimestamp() }));
    plano.lotes.forEach((l) => tx.update(doc(ctx.db, 'estoque_lotes', l.loteId), { quantidade: increment(-l.quantidade), updatedAt: serverTimestamp() }));
    if (clienteRef) tx.update(clienteRef, { [CAMPO_CREDITO_VERSAO]: creditoVersaoAtual + 1, updatedAt: serverTimestamp() });
    plano.creditoPorBanco.forEach((delta, bancoId) => {
      tx.update(doc(ctx.db, 'bancos', bancoId), {
        saldoCentavos: (saldos.get(bancoId) || 0) + delta,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), `Crédito da OS #${numeroOS}`),
      });
    });
    const existentes = new Map(titulos.map((t) => [t.id, t.dados]));
    plano.titulos.forEach((t) => {
      const antigo = existentes.get(t.id);
      tx.set(doc(ctx.db, 'transacoes', t.id), {
        ...t.campos,
        ...(antigo
          ? { createdAt: antigo.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(), ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'Refeita ao finalizar a OS') }
          : { createdAt: serverTimestamp(), ...buildDocumentMetadata(ctx.usuarioId, serverTimestamp()) }),
      });
    });
    titulosQueSaemNaFinalizacao(titulos, plano.titulos.map((t) => t.id)).forEach((id) => {
      tx.update(doc(ctx.db, 'transacoes', id), {
        status: 'Cancelada',
        movimentaCaixaFisico: false,
        substituidaEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'Substituída por novo pagamento'),
      });
    });
    if (os.orcamentoId) {
      tx.update(doc(ctx.db, 'orcamentos', String(os.orcamentoId)), {
        status: 'Finalizado',
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), `OS #${numeroOS} finalizada`),
      });
    }
    return { numeroOS, totalCentavos: plano.totais.valorTotalCentavos, formaPagamento: plano.formaPagamento };
  });
};

// ===========================================================================
// REABRIR
// ===========================================================================

export const reabrirOsPelaTela = async (ctx: ContextoDaOs, osId: string, status: string) => {
  const antes = await lerOs(ctx, osId);
  const ids = await idsDosTitulosDaOs(ctx, osId, antes.pagamentos);
  const osRef = doc(ctx.db, 'ordens_de_servico', osId);

  return runTransaction(ctx.db, async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = await lerOsNaTransacao(tx, ctx, osId);
    const numeroOS = String(os.numeroOS || '');
    const titulos = await lerTitulos(tx, ctx, ids);
    const resultado = planoDaReaberturaDaOs({ os, titulos, status, agoraIso: new Date().toISOString() });
    if ('erro' in resultado) throw new ErroDaOs(resultado.erro);
    const plano = resultado.plano;
    const saldos = await lerSaldos(tx, ctx, [...plano.debitoPorBanco.keys()]);
    const produtos = await lerProdutos(tx, ctx, plano.estoque.map((d) => d.id));
    const estoque = saldosDoEstoque(plano.estoque, produtos, true);

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      reabertaPor: ctx.usuarioId,
      reabertaPorNome: ctx.usuarioNome,
      reabertaEm: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'OS reaberta'),
    });
    plano.debitoPorBanco.forEach((delta, bancoId) => {
      const saldo = saldos.get(bancoId);
      if (saldo === undefined) return;
      tx.update(doc(ctx.db, 'bancos', bancoId), {
        saldoCentavos: saldo - delta,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), `Estorno do crédito da OS #${numeroOS} (reaberta)`),
      });
    });
    plano.titulosCancelados.forEach((id) => {
      tx.update(doc(ctx.db, 'transacoes', id), {
        status: 'Cancelada',
        movimentaCaixaFisico: false,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'Cancelada pela reabertura da OS'),
      });
    });
    estoque.forEach(({ id, ...campos }) => tx.update(doc(ctx.db, 'estoque', id), { ...campos, updatedAt: serverTimestamp() }));
    plano.lotes.forEach((l) => tx.update(doc(ctx.db, 'estoque_lotes', l.loteId), { quantidade: increment(l.quantidade), updatedAt: serverTimestamp() }));
    return { numeroOS, pecasDevolvidas: plano.estoque.length > 0 };
  });
};

// ===========================================================================
// CANCELAR
// ===========================================================================

export const cancelarOsPelaTela = async (ctx: ContextoDaOs, osId: string, motivo: string, devolverEstoque: boolean) => {
  const antes = await lerOs(ctx, osId);
  const ids = await idsDosTitulosDaOs(ctx, osId, antes.pagamentos);
  const osRef = doc(ctx.db, 'ordens_de_servico', osId);
  const hoje = getDateInputInTimeZone();

  return runTransaction(ctx.db, async (tx) => {
    // ---------------- LEITURAS ----------------
    const os = await lerOsNaTransacao(tx, ctx, osId);
    const numeroOS = String(os.numeroOS || '');
    const titulos = await lerTitulos(tx, ctx, ids);
    const resultado = planoDoCancelamentoDaOs({
      osId,
      os,
      titulos,
      motivo,
      devolverEstoque,
      usuarioId: ctx.usuarioId,
      usuarioNome: ctx.usuarioNome,
      tenantId: ctx.tenantId,
      hoje,
      agoraIso: new Date().toISOString(),
    });
    if ('erro' in resultado) throw new ErroDaOs(resultado.erro);
    const plano = resultado.plano;
    const saldos = await lerSaldos(tx, ctx, [...plano.debitoPorBanco.keys()]);
    const produtos = await lerProdutos(tx, ctx, plano.estoque.map((d) => d.id));
    const estoque = saldosDoEstoque(plano.estoque, produtos, true);

    // ---------------- ESCRITAS ----------------
    tx.update(osRef, {
      ...plano.camposDaOs,
      canceladaEm: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), 'OS cancelada'),
    });
    plano.debitoPorBanco.forEach((delta, bancoId) => {
      const saldo = saldos.get(bancoId);
      if (saldo === undefined) return;
      tx.update(doc(ctx.db, 'bancos', bancoId), {
        saldoCentavos: saldo - delta,
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), `Estorno do crédito da OS #${numeroOS}`),
      });
    });
    plano.titulos.atualizar.forEach((a) => {
      tx.update(doc(ctx.db, 'transacoes', a.id), {
        ...a.campos,
        estornadaEm: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), a.nota),
      });
    });
    plano.titulos.criar.forEach((c) => {
      tx.set(doc(ctx.db, 'transacoes', c.id), { ...c.campos, createdAt: serverTimestamp(), ...buildDocumentMetadata(ctx.usuarioId, serverTimestamp()) }, { merge: true });
    });
    estoque.forEach(({ id, ...campos }) => tx.update(doc(ctx.db, 'estoque', id), { ...campos, updatedAt: serverTimestamp() }));
    plano.lotes.forEach((l) => tx.update(doc(ctx.db, 'estoque_lotes', l.loteId), { quantidade: increment(l.quantidade), updatedAt: serverTimestamp() }));
    if (os.orcamentoId) {
      tx.update(doc(ctx.db, 'orcamentos', String(os.orcamentoId)), {
        status: 'Pendente',
        ...buildDocumentUpdateMetadata(ctx.usuarioId, serverTimestamp(), `OS #${numeroOS} cancelada`),
      });
    }
    return { numeroOS, devolveuEstoque: plano.devolveuEstoque };
  });
};
