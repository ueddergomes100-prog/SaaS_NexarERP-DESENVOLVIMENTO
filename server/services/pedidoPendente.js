/*
 * RECUSAR PEDIDO PENDENTE DO AGENTE (item 15 da Embala Minas, fase Vendas, 25/11/2026).
 *
 * Antes a tela gravava `status: 'Cancelada'` direto no pedido (PedidoVendaForm e
 * Pedidos de Venda) e so' a tela conferia a permissao. Agora passa por aqui:
 * a rota confere "Vendas: Pendente — Recusar pedido" e este servico confere que
 * o pedido e' da empresa, veio do agente e ainda esta' em aberto. Mesmo efeito
 * de antes: so' marca como cancelado (o pedido do agente nao gerou estoque nem
 * financeiro).
 */
const { admin, db } = require('../config/firebase');
const { isPedidoAberto, resolveOrigemPedido } = require('../domain/preVendaDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroVenda } = require('./vendaFechamento');

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;

/** Corpo do POST: { pedidoId, motivo } com motivo de 8 caracteres ou mais. Puro. */
const lerPedidoDeRecusa = (corpo) => {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const pedidoId = String(c.pedidoId || '');
  if (!ID_VALIDO.test(pedidoId)) return { erro: 'Pedido inválido. Atualize a tela e tente de novo.' };
  const motivo = String(c.motivo || '').trim().slice(0, 500);
  if (motivo.length < 8) return { erro: 'Digite o motivo da recusa (pelo menos 8 caracteres).' };
  return { pedidoId, motivo };
};

const recusarPedidoPendente = async ({ user, tenantId, corpo }) => {
  const lido = lerPedidoDeRecusa(corpo);
  if (lido.erro) throw new ErroVenda(400, lido.erro);
  const agora = admin.firestore.FieldValue.serverTimestamp();
  return db.runTransaction(async (tx) => {
    const ref = db.collection('pedidos_venda').doc(lido.pedidoId);
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroVenda(404, 'Este pedido não existe mais. Atualize a lista de pedidos.');
    const pedido = snap.data();
    const numeroPedido = String(pedido.numeroPedido || '');
    if (!isPedidoAberto(pedido.status) || resolveOrigemPedido(pedido) !== 'agente') {
      throw new ErroVenda(409, `O pedido #${numeroPedido} não é um pedido pendente do agente em aberto (talvez já tenha sido finalizado ou recusado). Atualize a tela.`);
    }
    tx.update(ref, {
      status: 'Cancelada',
      motivoRecusa: lido.motivo,
      canceladaPor: user.uid,
      canceladaPorNome: String(user.nome || user.email || 'Usuário'),
      canceladaEm: agora,
      ...buildDocumentUpdateMetadata(user.uid, agora, `Pedido pendente recusado: ${lido.motivo}`),
    });
    return { pedidoId: lido.pedidoId, numeroPedido, motivo: lido.motivo, statusAnterior: String(pedido.status || '') };
  });
};

module.exports = { lerPedidoDeRecusa, recusarPedidoPendente };
