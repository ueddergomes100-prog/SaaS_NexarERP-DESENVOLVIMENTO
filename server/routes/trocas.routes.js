const express = require('express');
const { authenticate } = require('../middleware/auth');
const { admin, db } = require('../config/firebase');
const { registrarLog } = require('../services/auditoria');
const {
  DIAS_HISTORICO_PADRAO,
  STATUS_TROCA,
  normalizarObservacao,
  erroDeTransicao,
  validarItensDoPedido,
  montarItensDaTroca,
  avisosDeHistorico,
  planoDeReserva,
  planoDeLiberacao,
  planoDeEntrega,
} = require('../services/trocas');

const router = express.Router();
router.use(authenticate);

/**
 * TROCAS -- ver services/trocas.js e docs/PLANO_TROCAS_VENDEDOR.md.
 *
 * Toda escrita em `trocas` e todo movimento de estoque da troca acontece AQUI,
 * com o Admin SDK. As firestore.rules deixam a colecao so' pra leitura: o app do
 * vendedor nunca escreve em `trocas` nem em `estoque` (nada pode ser alterado
 * pelo DevTools). O tenant sai sempre do token de quem chamou.
 */

class ErroTroca extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TIMESTAMP = () => admin.firestore.FieldValue.serverTimestamp();

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroTroca) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Trocas] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente em instantes.' });
};

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
);

const exigirSolicitar = (user) => {
  if (!temPermissao(user, 'vendas.troca_solicitar')) {
    throw new ErroTroca(403, 'Seu usuário não tem permissão para pedir troca. Peça ao administrador para liberar "Trocas" no seu cadastro.');
  }
};

const exigirGerenciar = (user) => {
  if (!temPermissao(user, 'vendas.troca_gerenciar')) {
    throw new ErroTroca(403, 'Seu usuário não tem permissão para gerenciar trocas. Peça ao administrador para liberar "Trocas: gerenciar" no seu cadastro.');
  }
};

const nomeDoUsuario = async (user) => {
  const snap = await db.collection('usuarios').doc(user.uid).get();
  const d = snap.exists ? snap.data() : {};
  return String(d.nome || d.nomeResponsavel || user.email || user.uid);
};

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------

const carregarCliente = async (tenantId, clienteId) => {
  const id = String(clienteId || '').trim();
  if (!id) throw new ErroTroca(400, 'Selecione o cliente da troca.');
  const snap = await db.collection('clientes').doc(id).get();
  if (!snap.exists || snap.data().tenantId !== tenantId || snap.data().ativo === false) {
    throw new ErroTroca(400, 'O cliente não foi encontrado (ou está inativo). Escolha o cliente de novo.');
  }
  return { id: snap.id, ...snap.data() };
};

/** Produtos da empresa pelos ids; de outra empresa conta como inexistente. */
const carregarProdutos = async (tenantId, ids) => {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return {};
  const snaps = await db.getAll(...unicos.map((id) => db.collection('estoque').doc(id)));
  const mapa = {};
  snaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantId) mapa[s.id] = s.data(); });
  return mapa;
};

const carregarPedidosDoCliente = async (tenantId, clienteId) => {
  const snap = await db.collection('pedidos_venda').where('tenantId', '==', tenantId).where('clienteId', '==', clienteId).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return { status: x.status, dataVenda: x.dataVenda, createdAt: x.createdAt, itens: Array.isArray(x.itens) ? x.itens.map((i) => ({ id: i.id })) : [] };
  });
};

