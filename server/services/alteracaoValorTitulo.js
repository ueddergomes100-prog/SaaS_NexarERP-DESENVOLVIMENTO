/*
 * ALTERAR O VALOR DE UMA PARCELA A RECEBER NO SERVIDOR (15/10/2026).
 *
 * O cliente manda a nota fiscal com o valor da venda e o boleto com desconto:
 * muda so' o titulo em `transacoes`, nunca a venda/OS. Quem pode, o que pode e
 * as mensagens estao em src/utils/alteracaoValorTituloDomain.ts (compilado para
 * server/domain/) -- a mesma regra que a tela usa para avisar antes.
 *
 * O navegador so' diz qual parcela, o novo valor e o motivo. O valor atual, o
 * boleto, a venda/OS e a empresa sao lidos aqui, dentro da transacao.
 */
const { db } = require('../config/firebase');
const {
  bloqueioParaAlterarValor,
  centavosAtuaisDoTitulo,
  montarAlteracaoValor,
  validarMotivoAlteracaoValor,
  validarNovoValorDoTitulo,
} = require('../domain/alteracaoValorTituloDomain');
const { fromCents } = require('../domain/financeDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa, agora, lerTitulo } = require('./baixaFinanceira');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/** Confere o pedido que veio do navegador. Puro. `{ erro }` ou `{ pedido }`. */
const validarPedidoDeAlteracaoDeValor = (corpo) => {
  const transacaoId = String(corpo?.transacaoId || '').trim();
  if (!ID_VALIDO.test(transacaoId)) return { erro: 'Parcela inválida. Atualize a tela e tente de novo.' };
  const novoValorCentavos = Number(corpo?.novoValorCentavos);
  if (!Number.isInteger(novoValorCentavos) || novoValorCentavos <= 0) {
    return { erro: 'Informe o novo valor da parcela, em reais e maior que zero.' };
  }
  const erroMotivo = validarMotivoAlteracaoValor(corpo?.motivo);
  if (erroMotivo) return { erro: erroMotivo };
  return { pedido: { transacaoId, novoValorCentavos, motivo: String(corpo.motivo).trim() } };
};

/** Venda/OS cancelada nao tem cobranca a ajustar. */
const conferirOrigem = async (tx, tenantId, dados) => {
  const vendaId = dados.pedidoId;
  const osId = dados.osId;
  if (!vendaId && !osId) return;
  const snap = await tx.get(vendaId
    ? db.collection('pedidos_venda').doc(String(vendaId))
    : db.collection('ordens_de_servico').doc(String(osId)));
  if (!snap.exists || snap.data().tenantId !== tenantId) return;
  if (snap.data().status === 'Cancelada') {
    throw new ErroBaixa(400, vendaId
      ? 'A venda desta parcela está cancelada, então o valor da parcela não pode ser alterado.'
      : 'A OS desta parcela está cancelada, então o valor da parcela não pode ser alterado.');
  }
};

const alterarValorDoTitulo = async ({ user, tenantId, pedido }) => {
  const resumo = {};

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId: pedido.transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    const bloqueio = bloqueioParaAlterarValor(dados);
    if (bloqueio) throw new ErroBaixa(dados.status === 'Paga' ? 409 : 400, bloqueio);
    await conferirOrigem(tx, tenantId, dados);

    const atualCentavos = centavosAtuaisDoTitulo(dados);
    const erroValor = validarNovoValorDoTitulo(atualCentavos, pedido.novoValorCentavos);
    if (erroValor) throw new ErroBaixa(400, erroValor);

    const registro = montarAlteracaoValor({
      titulo: dados,
      novoCentavos: pedido.novoValorCentavos,
      motivo: pedido.motivo,
      porUid: user.uid,
      porEmail: user.email || null,
    });
    resumo.descricao = String(dados.descricao || '');
    resumo.deCentavos = atualCentavos;
    resumo.paraCentavos = pedido.novoValorCentavos;

    tx.update(titulo.ref, {
      valorCentavos: pedido.novoValorCentavos,
      valor: fromCents(pedido.novoValorCentavos),
      alteracaoValor: { ...registro, em: agora() },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Valor da parcela alterado: ${pedido.motivo}`),
    });
  });

  return resumo;
};

module.exports = { validarPedidoDeAlteracaoDeValor, alterarValorDoTitulo };
