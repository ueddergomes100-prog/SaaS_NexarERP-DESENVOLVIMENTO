const express = require('express');
const nodemailer = require('nodemailer');
const { authenticate } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const { resolveTenantId } = require('../services/spedyAcesso');
const { opcoesDoTransporte } = require('../services/emailNota');
const { ErroEnvioContador, enviarAoContador } = require('../services/envioContador');

/**
 * RELATORIO DO CONTADOR, fase 2 (20/10/2026): envia o PDF e o .zip dos XMLs ao
 * contador pelo SMTP da empresa. Montado em server.js ANTES do express.json
 * global (2 MB): os anexos chegam em base64 e passam disso.
 */
const router = express.Router();
router.use(express.json({ limit: '26mb' }));
router.use(authenticate);

const porUsuario = (req) => (req.user && req.user.uid) || req.ip;
const limite = limitadorPorChave('envio-contador', porUsuario, {
  limite: 20,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitos envios ao contador em pouco tempo. Aguarde alguns minutos.',
});

router.post('/enviar', limite, async (req, res) => {
  try {
    const r = await enviarAoContador({
      user: req.user,
      tenantId: resolveTenantId(req),
      corpo: req.body,
      criarTransporte: (smtp) => nodemailer.createTransport(opcoesDoTransporte(smtp)),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    if (erro instanceof ErroEnvioContador) return res.status(erro.status).json({ error: erro.message });
    console.error('[Envio ao contador]', erro);
    return res.status(500).json({ error: 'Não foi possível enviar ao contador. Tente de novo em instantes.' });
  }
});

module.exports = router;