/** Confere o pedido do app e monta a troca com os dados do CADASTRO. */
const prepararPedido = async (req) => {
  exigirSolicitar(req.user);
  const tenantId = req.user.tenantId;
  const validacao = validarItensDoPedido(req.body?.itens);
  if (validacao.erros.length > 0) return { ok: false, erros: validacao.erros, avisos: [], itens: [] };

  const cliente = await carregarCliente(tenantId, req.body?.clienteId);
  const produtosPorId = await carregarProdutos(tenantId, validacao.itens.map((i) => i.id));
  const montagem = montarItensDaTroca({ itens: validacao.itens, produtosPorId });
  if (montagem.erros.length > 0) return { ok: false, erros: montagem.erros, avisos: [], itens: [] };

  const pedidosDoCliente = await carregarPedidosDoCliente(tenantId, cliente.id);
  const avisos = avisosDeHistorico({ itens: montagem.itens, pedidosDoCliente, agora: new Date(), dias: DIAS_HISTORICO_PADRAO });
  return { ok: true, erros: [], avisos, itens: montagem.itens, cliente, tenantId };
};

const carregarConfiguracao = async (tx, tenantId) => {
  const snap = await tx.get(db.collection('configuracoes').doc(tenantId));
  return snap.exists ? snap.data() : {};
};

const permiteSemEstoque = (config) => config.permiteVendaSemEstoque === true;

/** Le a troca (e confere que e' da empresa) dentro da transacao. */
const lerTroca = async (tx, tenantId, id) => {
  const ref = db.collection('trocas').doc(String(id || ''));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroTroca(404, 'Troca não encontrada.');
  return { ref, troca: { id: snap.id, ...snap.data() } };
};

const lerProdutosNaTransacao = async (tx, tenantId, itens) => {
  const ids = [...new Set(itens.map((i) => i.id))];
  const refs = ids.map((id) => db.collection('estoque').doc(id));
  const snaps = refs.length ? await tx.getAll(...refs) : [];
  const produtosPorId = {};
  snaps.forEach((s) => { if (s.exists && s.data().tenantId === tenantId) produtosPorId[s.id] = s.data(); });
  return { produtosPorId, refs: Object.fromEntries(refs.map((r) => [r.id, r])) };
};

const entradaDeHistorico = (status, user, nome, extra = {}) => ({
  status,
  em: new Date().toISOString(),
  por: user.uid,
  porNome: nome,
  ...extra,
});

// ---------------------------------------------------------------------------
// Vendedor: previa e pedido
// ---------------------------------------------------------------------------

/** Mostra os avisos (ex.: "cliente nao comprou X nos ultimos 60 dias") antes de enviar. Nao grava nada. */
router.post('/previa', async (req, res) => {
  try {
    const preparo = await prepararPedido(req);
    return res.json({ ok: preparo.ok, erros: preparo.erros, avisos: preparo.avisos, itens: preparo.itens });
  } catch (erro) {
    return responderErro(res, erro, 'previa');
  }
});

