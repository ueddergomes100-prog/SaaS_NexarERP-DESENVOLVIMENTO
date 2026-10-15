/*
 * RENEGOCIACAO x VENDAS/OS DE ORIGEM (15/10/2026).
 *
 * Decisao do dono: as vendas/OS das parcelas antigas so' ficam quitadas quando
 * a renegociacao for paga. Entao, em todo recebimento de PARCELA NOVA (Dar
 * Baixa, baixa em lote, cheque compensado, cartao conciliado, retorno do
 * boleto) a ultima parcela recebida quita as vendas/OS; e o estorno de uma
 * parcela nova de renegociacao ja' quitada reabre as vendas/OS.
 *
 * Arquivo proprio (sem depender de baixaFinanceira.js) para a baixa, o estorno
 * e o movimento de banco usarem sem import circular. Regras puras em
 * src/utils/renegociacaoDomain.ts.
 *
 * Uso dentro de UMA transacao: `lerRenegociacaoDoTitulo` na fase de leituras;
 * `quitar...`/`reabrir...` na fase de escritas.
 */
const { admin, db } = require('../config/firebase');
const { legacyPaymentForTransaction } = require('../domain/financeDomain');
const {
  STATUS_RENEGOCIADA,
  origensDaRenegociacao,
  quitarPagamentosRenegociados,
  reabrirPagamentosRenegociados,
  renegociacaoQuitadaComEsteRecebimento,
} = require('../domain/renegociacaoDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { camposDoResumoDePagamentos, ErroBaixa } = require('./baixaFinanceiraRegras');

const agora = () => admin.firestore.FieldValue.serverTimestamp();

/** Parcela ANTIGA (ja' renegociada) nao recebe baixa: quem e' cobrado agora sao as novas. */
const recusarSeRenegociada = (dados) => {
  if (dados && dados.status === STATUS_RENEGOCIADA) {
    throw new ErroBaixa(400, 'Esta parcela foi renegociada. Receba pelas parcelas da renegociação (ou desfaça a renegociação).');
  }
};

/**
 * LEITURAS: as outras parcelas novas e as vendas/OS das parcelas antigas.
 * null quando o titulo nao e' parcela de renegociacao.
 */
const lerRenegociacaoDoTitulo = async (tx, tenantId, transacaoId, dados) => {
  const registro = dados && dados.renegociacao;
  if (!registro || !registro.id || !Array.isArray(registro.titulosNovos)) return null;

  const outras = [];
  for (const id of registro.titulosNovos.filter((outroId) => outroId !== transacaoId)) {
    const snap = await tx.get(db.collection('transacoes').doc(String(id)));
    // Parcela que nao existe mais (ou de outra empresa) conta como nao recebida.
    outras.push({ id, status: snap.exists && snap.data().tenantId === tenantId ? snap.data().status : 'Ausente' });
  }

  const origens = [];
  const titulosOrigem = Array.isArray(registro.titulosOrigem) ? registro.titulosOrigem : [];
  for (const origem of origensDaRenegociacao(titulosOrigem)) {
    const ref = db.collection(origem.colecao).doc(origem.id);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().tenantId !== tenantId) continue;
    origens.push({ ref, dados: snap.data(), titulos: origem.titulos });
  }
  return { outras, origens };
};

/** Pagamentos da venda/OS; venda antiga sem o array usa um pagamento por parcela antiga. */
const pagamentosDaOrigem = (origem) => (
  Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
    ? origem.dados.pagamentos
    : origem.titulos.map((titulo) => legacyPaymentForTransaction(titulo.id, {
      valorCentavos: titulo.valorCentavos,
      paymentIndex: titulo.paymentIndex,
      formaPagamento: 'Pagamento a Prazo',
      status: 'Pendente',
    }))
);

/** ESCRITA no recebimento de parcela nova: a ultima recebida quita as vendas/OS. */
const quitarOrigensSeRenegociacaoPaga = (tx, user, leitura, recebidoEm) => {
  if (!leitura || !renegociacaoQuitadaComEsteRecebimento(leitura.outras)) return false;
  leitura.origens.forEach((origem) => {
    const atualizados = quitarPagamentosRenegociados(pagamentosDaOrigem(origem), origem.titulos, recebidoEm);
    tx.update(origem.ref, {
      ...camposDoResumoDePagamentos(atualizados),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Quitada pela renegociação (última parcela recebida)'),
    });
  });
  return true;
};

/**
 * ESCRITA no estorno de parcela nova: o estorno so' roda em parcela recebida;
 * se todas as outras tambem estao recebidas, a renegociacao estava quitada e as
 * vendas/OS voltam a mostrar os pagamentos como pendentes.
 */
const reabrirOrigensSeRenegociacaoEstavaPaga = (tx, user, leitura, motivo) => {
  if (!leitura || !renegociacaoQuitadaComEsteRecebimento(leitura.outras)) return false;
  reabrirOrigens(tx, user, leitura.origens, `Renegociação voltou a ficar em aberto: ${motivo}`);
  return true;
};

/** Reabre os pagamentos das parcelas antigas nas vendas/OS (estorno ou desfazer renegociacao). */
const reabrirOrigens = (tx, user, origens, resumoDaAlteracao) => {
  origens.forEach((origem) => {
    if (!Array.isArray(origem.dados.pagamentos) || origem.dados.pagamentos.length === 0) return;
    const atualizados = reabrirPagamentosRenegociados(origem.dados.pagamentos, origem.titulos);
    tx.update(origem.ref, {
      ...camposDoResumoDePagamentos(atualizados),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), resumoDaAlteracao),
    });
  });
};

module.exports = {
  recusarSeRenegociada,
  lerRenegociacaoDoTitulo,
  quitarOrigensSeRenegociacaoPaga,
  reabrirOrigensSeRenegociacaoEstavaPaga,
  reabrirOrigens,
};
