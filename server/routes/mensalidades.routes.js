const express = require('express');
const { authenticate } = require('../middleware/auth');
const M = require('../services/mensalidades');

/**
 * MENSALIDADES DAS EMPRESAS CLIENTES (24/11/2026): tudo o que grava cobranca,
 * boleto, pagamento, liberacao e bloqueio passa por aqui, so' para o admin da
 * plataforma. As empresas nunca gravam nada disso (rules: write false).
 */
const router = express.Router();
router.use(authenticate);
router.use((req, res, next) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma mexe nas mensalidades.' });
  }
  return next();
});

const responder = (acao) => async (req, res) => {
  try {
    return res.json(await acao(req));
  } catch (erro) {
    if (erro && Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 600 && erro.message) {
      return res.status(erro.status).json({ error: erro.message });
    }
    console.error('[Mensalidades] falhou:', erro && erro.message);
    return res.status(500).json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' });
  }
};

const b = (req) => req.body || {};

router.post('/config', responder((req) => M.salvarConfigGeral({ user: req.user, prazos: b(req).prazos, contato: b(req).contato })));
router.post('/empresa', responder((req) => M.salvarPlanoDaEmpresa({
  user: req.user,
  tenantId: b(req).tenantId,
  ativa: b(req).ativa === true,
  diaVencimento: b(req).diaVencimento,
  prazos: b(req).prazos || null,
})));
router.post('/liberar', responder((req) => M.liberarAte({ user: req.user, tenantId: b(req).tenantId, ate: b(req).ate || null, motivo: b(req).motivo })));
router.post('/gerar', responder((req) => M.gerarMensalidade({ user: req.user, tenantId: b(req).tenantId, competencia: b(req).competencia })));
router.post('/boleto', responder((req) => M.anexarBoleto({ user: req.user, id: b(req).id, boleto: b(req).boleto })));
router.post('/pagar', responder((req) => M.marcarPaga({ user: req.user, id: b(req).id, pagoEm: b(req).pagoEm })));
router.post('/desfazer-pagamento', responder((req) => M.desfazerPagamento({ user: req.user, id: b(req).id, motivo: b(req).motivo })));
router.post('/cancelar', responder((req) => M.cancelarMensalidade({ user: req.user, id: b(req).id, motivo: b(req).motivo })));
router.post('/enviar', responder((req) => M.enviarCobranca({
  user: req.user,
  id: b(req).id,
  porEmail: b(req).porEmail === true,
  porWhatsapp: b(req).porWhatsapp === true,
})));
router.post('/recalcular', responder(() => M.reprojetarTodas()));

module.exports = router;