/** Cria a troca (Solicitada). `idDocumento` (o id do rascunho) torna reenviar seguro: nao duplica. */
router.post('/solicitar', async (req, res) => {
  try {
    const preparo = await prepararPedido(req);
    if (!preparo.ok) throw new ErroTroca(400, preparo.erros.join(' '));
    const { tenantId, cliente, itens, avisos } = preparo;
    const user = req.user;
    const nome = await nomeDoUsuario(user);

    const idBruto = String(req.body?.idDocumento || '').trim();
    if (idBruto && !/^[A-Za-z0-9_-]{8,64}$/.test(idBruto)) {
      throw new ErroTroca(400, 'Identificador do rascunho inválido. Salve o rascunho de novo e reenvie.');
    }
    const ref = idBruto ? db.collection('trocas').doc(idBruto) : db.collection('trocas').doc();
    const observacao = normalizarObservacao(req.body?.observacao);
    let resultado;

    await db.runTransaction(async (tx) => {
      const existente = await tx.get(ref);
      if (existente.exists) {
        if (existente.data().tenantId !== tenantId) throw new ErroTroca(409, 'Este rascunho já foi usado por outra empresa. Salve o rascunho de novo e reenvie.');
        resultado = { id: ref.id, numeroTroca: existente.data().numeroTroca, jaEnviada: true };
        return;
      }
      const seqRef = db.collection('contadores').doc(tenantId).collection('sequencias').doc('trocas');
      const seqSnap = await tx.get(seqRef);
      const proximo = (seqSnap.exists ? Number(seqSnap.data().valor) || 0 : 0) + 1;
      const numeroTroca = String(proximo).padStart(4, '0');
      tx.set(seqRef, { tenantId, chave: 'trocas', valor: proximo, updatedAt: TIMESTAMP() }, { merge: true });
      tx.set(ref, {
        numeroTroca,
        clienteId: cliente.id,
        clienteNome: String(cliente.nome || ''),
        ...(cliente.telefone ? { clienteTelefone: String(cliente.telefone) } : {}),
        itens,
        observacao,
        status: STATUS_TROCA.SOLICITADA,
        avisos,
        estoqueReservado: false,
        historico: [entradaDeHistorico(STATUS_TROCA.SOLICITADA, user, nome)],
        vendedorId: user.uid,
        vendedorNome: nome,
        usuarioResponsavelId: user.uid,
        tenantId,
        createdAt: TIMESTAMP(),
        criadoPor: user.uid,
        criadoEm: TIMESTAMP(),
        alteradoPor: user.uid,
        alteradoEm: TIMESTAMP(),
      });
      resultado = { id: ref.id, numeroTroca, jaEnviada: false };
    });

    if (!resultado.jaEnviada) {
      registrarLog(user, { modulo: 'trocas', acao: 'solicitacao', descricao: `Troca #${resultado.numeroTroca} solicitada para ${cliente.nome} (${itens.length} ${itens.length === 1 ? 'item' : 'itens'}).`, registroId: resultado.id });
    }
    return res.json({ ok: true, ...resultado, avisos });
  } catch (erro) {
    return responderErro(res, erro, 'solicitar');
  }
});

// ---------------------------------------------------------------------------
// Loja: aprovar, recusar, cancelar, entregar
// ---------------------------------------------------------------------------

router.post('/:id/aprovar', async (req, res) => {
  try {
    exigirGerenciar(req.user);
    const user = req.user;
    const nome = await nomeDoUsuario(user);
    let resumo;
    await db.runTransaction(async (tx) => {
      const { ref, troca } = await lerTroca(tx, user.tenantId, req.params.id);
      const erroEstado = erroDeTransicao(troca.status, STATUS_TROCA.APROVADA);
      if (erroEstado) throw new ErroTroca(409, erroEstado);
      const config = await carregarConfiguracao(tx, user.tenantId);
      const { produtosPorId, refs } = await lerProdutosNaTransacao(tx, user.tenantId, troca.itens);

      const plano = planoDeReserva({ itens: troca.itens, produtosPorId, permiteSemEstoque: permiteSemEstoque(config) });
      if (!plano.ok) throw new ErroTroca(409, plano.erros.join(' '));

      plano.reservas.forEach((r) => tx.update(refs[r.id], { quantidadeReservada: r.reservadaDepois, updatedAt: TIMESTAMP() }));
      tx.update(ref, {
        status: STATUS_TROCA.APROVADA,
        estoqueReservado: true,
        aprovadoPor: user.uid,
        aprovadoPorNome: nome,
        aprovadoEm: TIMESTAMP(),
        historico: [...(troca.historico || []), entradaDeHistorico(STATUS_TROCA.APROVADA, user, nome)],
        alteradoPor: user.uid,
        alteradoEm: TIMESTAMP(),
      });
      resumo = { numeroTroca: troca.numeroTroca, clienteNome: troca.clienteNome };
    });
    registrarLog(user, { modulo: 'trocas', acao: 'aprovacao', descricao: `Troca #${resumo.numeroTroca} de ${resumo.clienteNome} aprovada (estoque reservado).`, registroId: req.params.id });
    return res.json({ ok: true, status: STATUS_TROCA.APROVADA });
  } catch (erro) {
    return responderErro(res, erro, 'aprovar');
  }
});

