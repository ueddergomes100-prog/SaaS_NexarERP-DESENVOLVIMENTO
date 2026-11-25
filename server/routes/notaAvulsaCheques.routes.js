const express = require('express');
const { authenticate } = require('../middleware/auth');
const { hojeNoBrasil } = require('../services/baixaFinanceira');
const { chequesNaCarteira, repassarNaNotaAvulsa, desfazerRepasseDaNotaAvulsa } = require('../services/repasseCheques');

/**
 * NOTA AVULSA PAGA COM CHEQUE DE CLIENTE (25/11/2026) -- ver services/repasseCheques.js.
 * Empresa sempre do token; permissao "estoque.nota_avulsa_cheque_cliente".
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, acao) => {
  if (erro && Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 500) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Nota avulsa cheques] ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Tente de novo em instantes.` });
};

/** GET /api/nota-avulsa/cheques-na-carteira */
router.get('/cheques-na-carteira', async (req, res) => {
  try {
    return res.json({ cheques: await chequesNaCarteira({ user: req.user, tenantId: req.user.tenantId }) });
  } catch (erro) {
    return responderErro(res, erro, 'listar os cheques da carteira');
  }
});

/** POST /api/nota-avulsa/:id/repassar-cheques */
router.post('/:id/repassar-cheques', async (req, res) => {
  try {
    return res.json({ ok: true, ...(await repassarNaNotaAvulsa({ user: req.user, tenantId: req.user.tenantId, notaAvulsaId: req.params.id, hoje: hojeNoBrasil() })) });
  } catch (erro) {
    return responderErro(res, erro, 'repassar os cheques');
  }
});

/** POST /api/nota-avulsa/:id/desfazer-repasse */
router.post('/:id/desfazer-repasse', async (req, res) => {
  try {
    return res.json({ ok: true, ...(await desfazerRepasseDaNotaAvulsa({ user: req.user, tenantId: req.user.tenantId, notaAvulsaId: req.params.id })) });
  } catch (erro) {
    return responderErro(res, erro, 'desfazer o repasse dos cheques');
  }
});

module.exports = router;
