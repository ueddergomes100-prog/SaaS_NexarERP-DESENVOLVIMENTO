const express = require('express');
const { authenticate } = require('../middleware/auth');
const { configPublica, registrarDispositivo, removerDispositivo, testarAviso } = require('../services/notificacoesPush');

/**
 * AVISOS NO CELULAR (21/10/2026) -- ver services/notificacoesPush.js.
 *   GET    /api/notificacoes/config       chave publica (VAPID) e se os avisos estao ligados
 *   POST   /api/notificacoes/dispositivo  { token, plataforma } registra o aparelho de quem esta logado
 *   DELETE /api/notificacoes/dispositivo  { token } tira o aparelho (desligou os avisos)
 */
const router = express.Router();
router.use(authenticate);

router.get('/config', (req, res) => res.json(configPublica()));

router.post('/dispositivo', async (req, res) => {
  try {
    return res.json(await registrarDispositivo({ user: req.user, tenantId: req.user.tenantId, token: req.body?.token, plataforma: req.body?.plataforma }));
  } catch (erro) {
    if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
    console.error('[Avisos] erro ao registrar o aparelho:', erro);
    return res.status(500).json({ error: 'Não foi possível ativar os avisos agora. Tente de novo em instantes.' });
  }
});

/** POST /api/notificacoes/teste -- manda um aviso de teste para os aparelhos de quem chamou. */
router.post('/teste', async (req, res) => {
  try {
    return res.json(await testarAviso({ user: req.user, tenantId: req.user.tenantId }));
  } catch (erro) {
    console.error('[Avisos] erro no aviso de teste:', erro);
    return res.status(500).json({ error: 'Não foi possível mandar o aviso de teste agora. Tente de novo em instantes.' });
  }
});

router.delete('/dispositivo', async (req, res) => {
  try {
    return res.json(await removerDispositivo({ user: req.user, token: req.body?.token }));
  } catch (erro) {
    console.error('[Avisos] erro ao remover o aparelho:', erro);
    return res.status(500).json({ error: 'Não foi possível desligar os avisos agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
