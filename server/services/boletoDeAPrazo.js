/*
 * PARCELA "PAGAMENTO A PRAZO" <-> BOLETO, NO SERVIDOR (15/10/2026).
 *
 * "Gerar boleto" (Contas a Receber) troca a forma da parcela para Boleto e ela
 * entra em Financeiro > Boletos para emitir; "Voltar a prazo" desfaz enquanto
 * o boleto nao foi emitido. Regras e mensagens em
 * src/utils/boletoDeAPrazoDomain.ts (compilado para server/domain/).
 */
const { db } = require('../config/firebase');
const {
  bloqueioParaGerarBoleto,
  bloqueioParaVoltarAPrazo,
  camposAoGerarBoleto,
  camposAoVoltarAPrazo,
} = require('../domain/boletoDeAPrazoDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, apagar, lerTitulo, lerOrigem } = require('./baixaFinanceira');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

const transacaoDoPedido = (corpo) => {
  const transacaoId = String(corpo?.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) throw new ErroBaixa(400, 'Parcela inválida. Atualize a tela e tente de novo.');
  return transacaoId;
};

/** Parcela a prazo passa a ser cobrada em boleto (vai para Boletos > Aguardando emissao). */
const gerarBoletoDaParcela = async ({ user, tenantId, corpo }) => {
  const transacaoId = transacaoDoPedido(corpo);
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const bloqueio = bloqueioParaGerarBoleto(titulo.dados);
    if (bloqueio) throw new ErroBaixa(titulo.dados.status === 'Pendente' ? 400 : 409, bloqueio);
    await lerOrigem(tx, tenantId, titulo.dados, 'cobrado em boleto');
    resumo.descricao = String(titulo.dados.descricao || '');
    tx.update(titulo.ref, {
      ...camposAoGerarBoleto(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Parcela a prazo passou a ser cobrada em boleto'),
    });
  });
  return resumo;
};

/** Volta a parcela convertida para "a prazo" (so' sem boleto emitido). */
const voltarParcelaAPrazo = async ({ user, tenantId, corpo }) => {
  const transacaoId = transacaoDoPedido(corpo);
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const bloqueio = bloqueioParaVoltarAPrazo(titulo.dados);
    if (bloqueio) throw new ErroBaixa(400, bloqueio);
    resumo.descricao = String(titulo.dados.descricao || '');
    tx.update(titulo.ref, {
      ...camposAoVoltarAPrazo(),
      boletoDeAPrazo: apagar(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Parcela voltou a ser "a prazo" (boleto não emitido)'),
    });
  });
  return resumo;
};

module.exports = { gerarBoletoDaParcela, voltarParcelaAPrazo };
