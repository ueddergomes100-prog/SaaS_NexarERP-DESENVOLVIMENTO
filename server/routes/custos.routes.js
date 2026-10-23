const express = require('express');
const { authenticate } = require('../middleware/auth');
const s = require('../services/custos');
const { PERMISSAO_CUSTOS } = require('../domain/custosDomain');

/* Custos e formacao de preco (23/10/2026): configuracao, resumo e simulacao. */
const router = express.Router();
router.use(authenticate);

const tem = (user) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(PERMISSAO_CUSTOS)),
);

const rota = (oQue, fn) => async (req, res) => {
  try {
    if (!tem(req.user)) return res.status(403).json({ error: 'Você não tem permissão para ver os custos da empresa. Peça a um responsável liberar "Financeiro: Custos e Formação de Preço" no seu usuário.' });
    return res.json({ ok: true, ...(await fn(req)) });
  } catch (erro) {
    if (erro instanceof s.ErroCustos || (erro && erro.status && erro.message)) return res.status(erro.status).json({ error: erro.message });
    console.error(`[Custos] erro ao ${oQue}:`, erro);
    return res.status(500).json({ error: `Não foi possível ${oQue}. Tente de novo em instantes.` });
  }
};

router.get('/', rota('carregar os custos', async (req) => s.carregar({ tenantId: req.user.tenantId })));
router.post('/', rota('salvar os custos', async (req) => s.salvar({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} })));
router.get('/simulacao', rota('simular os preços', async (req) => s.simular({ tenantId: req.user.tenantId })));

module.exports = router;
