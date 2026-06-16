const express = require('express');
const { admin, db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const getRequestIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || '').split(',')[0].trim();

  return (rawIp || req.socket.remoteAddress || req.ip || '')
    .replace(/^::ffff:/, '')
    .replace(/^::1$/, '127.0.0.1');
};

router.use(authenticate);

router.get('/client-info', (req, res) => {
  res.json({
    ip: getRequestIp(req),
    userAgent: req.get('user-agent') || ''
  });
});

router.post('/end', async (req, res) => {
  try {
    if (!db || !admin) {
      return res.status(503).json({ error: 'Firebase Admin SDK nao configurado no backend.' });
    }

    const { sessionId, reason } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId invalido.' });
    }

    const userRef = db.collection('usuarios').doc(req.user.uid);
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

module.exports = router;