router.post('/:id/recusar', async (req, res) => {
  try {
    exigirGerenciar(req.user);
    const motivo = String(req.body?.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (motivo.length < 5) throw new ErroTroca(400, 'Informe o motivo da recusa (o vendedor vai ver no aplicativo).');
    const user = req.user;
    const nome = await nomeDoUsuario(user);
    let resumo;
    await db.runTransaction(async (tx) => {
      const { ref, troca } = await lerTroca(tx, user.tenantId, req.params.id);
      const erroEstado = erroDeTransicao(troca.status, STATUS_TROCA.RECUSADA);
      if (erroEstado) throw new ErroTroca(409, erroEstado);
      tx.update(ref, {
        status: STATUS_TROCA.RECUSADA,
        motivoRecusa: motivo,
        recusadoPor: user.uid,
        recusadoPorNome: nome,
        recusadoEm: TIMESTAMP(),
        historico: [...(troca.historico || []), entradaDeHistorico(STATUS_TROCA.RECUSADA, user, nome, { motivo })],
        alteradoPor: user.uid,
        alteradoEm: TIMESTAMP(),
      });
      resumo = { numeroTroca: troca.numeroTroca, clienteNome: troca.clienteNome };
    });
    registrarLog(user, { modulo: 'trocas', acao: 'recusa', descricao: `Troca #${resumo.numeroTroca} de ${resumo.clienteNome} recusada: ${motivo}`, registroId: req.params.id });
    return res.json({ ok: true, status: STATUS_TROCA.RECUSADA });
  } catch (erro) {
    return responderErro(res, erro, 'recusar');
  }
});

/** Cancela. A loja cancela em Solicitada ou Aprovada (libera a reserva); o vendedor so' a propria, ainda Solicitada. */
router.post('/:id/cancelar', async (req, res) => {
  try {
    const user = req.user;
    const nome = await nomeDoUsuario(user);
    const motivo = String(req.body?.motivo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    let resumo;
    await db.runTransaction(async (tx) => {
      const { ref, troca } = await lerTroca(tx, user.tenantId, req.params.id);
      const ehDono = troca.vendedorId === user.uid && troca.status === STATUS_TROCA.SOLICITADA && temPermissao(user, 'vendas.troca_solicitar');
      if (!ehDono) exigirGerenciar(user);
      const erroEstado = erroDeTransicao(troca.status, STATUS_TROCA.CANCELADA);
      if (erroEstado) throw new ErroTroca(409, erroEstado);

      let produtosLidos = null;
      if (troca.estoqueReservado === true) produtosLidos = await lerProdutosNaTransacao(tx, user.tenantId, troca.itens);
      if (produtosLidos) {
        planoDeLiberacao({ itens: troca.itens, produtosPorId: produtosLidos.produtosPorId })
          .forEach((l) => tx.update(produtosLidos.refs[l.id], { quantidadeReservada: l.reservadaDepois, updatedAt: TIMESTAMP() }));
      }
      tx.update(ref, {
        status: STATUS_TROCA.CANCELADA,
        estoqueReservado: false,
        ...(motivo ? { motivoCancelamento: motivo } : {}),
        canceladoPor: user.uid,
        canceladoPorNome: nome,
        canceladoEm: TIMESTAMP(),
        historico: [...(troca.historico || []), entradaDeHistorico(STATUS_TROCA.CANCELADA, user, nome, motivo ? { motivo } : {})],
        alteradoPor: user.uid,
        alteradoEm: TIMESTAMP(),
      });
      resumo = { numeroTroca: troca.numeroTroca, clienteNome: troca.clienteNome, liberouReserva: troca.estoqueReservado === true };
    });
    registrarLog(user, { modulo: 'trocas', acao: 'cancelamento', descricao: `Troca #${resumo.numeroTroca} de ${resumo.clienteNome} cancelada${resumo.liberouReserva ? ' (reserva de estoque liberada)' : ''}${motivo ? `: ${motivo}` : ''}.`, registroId: req.params.id });
    return res.json({ ok: true, status: STATUS_TROCA.CANCELADA });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar');
  }
});

/** Confirma a entrega: baixa o estoque (UMA vez) e grava um ajuste de saida por item. */
router.post('/:id/entregar', async (req, res) => {
  try {
    exigirGerenciar(req.user);
    const user = req.user;
    const nome = await nomeDoUsuario(user);
    const lotesEscolhidos = {};
    for (const [indice, loteId] of Object.entries(req.body?.lotes || {})) {
      if (Number.isInteger(Number(indice)) && loteId) lotesEscolhidos[Number(indice)] = String(loteId);
    }
    let resumo;
    await db.runTransaction(async (tx) => {
      const { ref, troca } = await lerTroca(tx, user.tenantId, req.params.id);
      const erroEstado = erroDeTransicao(troca.status, STATUS_TROCA.ENTREGUE);
      if (erroEstado) throw new ErroTroca(409, erroEstado);
      const config = await carregarConfiguracao(tx, user.tenantId);
      const { produtosPorId, refs } = await lerProdutosNaTransacao(tx, user.tenantId, troca.itens);

      const idsLotes = [...new Set(Object.values(lotesEscolhidos))];
      const loteRefs = idsLotes.map((id) => db.collection('estoque_lotes').doc(id));
      const loteSnaps = loteRefs.length ? await tx.getAll(...loteRefs) : [];
      const lotesPorId = {};
      loteSnaps.forEach((s) => { if (s.exists && s.data().tenantId === user.tenantId) lotesPorId[s.id] = s.data(); });

      const plano = planoDeEntrega({
        itens: troca.itens,
        produtosPorId,
        lotesEscolhidos,
        lotesPorId,
        estavaReservado: troca.estoqueReservado === true,
        contexto: {
          tenantId: user.tenantId,
          trocaId: troca.id,
          numeroTroca: troca.numeroTroca,
          clienteNome: troca.clienteNome,
          usuarioId: user.uid,
          usuarioNome: nome,
          permiteSemEstoque: permiteSemEstoque(config),
        },
      });
      if (!plano.ok) throw new ErroTroca(409, plano.erros.join(' '));

      plano.produtos.forEach((p) => tx.update(refs[p.id], { quantidade: p.quantidadeDepois, quantidadeReservada: p.reservadaDepois, updatedAt: TIMESTAMP() }));
      plano.lotes.forEach((l) => tx.update(db.collection('estoque_lotes').doc(l.id), { quantidade: l.saldoDepois, updatedAt: TIMESTAMP() }));
      plano.ajustes.forEach((a) => tx.set(db.collection('ajustes_estoque').doc(), { ...a, createdAt: TIMESTAMP() }));
      tx.update(ref, {
        status: STATUS_TROCA.ENTREGUE,
        itens: plano.itensFinais,
        custoTotalCentavos: plano.custoTotalCentavos,
        estoqueReservado: false,
        entreguePor: user.uid,
        entreguePorNome: nome,
        entregueEm: TIMESTAMP(),
        historico: [...(troca.historico || []), entradaDeHistorico(STATUS_TROCA.ENTREGUE, user, nome)],
        alteradoPor: user.uid,
        alteradoEm: TIMESTAMP(),
      });
      resumo = { numeroTroca: troca.numeroTroca, clienteNome: troca.clienteNome, custoTotalCentavos: plano.custoTotalCentavos };
    });
    registrarLog(user, { modulo: 'trocas', acao: 'entrega', descricao: `Troca #${resumo.numeroTroca} de ${resumo.clienteNome} entregue (estoque baixado).`, registroId: req.params.id });
    return res.json({ ok: true, status: STATUS_TROCA.ENTREGUE, custoTotalCentavos: resumo.custoTotalCentavos });
  } catch (erro) {
    return responderErro(res, erro, 'entregar');
  }
});

module.exports = router;
