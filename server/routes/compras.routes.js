const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const compras = require('../services/compras');

/**
 * COMPRAS (22/10/2026) -- ver services/compras.js. Tudo com login:
 *   POST /api/compras/cotacoes                     cria
 *   POST /api/compras/cotacoes/:id                 altera (aberta)
 *   POST /api/compras/cotacoes/:id/cancelar | /fechar
 *   POST /api/compras/cotacoes/:id/gerar-pedidos   { escolhas: { produtoId: fornecedorId } }
 *   POST /api/compras/pedidos                      cria a mao
 *   POST /api/compras/pedidos/:id                  altera (aberto)
 *   POST /api/compras/pedidos/:id/status           { status: enviado | recebido | cancelado }
 * Permissoes: "Compras: Cotação de Compra" e "Compras: Pedidos de Compra" (dono/gestor sempre).
 * O link do fornecedor (sem login) fica em cotacaoPublica.routes.js.
 */
const router = express.Router();
router.use(authenticate);

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
);

const exigir = (permissao, rotulo) => (req, res, next) => {
  if (temPermissao(req.user, permissao)) return next();
  return res.status(403).json({ error: `Você não tem permissão para ${rotulo}. Peça a um responsável liberar "Compras" no seu usuário.` });
};

const responderErro = (res, erro, acao) => {
  if (erro instanceof compras.ErroCompras) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Compras] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Nada foi alterado. Tente de novo em instantes.` });
};

const reais = (centavos) => `R$ ${(Number(centavos) / 100).toFixed(2).replace('.', ',')}`;
const log = (req, acao, descricao, registroId) => registrarLog(req.user, { modulo: 'compras', acao, descricao, registroId });

const cotacoes = exigir('compras.cotacoes', 'cotação de compra');
const pedidos = exigir('compras.pedidos', 'pedidos de compra');

router.post('/cotacoes', cotacoes, async (req, res) => {
  try {
    const r = await compras.criarCotacao({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    log(req, 'criacao', `Cotação de compra nº ${r.numero} criada (${(req.body?.itens || []).length} item(ns), ${(req.body?.fornecedores || []).length} fornecedor(es)).`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'criar a cotação');
  }
});

router.post('/cotacoes/:id/cancelar', cotacoes, async (req, res) => {
  try {
    const r = await compras.mudarStatusCotacao({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, status: 'cancelada' });
    log(req, 'cancelamento', `Cotação de compra nº ${r.numero} cancelada.`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a cotação');
  }
});

router.post('/cotacoes/:id/fechar', cotacoes, async (req, res) => {
  try {
    const r = await compras.mudarStatusCotacao({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, status: 'fechada' });
    log(req, 'edicao', `Cotação de compra nº ${r.numero} fechada sem gerar pedido.`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'fechar a cotação');
  }
});

router.post('/cotacoes/:id/gerar-pedidos', cotacoes, async (req, res) => {
  try {
    const r = await compras.gerarPedidosDaCotacao({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, corpo: req.body || {} });
    log(req, 'criacao', `Cotação nº ${r.numeroCotacao}: ${r.pedidos.map((p) => `pedido de compra nº ${p.numero} para ${p.fornecedorNome} (${reais(p.totalCentavos)})`).join('; ')}.`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'gerar os pedidos de compra');
  }
});

router.post('/cotacoes/:id', cotacoes, async (req, res) => {
  try {
    const r = await compras.editarCotacao({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, corpo: req.body || {} });
    log(req, 'edicao', `Cotação de compra nº ${r.numero} alterada.`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'alterar a cotação');
  }
});

router.post('/pedidos', pedidos, async (req, res) => {
  try {
    const r = await compras.criarPedido({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    log(req, 'criacao', `Pedido de compra nº ${r.numero} criado para ${String(req.body?.fornecedorNome || '')} (${reais(r.totalCentavos)}).`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'criar o pedido de compra');
  }
});

router.post('/pedidos/:id/status', pedidos, async (req, res) => {
  try {
    const r = await compras.mudarStatusPedido({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, status: String(req.body?.status || '') });
    log(req, r.status === 'cancelado' ? 'cancelamento' : 'edicao', `Pedido de compra nº ${r.numero}: ${r.status}.`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'mudar a situação do pedido');
  }
});

router.post('/pedidos/:id', pedidos, async (req, res) => {
  try {
    const r = await compras.editarPedido({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, corpo: req.body || {} });
    log(req, 'edicao', `Pedido de compra nº ${r.numero} alterado (${reais(r.totalCentavos)}).`, r.id);
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'alterar o pedido de compra');
  }
});

module.exports = router;
