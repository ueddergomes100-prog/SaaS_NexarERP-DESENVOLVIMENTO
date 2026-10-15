const express = require('express');
const { admin, db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { ErroTrava, pegarTrava, renovarTrava, soltarTrava, liberarTrava } = require('../services/travasEdicao');
const { ROTULO_DO_TIPO } = require('../domain/travaEdicaoDomain');

/**
 * TRAVA DE EDICAO (15/10/2026) -- ver services/travasEdicao.js.
 *   POST /api/travas/pegar     abrir o documento (409 se outra pessoa esta com ele)
 *   POST /api/travas/renovar   "continuo aqui", a cada 30 s
 *   POST /api/travas/soltar    fechou a tela (aceita beacon: token no corpo)
 *   POST /api/travas/liberar   dono/administrador/gerente libera na hora
 */
const router = express.Router();

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroTrava) return res.status(erro.status).json({ error: erro.message, ...erro.extra });
  console.error(`[Travas] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Tente de novo em instantes.` });
};

/**
 * Soltar fica ANTES do `authenticate`: quem fecha a janela manda por
 * `navigator.sendBeacon`, que nao aceita cabecalho (mesmo motivo de
 * /api/sessions/end). O token vem no corpo e e' verificado do mesmo jeito.
 */
router.post('/soltar', express.text({ type: 'text/plain', limit: '8kb' }), async (req, res) => {
  let corpo = req.body || {};
  if (typeof corpo === 'string') {
    try { corpo = JSON.parse(corpo); } catch { corpo = {}; }
  }
  const cabecalho = req.headers.authorization || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : (typeof corpo.token === 'string' ? corpo.token : '');
  if (!token) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  try {
    const { uid } = await admin.auth().verifyIdToken(token);
    return res.json(await soltarTrava({ uid, tenantId: corpo.tenantId, corpo }));
  } catch (erro) {
    if (erro instanceof ErroTrava) return res.status(erro.status).json({ error: erro.message });
    return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  }
});

router.use(authenticate);

router.post('/pegar', async (req, res) => {
  try {
    return res.json(await pegarTrava({ user: req.user, corpo: req.body || {} }));
  } catch (erro) {
    return responderErro(res, erro, 'abrir o documento');
  }
});

router.post('/renovar', async (req, res) => {
  try {
    return res.json(await renovarTrava({ user: req.user, corpo: req.body || {} }));
  } catch (erro) {
    return responderErro(res, erro, 'confirmar que a tela continua aberta');
  }
});

router.post('/liberar', async (req, res) => {
  try {
    // Gerente (nivel de acesso) tambem libera, como ja' administra a equipe.
    let gerente = false;
    if (!req.user.isTenantManager && !req.user.isPlatformAdmin) {
      const perfil = await db.collection('usuarios').doc(req.user.uid).get();
      gerente = perfil.exists && perfil.data().nivelAcesso === 'gerente';
    }
    const podeLiberar = req.user.isTenantManager || req.user.isPlatformAdmin || gerente;
    const r = await liberarTrava({ user: req.user, corpo: req.body || {}, podeLiberar });
    if (r.liberou) {
      registrarLog(req.user, {
        modulo: 'travas',
        acao: 'liberacao',
        descricao: `Liberou ${ROTULO_DO_TIPO[req.body.tipo] || 'o documento'} ${req.body.registroId} que estava em edição por ${r.de || 'outro usuário'}`,
        registroId: String(req.body.registroId || ''),
      });
    }
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'liberar o documento');
  }
});

module.exports = router;
