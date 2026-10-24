/*
 * NOTA FISCAL DO PEDIDO (lista do dono, 23/10/2026).
 *
 * Regra em domain/notaDoPedidoDomain (compilado de src/utils/notaDoPedidoDomain.ts).
 * Aqui:
 *  - travarEmissao: antes de mandar a NF-e/NFC-e de um pedido para a Spedy, confere
 *    no banco (numa transacao) se o pedido pode receber nota -- sem nota fiscal,
 *    cancelado, ja' tem nota valendo, ou outra tela emitindo agora -- e grava no
 *    pedido a trava `notaEmissaoEmAndamento` (integrationId + hora). A tela grava a
 *    nota em notas_fiscais logo depois; a trava some sozinha (3 min) ou quando a
 *    nota com o mesmo integrationId aparece.
 *  - definirComNotaFiscal: troca "Com nota / Sem nota" de um pedido ja' gravado.
 */
const { admin, db } = require('../config/firebase');
const nd = require('../domain/notaDoPedidoDomain');

class ErroNotaDoPedido extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin
  || user.isTenantManager
  || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);

const resumoDaNota = (d) => {
  const n = d.data();
  return {
    tipo: n.tipo || null,
    status: n.status || null,
    finalidade: n.finalidade || null,
    number: n.number ?? null,
    integrationId: n.integrationId || null,
  };
};

const lerPedidoDaEmpresa = async (tx, tenantId, pedidoId) => {
  const ref = db.collection('pedidos_venda').doc(pedidoId);
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) {
    throw new ErroNotaDoPedido(404, 'Pedido não encontrado nesta empresa. Atualize a tela e tente de novo.');
  }
  return { ref, pedido: snap.data() };
};

/**
 * Confere e trava a emissao. Leituras antes das escritas (regra da transacao).
 * @returns {Promise<void>} lanca ErroNotaDoPedido(409) quando nao pode emitir.
 */
const travarEmissao = async ({ tenantId, pedidoId, tipo, integrationId, uid }) => {
  if (tipo !== 'NF-e' && tipo !== 'NFC-e') return;
  if (typeof pedidoId !== 'string' || !pedidoId.trim() || pedidoId.includes('/')) return;
  const idDaNota = typeof integrationId === 'string' ? integrationId.trim() : '';
  await db.runTransaction(async (tx) => {
    const { ref, pedido } = await lerPedidoDaEmpresa(tx, tenantId, pedidoId.trim());
    const notasSnap = await tx.get(db.collection('notas_fiscais')
      .where('tenantId', '==', tenantId)
      .where('pedidoId', '==', pedidoId.trim()));
    const motivo = nd.motivoParaNaoEmitir({
      numeroPedido: pedido.numeroPedido || null,
      status: pedido.status || null,
      comNotaFiscal: pedido.comNotaFiscal,
      tipo,
      integrationId: idDaNota || null,
      notas: notasSnap.docs.map(resumoDaNota),
      trava: pedido.notaEmissaoEmAndamento || null,
      agoraMillis: Date.now(),
    });
    if (motivo) throw new ErroNotaDoPedido(409, motivo);
    tx.update(ref, {
      notaEmissaoEmAndamento: { integrationId: idDaNota || `sem-id-${Date.now()}`, tipo, emMillis: Date.now(), uid: uid || null },
    });
  });
};

/**
 * Troca "Com nota / Sem nota" de um pedido gravado.
 * Quem pode: quem altera o pedido (vendas.alterar; pre-venda: vendas.pre_venda_editar).
 * Pedido antigo sem marcacao: quem emite nota (fiscal.emitir) tambem pode tira-lo
 * da lista de emissao marcando "Sem nota" (pedido do dono, 23/10).
 */
const definirComNotaFiscal = async ({ user, tenantId, pedidoId, comNotaFiscal }) => db.runTransaction(async (tx) => {
  const { ref, pedido } = await lerPedidoDaEmpresa(tx, tenantId, pedidoId);
  const marcaAtual = nd.marcaNotaDoPedido(pedido.comNotaFiscal);
  const ehPreVenda = pedido.status === 'Pré-venda' || pedido.status === 'Pre-venda';
  const podeAlterar = temPermissao(user, 'vendas.alterar') || (ehPreVenda && temPermissao(user, 'vendas.pre_venda_editar'));
  const podeTirarAntigoDaEmissao = marcaAtual === 'nao_informado' && comNotaFiscal === false && temPermissao(user, 'fiscal.emitir');
  if (!podeAlterar && !podeTirarAntigoDaEmissao) {
    throw new ErroNotaDoPedido(403, 'Você não tem permissão para alterar este pedido. Peça a um responsável liberar "Vendas: Alterar Pedidos" no seu usuário.');
  }
  if (pedido.status === 'Cancelada') throw new ErroNotaDoPedido(409, 'Pedido cancelado não muda de com/sem nota fiscal.');
  const notasSnap = await tx.get(db.collection('notas_fiscais')
    .where('tenantId', '==', tenantId)
    .where('pedidoId', '==', pedidoId));
  if (comNotaFiscal === false) {
    const motivo = nd.motivoParaNaoMarcarSemNota({ numeroPedido: pedido.numeroPedido || null, notas: notasSnap.docs.map(resumoDaNota) });
    if (motivo) throw new ErroNotaDoPedido(409, motivo);
  }
  const mudou = marcaAtual !== (comNotaFiscal ? 'com' : 'sem');
  if (mudou) {
    tx.update(ref, {
      comNotaFiscal,
      comNotaFiscalAlteradoPor: user.uid,
      comNotaFiscalAlteradoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  return { mudou, numeroPedido: pedido.numeroPedido || '', antes: marcaAtual, vendedorId: pedido.vendedorId || null, vendedorNome: pedido.vendedorNome || null };
});

module.exports = { ErroNotaDoPedido, travarEmissao, definirComNotaFiscal };
