const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { ErroTransferencia, enviarTransferencia, receberTransferencia, desfazerTransferencia } = require('../services/transferencias');

/**
 * TRANSFERENCIAS ENTRE FILIAIS (fase 3) -- ver services/transferencias.js.
 *   POST /api/transferencias               enviar (baixa na origem)
 *   POST /api/transferencias/:id/receber   receber no destino, com conferencia
 *   POST /api/transferencias/:id/recusar   destino recusa: tudo volta
 *   POST /api/transferencias/:id/cancelar  origem cancela: tudo volta
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroTransferencia) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Transferencia] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Nada foi alterado. Tente de novo em instantes.` });
};

const logNasDuas = (user, transferencia, descricao) => {
  if (!transferencia) return;
  [transferencia.tenantOrigem, transferencia.tenantDestino].forEach((tenantId) => {
    registrarLog({ ...user, tenantId }, { modulo: 'transferencias', acao: 'edicao', descricao, registroId: transferencia.id });
  });
};

router.post('/', async (req, res) => {
  try {
    const r = await enviarTransferencia({ user: req.user, corpo: req.body || {}, hoje: getDateInputInTimeZone() });
    if (!r.jaEnviada) {
      registrarLog(req.user, { modulo: 'transferencias', acao: 'criacao', descricao: `Enviou a transferência nº ${r.numeroTransferencia}`, registroId: r.id });
    }
    return res.status(201).json(r);
  } catch (erro) {
    return responderErro(res, erro, 'enviar a transferência');
  }
});

router.post('/:id/receber', async (req, res) => {
  try {
    const r = await receberTransferencia({ user: req.user, id: req.params.id, corpo: req.body || {} });
    logNasDuas(req.user, { ...r.transferencia, id: req.params.id }, `Recebeu a transferência nº ${r.numeroTransferencia}${r.divergente ? ' (com falta, que voltou para a origem)' : ''}`);
    return res.json({ ok: true, divergente: r.divergente });
  } catch (erro) {
    return responderErro(res, erro, 'receber a transferência');
  }
});

for (const acao of ['recusar', 'cancelar']) {
  router.post(`/:id/${acao}`, async (req, res) => {
    try {
      const r = await desfazerTransferencia({ user: req.user, id: req.params.id, corpo: req.body || {}, acao });
      logNasDuas(req.user, { ...r.transferencia, id: req.params.id }, `${acao === 'recusar' ? 'Recusou' : 'Cancelou'} a transferência nº ${r.numeroTransferencia}: ${String(req.body?.motivo || '').slice(0, 120)}`);
      return res.json({ ok: true });
    } catch (erro) {
      return responderErro(res, erro, `${acao} a transferência`);
    }
  });
}

module.exports = router;
