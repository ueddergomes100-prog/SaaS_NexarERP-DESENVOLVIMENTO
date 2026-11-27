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
const { ehPedidoDoSistemaAnterior, mensagemPedidoDoSistemaAnterior } = require('../domain/importacaoPedidosAnterioresDomain');
const { podeEmVendas, mensagemSemPermissao } = require('./permissoesVendas');
const { PERMISSAO_VENDAS: PV } = require('../domain/permissoesNovasDomain');
const { registrarLogNaTransacao } = require('./auditoria');

class ErroNotaDoPedido extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin
  || user.dono
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
    // Venda importada do sistema anterior (23/11/2026): a nota dela, se teve, saiu no sistema antigo.
    if (ehPedidoDoSistemaAnterior(pedido)) throw new ErroNotaDoPedido(409, mensagemPedidoDoSistemaAnterior('faturada com nota'));
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
  // Item 15 (25/11/2026): pedido fechado pede a permissao propria (antes, "Alterar Pedidos").
  const podeAlterar = podeEmVendas(user, PV.alterarNotaFiscal) || (ehPreVenda && temPermissao(user, 'vendas.pre_venda_editar'));
  const podeTirarAntigoDaEmissao = marcaAtual === 'nao_informado' && comNotaFiscal === false && temPermissao(user, 'fiscal.emitir');
  if (!podeAlterar && !podeTirarAntigoDaEmissao) {
    throw new ErroNotaDoPedido(403, ehPreVenda
      ? 'Você não tem permissão para alterar esta pré-venda. Peça a um responsável liberar "Vendas: Pré-venda — Editar em Aberto" no seu cadastro de funcionário.'
      : mensagemSemPermissao([PV.alterarNotaFiscal]));
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

/**
 * OBSERVACAO DE VENDA CONCLUIDA (27/11/2026, pedido do dono): troca so' o texto da
 * observacao de um pedido ja' finalizado e grava, na MESMA transacao, o registro no
 * Historico de alteracoes (antes -> depois). Pre-venda/pedido em aberto se edita
 * pela tela, como sempre; cancelado nao muda.
 */
const OBSERVACAO_MAX = 200;
const alterarObservacao = async ({ user, tenantId, pedidoId, observacao }) => {
  if (!podeEmVendas(user, PV.alterarObservacao)) {
    throw new ErroNotaDoPedido(403, mensagemSemPermissao([PV.alterarObservacao]));
  }
  if (typeof pedidoId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(pedidoId)) {
    throw new ErroNotaDoPedido(400, 'Pedido inválido. Atualize a tela e tente de novo.');
  }
  const nova = String(observacao ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, OBSERVACAO_MAX);
  return db.runTransaction(async (tx) => {
    const { ref, pedido } = await lerPedidoDaEmpresa(tx, tenantId, pedidoId);
    if (pedido.status === 'Cancelada') throw new ErroNotaDoPedido(409, 'Pedido cancelado não muda a observação.');
    if (pedido.status !== 'Finalizada') {
      throw new ErroNotaDoPedido(409, 'Este pedido ainda está em aberto: altere a observação na própria tela do pedido e grave de novo.');
    }
    const antes = String(pedido.observacao || '').trim();
    if (antes === nova) return { mudou: false, observacao: nova, numeroPedido: pedido.numeroPedido || '' };
    tx.update(ref, {
      observacao: nova,
      observacaoAlteradaPor: user.uid,
      observacaoAlteradaEm: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    registrarLogNaTransacao(tx, { ...user, tenantId }, {
      modulo: 'vendas',
      acao: 'edicao',
      descricao: `Observação da venda #${pedido.numeroPedido || ''} alterada.`,
      registroId: pedidoId,
      documentoTipo: 'pedido',
      documentoNumero: `Pedido ${pedido.numeroPedido || ''}`,
      vendedorId: pedido.vendedorId || null,
      vendedorNome: pedido.vendedorNome || null,
      alteracoes: [{ campo: 'Observação', valorAnterior: antes || '(vazia)', valorNovo: nova || '(vazia)' }],
    });
    return { mudou: true, observacao: nova, numeroPedido: pedido.numeroPedido || '' };
  });
};

module.exports = { ErroNotaDoPedido, travarEmissao, definirComNotaFiscal, alterarObservacao, OBSERVACAO_MAX };
