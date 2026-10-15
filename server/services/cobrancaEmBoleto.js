/*
 * COBRAR PARCELA EM BOLETO PELO "DAR BAIXA", NO SERVIDOR (15/10/2026).
 *
 * Antes de emitir, a parcela passa a ser cobrada em boleto com o vencimento
 * escolhido na tela; a emissao (nosso numero, codigo de barras, PDF) e' a
 * mesma da tela de Boletos (src/services/boletoEmissaoService.ts). Regras e
 * mensagens em src/utils/cobrancaEmBoletoDomain.ts (compilado para
 * server/domain/).
 */
const { db } = require('../config/firebase');
const {
  bloqueioParaCobrarEmBoleto,
  camposParaCobrarEmBoleto,
  validarVencimentoDoBoleto,
} = require('../domain/cobrancaEmBoletoDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, lerTitulo, lerOrigem } = require('./baixaFinanceira');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/** Parcela em aberto passa a ser cobrada em boleto, com o vencimento escolhido (sem emitir ainda). */
const prepararCobrancaEmBoleto = async ({ user, tenantId, corpo, hoje }) => {
  const transacaoId = String(corpo?.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) throw new ErroBaixa(400, 'Parcela inválida. Atualize a tela e tente de novo.');
  const vencimento = String(corpo?.vencimento || '').trim();
  const erroVencimento = validarVencimentoDoBoleto(vencimento, hoje);
  if (erroVencimento) throw new ErroBaixa(400, erroVencimento);

  const resumo = { vencimento };
  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const bloqueio = bloqueioParaCobrarEmBoleto(titulo.dados);
    if (bloqueio) throw new ErroBaixa(titulo.dados.status === 'Pendente' ? 400 : 409, bloqueio);
    await lerOrigem(tx, tenantId, titulo.dados, 'cobrado em boleto');
    resumo.descricao = String(titulo.dados.descricao || '');
    resumo.formaAnterior = String(titulo.dados.formaPagamento || '');
    tx.update(titulo.ref, {
      ...camposParaCobrarEmBoleto(vencimento),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Parcela passou a ser cobrada em boleto (Dar Baixa)'),
    });
  });
  return resumo;
};

module.exports = { prepararCobrancaEmBoleto };
