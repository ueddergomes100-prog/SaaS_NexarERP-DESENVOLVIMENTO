const express = require('express');
const { authenticate } = require('../middleware/auth');
const s = require('../services/entregaFutura');
const { PERMISSAO_ENTREGAS_FUTURAS } = require('../domain/entregaFuturaDomain');

/*
 * Venda com entrega futura -- entregas (23/10/2026). Tudo pelo servidor:
 * listar pendentes, detalhe do pedido, registrar entrega (estoque + remessa
 * + rota), emitir a remessa de novo e colocar na rota.
 */
const router = express.Router();
router.use(authenticate);

const tem = (user) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(PERMISSAO_ENTREGAS_FUTURAS)),
);
const SEM_PERMISSAO = 'Você não tem permissão para registrar entregas futuras. Peça a um responsável liberar "Expedição: Entregas futuras" no seu usuário.';

const rota = (oQue, fn) => async (req, res) => {
  try {
    if (!tem(req.user)) return res.status(403).json({ error: SEM_PERMISSAO });
    return res.json({ ok: true, ...(await fn(req)) });
  } catch (erro) {
    if (erro instanceof s.ErroEntregaFutura || (erro && erro.status && erro.message)) return res.status(erro.status).json({ error: erro.message });
    console.error(`[Entregas futuras] erro ao ${oQue}:`, erro);
    return res.status(500).json({ error: `Não foi possível ${oQue}. Tente de novo em instantes.` });
  }
};

router.get('/pendentes', rota('carregar as entregas pendentes', async (req) => ({ pedidos: await s.listarPendentes({ tenantId: req.user.tenantId }) })));
router.get('/:pedidoId', rota('carregar o pedido', async (req) => s.detalhe({ tenantId: req.user.tenantId, pedidoId: req.params.pedidoId })));
router.post('/:pedidoId/entregar', rota('registrar a entrega', async (req) => s.entregar({ user: req.user, tenantId: req.user.tenantId, pedidoId: req.params.pedidoId, corpo: req.body || {} })));
router.post('/entregas/:entregaId/emitir-nota', rota('emitir a nota de remessa', async (req) => s.emitirRemessa({ user: req.user, tenantId: req.user.tenantId, entregaId: req.params.entregaId })));
router.post('/entregas/:entregaId/rota', rota('colocar a entrega na rota', async (req) => s.colocarEntregaNaRota({ user: req.user, tenantId: req.user.tenantId, entregaId: req.params.entregaId, romaneioId: String((req.body || {}).romaneioId || '') })));

module.exports = router;
