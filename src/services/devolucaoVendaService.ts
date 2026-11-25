import { collection, doc, getDocs, increment, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { createAuditLog } from './logService';
import { estornarCashbackDaDevolucaoSemFalhar } from './cashbackService';
import { applyStockAdjustments } from '../utils/firestoreAtomic';
import { getDateInputInTimeZone } from '../utils/dateTime';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../utils/documentMetadata';
import type { LoteUsado } from '../utils/loteRetornoDomain';
import {
  ORIGEM_DEVOLUCAO,
  ROTULO_DESTINO_DEVOLUCAO,
  STATUS_DEVOLUCAO,
  camposDaDevolucao,
  comissaoAposDevolucao,
  creditoDaDevolucao,
  destinoDaDevolucao,
  erroDoPedidoParaDevolucao,
  erroParaDecidirDevolucao,
  idDoDinheiroDaDevolucao,
  lancamentoDaDevolucao,
  lerMotivoDaRecusa,
  planoDaDevolucao,
  quantidadesEmAguardo,
  saldoDoBancoAposDevolucao,
  type DestinoDevolucao,
  type ItemDevolvido,
} from '../utils/devolucaoVendaDomain';

/**
 * DEVOLUCAO DE VENDA PELO NAVEGADOR (24/11/2026).
 *
 * Um codigo so' para as duas portas do sistema:
 *  - a devolucao feita na hora (DevolucaoVendaModal, no pedido ou na tela de Devolucoes);
 *  - o "Confirmar" de uma devolucao pedida pelo app Vendas (tela de Devolucoes).
 * A regra (o que muda em pedido, estoque, lote, comissao e dinheiro) mora em
 * devolucaoVendaDomain.ts -- a mesma que o servidor usa quando a filial deixa
 * a devolucao do app entrar ja' confirmada (server/services/devolucaoVenda.js).
 */

export interface DevolucaoNova {
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  itensDevolvidos: ItemDevolvido[];
  valorTotal: number;
  destino: DestinoDevolucao;
  formaBancaria: string;
  bancoId: string;
  bancoNome: string;
  motivo: string;
  observacao: string;
}

export interface ResultadoDaDevolucao {
  devolucaoId: string;
  pedidoId: string;
  numeroPedido: string;
  valorTotal: number;
  destino: DestinoDevolucao;
  motivo: string;
  vendedorId: string;
  vendedorNome: string;
}

interface Quem {
  tenantId: string;
  usuarioId: string;
  usuarioNome: string;
}

/**
 * Faz a devolucao valer: estoque, lote, pedido (quantidade devolvida e
 * comissao), credito ou saida de caixa/banco. `nova` = devolucao feita agora
 * no sistema; `pendenteId` = confirmar a que o app pediu.
 */
export const efetivarDevolucaoVenda = async (
  quem: Quem,
  alvo: { nova: DevolucaoNova } | { pendenteId: string },
): Promise<ResultadoDaDevolucao> => {
  const { tenantId, usuarioId, usuarioNome } = quem;
  const devolucaoRef = 'nova' in alvo ? doc(collection(db, 'devolucoes_venda')) : doc(db, 'devolucoes_venda', alvo.pendenteId);
  const hoje = getDateInputInTimeZone();
  let resultado: ResultadoDaDevolucao | null = null;

  await runTransaction(db, async (transaction) => {
    // ---------------- LEITURAS (todas antes de qualquer escrita) ----------------
    let dados: DevolucaoNova;
    if ('nova' in alvo) {
      dados = alvo.nova;
    } else {
      const pendenteSnap = await transaction.get(devolucaoRef);
      const pendente = pendenteSnap.exists() && pendenteSnap.data().tenantId === tenantId ? pendenteSnap.data() : null;
      const erro = erroParaDecidirDevolucao(pendente, 'confirmar');
      if (erro || !pendente) throw new Error(erro || 'Esta devolução não existe mais. Atualize a lista.');
      const destino = destinoDaDevolucao(pendente.destinoValor);
      dados = {
        pedidoId: String(pendente.pedidoVendaId || ''),
        numeroPedido: String(pendente.numeroPedidoOriginal || ''),
        clienteNome: String(pendente.clienteNome || ''),
        itensDevolvidos: Array.isArray(pendente.itensDevolvidos) ? pendente.itensDevolvidos : [],
        valorTotal: Number(pendente.valorTotalDevolvido || 0),
        destino,
        formaBancaria: String(pendente.formaDevolucao || 'Pix'),
        bancoId: String(pendente.bancoId || ''),
        bancoNome: String(pendente.bancoNome || ''),
        motivo: String(pendente.motivo || ''),
        observacao: String(pendente.observacao || ''),
      };
    }

    const saleRef = doc(db, 'pedidos_venda', dados.pedidoId);
    const saleSnap = await transaction.get(saleRef);
    const saleData = saleSnap.exists() && saleSnap.data().tenantId === tenantId ? saleSnap.data() : null;
    const erroPedido = erroDoPedidoParaDevolucao(saleData);
    if (erroPedido || !saleData) throw new Error(erroPedido || 'A venda original não existe mais.');

    const bancoRef = dados.destino === 'banco' ? doc(db, 'bancos', dados.bancoId) : null;
    let saldoBancoCentavos = 0;
    if (bancoRef) {
      const bancoSnap = await transaction.get(bancoRef);
      if (!bancoSnap.exists()) throw new Error(`O banco ${dados.bancoNome || 'escolhido'} não existe mais. ${'pendenteId' in alvo ? 'Recuse esta devolução e peça ao vendedor para enviar de novo com outro banco.' : 'Escolha outro banco.'}`);
      saldoBancoCentavos = Number(bancoSnap.data().saldoCentavos || 0);
    }

    const montagem = planoDaDevolucao(saleData.itens, dados.itensDevolvidos);
    if (!montagem.ok) throw new Error(montagem.erro);
    const { plano } = montagem;

    // applyStockAdjustments le o estoque e ja' grava: depois dele, so' escritas.
    await applyStockAdjustments(transaction, db, plano.estoqueQueVolta, 'increment', true);

    // ---------------- ESCRITAS ----------------
    plano.lotesQueVoltam.forEach((lote) => {
      transaction.update(doc(db, 'estoque_lotes', lote.loteId), { quantidade: increment(lote.quantidade), updatedAt: serverTimestamp() });
    });
    // Lotes repostos: o estorno usa isto para retirar de novo dos mesmos lotes.
    const lotesDevolvidos: LoteUsado[] = plano.lotesQueVoltam;
    const vendedorId = String(saleData.vendedorId || '');
    const vendedorNome = String(saleData.vendedorNome || '');

    if ('nova' in alvo) {
      transaction.set(devolucaoRef, {
        ...camposDaDevolucao({
          pedidoId: dados.pedidoId,
          numeroPedido: dados.numeroPedido,
          clienteNome: dados.clienteNome,
          valorTotal: dados.valorTotal,
          destino: dados.destino,
          bancoId: dados.bancoId,
          bancoNome: dados.bancoNome,
          formaBancaria: dados.formaBancaria,
          motivo: dados.motivo,
          observacao: dados.observacao,
          tenantId,
          usuarioId,
          itensDevolvidos: dados.itensDevolvidos,
          status: STATUS_DEVOLUCAO.concluida,
          origem: ORIGEM_DEVOLUCAO.sistema,
          devolucaoId: devolucaoRef.id,
          vendedorId,
          vendedorNome,
          dataSolicitacao: hoje,
        }),
        ...(lotesDevolvidos.length > 0 ? { lotesDevolvidos } : {}),
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(usuarioId, serverTimestamp()),
      });
    } else {
      transaction.update(devolucaoRef, {
        status: STATUS_DEVOLUCAO.concluida,
        confirmadaPorId: usuarioId,
        confirmadaPorNome: usuarioNome,
        confirmadaEm: serverTimestamp(),
        ...(lotesDevolvidos.length > 0 ? { lotesDevolvidos } : {}),
        ...buildDocumentUpdateMetadata(usuarioId, serverTimestamp(), 'Devolução confirmada'),
      });
    }

    const comissao = comissaoAposDevolucao(saleData.comissao, dados.itensDevolvidos);
    transaction.update(saleRef, {
      itens: plano.itensAtualizados,
      ...(comissao ? { comissao } : {}),
      updatedAt: serverTimestamp(),
      ...buildDocumentUpdateMetadata(usuarioId, serverTimestamp(), 'Devolução registrada'),
    });

    const dinheiro = {
      devolucaoId: devolucaoRef.id,
      pedidoId: dados.pedidoId,
      numeroPedido: dados.numeroPedido,
      clienteNome: dados.clienteNome,
      clienteId: saleData.clienteId,
      valor: dados.valorTotal,
      destino: dados.destino,
      formaBancaria: dados.formaBancaria,
      bancoId: dados.bancoId,
      bancoNome: dados.bancoNome,
      motivo: dados.motivo,
      tenantId,
      hoje,
    };
    const lancamento = lancamentoDaDevolucao(dinheiro);
    const credito = creditoDaDevolucao(dinheiro);
    if (lancamento) {
      transaction.set(doc(db, 'transacoes', idDoDinheiroDaDevolucao(devolucaoRef.id)), {
        ...lancamento,
        createdAt: serverTimestamp(),
        ...buildDocumentMetadata(usuarioId, serverTimestamp()),
      });
    }
    if (bancoRef) {
      // Debita o banco na hora, simetrico ao credito que a venda por Pix/Transferencia aplica.
      transaction.update(bancoRef, {
        saldoCentavos: saldoDoBancoAposDevolucao(saldoBancoCentavos, dados.valorTotal),
        updatedAt: serverTimestamp(),
        ...buildDocumentUpdateMetadata(usuarioId, serverTimestamp(), `Devolução do pedido #${dados.numeroPedido}`),
      });
    }
    if (credito) {
      transaction.set(doc(db, 'creditos_cliente', idDoDinheiroDaDevolucao(devolucaoRef.id)), {
        ...credito,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...buildDocumentMetadata(usuarioId, serverTimestamp()),
      });
    }

    resultado = {
      devolucaoId: devolucaoRef.id,
      pedidoId: dados.pedidoId,
      numeroPedido: dados.numeroPedido,
      valorTotal: dados.valorTotal,
      destino: dados.destino,
      motivo: dados.motivo,
      vendedorId,
      vendedorNome,
    };
  });

  if (!resultado) throw new Error('Não foi possível concluir a devolução. Tente de novo.');
  const feito: ResultadoDaDevolucao = resultado;
  // Cashback (20/10/2026): a parte proporcional ao valor devolvido volta (pelo servidor).
  void estornarCashbackDaDevolucaoSemFalhar(feito.devolucaoId);
  return feito;
};

const reais = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

/** Historico de alteracoes da devolucao feita ou confirmada (aparece tambem no pedido). */
export const registrarHistoricoDaDevolucao = (
  quem: Quem & { usuarioEmail: string },
  r: ResultadoDaDevolucao,
  tipo: 'feita' | 'confirmada',
): void => {
  createAuditLog({
    tenantId: quem.tenantId,
    usuarioId: quem.usuarioId,
    usuarioEmail: quem.usuarioEmail,
    modulo: 'vendas',
    acao: tipo === 'feita' ? 'devolucao' : 'devolucao_confirmada',
    descricao: tipo === 'feita'
      ? `Devolução concluída para o pedido #${r.numeroPedido} no valor de R$ ${r.valorTotal.toFixed(2)}.`
      : `Devolução pedida pelo aplicativo CONFIRMADA para o pedido #${r.numeroPedido}: ${reais(r.valorTotal)} (${ROTULO_DESTINO_DEVOLUCAO[r.destino]}).`,
    registroRelacionadoId: r.devolucaoId,
    // Historico de alteracoes (09/11/2026): aparece tambem no pedido de origem.
    documentosRelacionados: [r.pedidoId],
    documentoTipo: 'devolucao',
    documentoNumero: `Devolução do Pedido ${r.numeroPedido}`,
    ...(r.motivo ? { motivo: r.motivo } : {}),
    ...(r.vendedorId ? { vendedorId: r.vendedorId } : {}),
    ...(r.vendedorNome ? { vendedorNome: r.vendedorNome } : {}),
    ...(tipo === 'confirmada' ? { alteracoes: [{ campo: 'Situação', valorAnterior: 'Aguardando confirmação', valorNovo: 'Confirmada' }] } : {}),
    status: 'sucesso',
    critical: true,
  });
};

/** Recusa a devolucao pedida pelo app: nada mexe; o vendedor ve o motivo no app. */
export const recusarDevolucaoVenda = async (
  quem: Quem & { usuarioEmail: string },
  devolucaoId: string,
  motivoBruto: string,
): Promise<void> => {
  const lido = lerMotivoDaRecusa(motivoBruto);
  if (!lido.ok) throw new Error(lido.erro);
  const ref = doc(db, 'devolucoes_venda', devolucaoId);
  let dados: Record<string, unknown> = {};
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const atual = snap.exists() && snap.data().tenantId === quem.tenantId ? snap.data() : null;
    const erro = erroParaDecidirDevolucao(atual, 'recusar');
    if (erro || !atual) throw new Error(erro || 'Esta devolução não existe mais. Atualize a lista.');
    dados = atual;
    transaction.update(ref, {
      status: STATUS_DEVOLUCAO.recusada,
      motivoRecusa: lido.motivo,
      recusadaPorId: quem.usuarioId,
      recusadaPorNome: quem.usuarioNome,
      recusadaEm: serverTimestamp(),
      ...buildDocumentUpdateMetadata(quem.usuarioId, serverTimestamp(), 'Devolução recusada'),
    });
  });
  const numero = String(dados.numeroPedidoOriginal || '');
  createAuditLog({
    tenantId: quem.tenantId,
    usuarioId: quem.usuarioId,
    usuarioEmail: quem.usuarioEmail,
    modulo: 'vendas',
    acao: 'devolucao_recusada',
    descricao: `Devolução pedida pelo aplicativo RECUSADA para o pedido #${numero} (${reais(Number(dados.valorTotalDevolvido || 0))}). Estoque e dinheiro não foram mexidos.`,
    registroRelacionadoId: devolucaoId,
    documentosRelacionados: [String(dados.pedidoVendaId || '')],
    documentoTipo: 'devolucao',
    documentoNumero: `Devolução do Pedido ${numero}`,
    motivo: lido.motivo,
    ...(dados.vendedorId ? { vendedorId: String(dados.vendedorId) } : {}),
    ...(dados.vendedorNome ? { vendedorNome: String(dados.vendedorNome) } : {}),
    alteracoes: [{ campo: 'Situação', valorAnterior: 'Aguardando confirmação', valorNovo: 'Recusada' }],
    status: 'sucesso',
  });
};

/** Quanto de cada linha do pedido esta' em devolucao aguardando confirmacao (por indice). */
export const lerQuantidadesEmAguardo = async (tenantId: string, pedidoId: string): Promise<Map<number, number>> => {
  const snap = await getDocs(query(collection(db, 'devolucoes_venda'), where('tenantId', '==', tenantId), where('pedidoVendaId', '==', pedidoId)));
  return quantidadesEmAguardo(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
};
