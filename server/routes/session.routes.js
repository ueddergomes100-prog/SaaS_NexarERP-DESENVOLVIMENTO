const express = require('express');
const { admin, db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { ipDoCliente } = require('../utils/requestIp');
const { trustProxyHops } = require('../services/configuracaoAmbiente');

const router = express.Router();

/**
 * Corpo do encerramento de sessao.
 *
 * O `express.json()` global nao pega este: quem fecha o PWA manda por
 * `navigator.sendBeacon`, que so envia tipos simples de CORS -- `text/plain`.
 * Pedir `application/json` obrigaria um preflight OPTIONS, e ele nao da tempo
 * de acontecer com a janela morrendo. Aqui o texto vira JSON na mao.
 */
const lerCorpoDoEncerramento = (req) => {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body || {};
};

/**
 * Quem esta encerrando: o token vem do cabecalho (fetch normal) OU do corpo
 * (beacon, que nao aceita cabecalho). Nos dois casos e' o mesmo ID token do
 * Firebase, verificado do mesmo jeito -- nao ha caminho sem autenticacao.
 */
const autenticarEncerramento = async (req, corpo) => {
  const authHeader = req.headers.authorization || '';
  const tokenDoCabecalho = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  const token = tokenDoCabecalho || (typeof corpo.token === 'string' ? corpo.token : '');

  if (!token) {
    return null;
  }

  try {
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    console.warn('Token invalido no encerramento de sessao:', error.message);
    return null;
  }
};

/**
 * Encerrar a sessao fica ANTES do `authenticate` de proposito: aquele
 * middleware exige o cabecalho Authorization, que o beacon do fechamento nao
 * tem como mandar. A verificacao do token continua acontecendo, logo abaixo.
 */
router.post('/end', express.text({ type: 'text/plain', limit: '8kb' }), async (req, res) => {
  try {
    if (!db || !admin) {
      return res.status(503).json({ error: 'Firebase Admin SDK nao configurado no backend.' });
    }

    const corpo = lerCorpoDoEncerramento(req);
    const { sessionId, reason } = corpo;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId invalido.' });
    }

    const usuarioAutenticado = await autenticarEncerramento(req, corpo);
    if (!usuarioAutenticado) {
      return res.status(401).json({ error: 'Nao autorizado. Token expirado ou invalido.' });
    }

    const userRef = db.collection('usuarios').doc(usuarioAutenticado.uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.json({ ok: true, cleared: false });
    }

    const userData = userSnap.data();
    if (userData.activeSessionId !== sessionId) {
      return res.json({ ok: true, cleared: false });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await userRef.update({
      activeSessionId: null,
      'activeSession.lastSeenAt': now,
      'activeSession.endedAt': now,
      'activeSession.closedBy': typeof reason === 'string' ? reason : 'browser_close',
      lastSessionEndedAt: now
    });

    return res.json({ ok: true, cleared: true });
  } catch (error) {
    console.error('Erro ao encerrar sessao ativa:', error);
    return res.status(500).json({ error: 'Nao foi possivel encerrar a sessao.' });
  }
});

router.use(authenticate);

router.get('/client-info', (req, res) => {
  res.json({
    ip: ipDoCliente(req),
    userAgent: req.get('user-agent') || '',
    // Diagnostico do `trust proxy` (ver server.js): a cadeia inteira que o
    // Express viu e quantos saltos ele confia. Se `ip` vier interno da
    // hospedagem em vez do IP publico de quem chamou, TRUST_PROXY_HOPS esta errado.
    cadeiaDeProxies: Array.isArray(req.ips) ? req.ips : [],
    proxyHops: trustProxyHops()
  });
});

module.exports = router;
