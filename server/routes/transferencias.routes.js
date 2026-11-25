const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { ErroTransferencia, enviarTransferencia, receberTransferencia, desfazerTransferencia, reemitirNota, consultarNota } = require('../services/transferencias');
const permissoesEstoque = require('../services/permissoesEstoque');
const { PERMISSAO_FILIAIS } = require('../domain/permissoesNovasDomain');

/**
 * TRANSFERENCIAS ENTRE FILIAIS (fase 3) -- ver services/transferencias.js.
 *   POST /api/transferencias               enviar (baixa na origem)
 *   POST /api/transferencias/:id/receber   receber no destino, com conferencia
 *   POST /api/transferencias/:id/recusar   destino recusa: tudo volta
 *   POST /api/transferencias/:id/cancelar  origem cancela: tudo volta
 *   POST /api/transferencias/:id/nota      origem emite a nota de novo (fase 4)
 *   GET  /api/transferencias/:id/nota      situacao da nota (consulta a Spedy)
 *
 * Item 15 (25/11/2026): receber, recusar/cancelar e emitir a nota de novo pedem
 * a permissao propria ("Filiais: Receber transferencia", "Filiais: Recusar e
 * cancelar transferencia" -- quem usa outras filiais ja' tem marcadas -- e
 * "Fiscal: Emitir Nota Fiscal"). Sem nota: services/transferencias.js.
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
    permissoesEstoque.exigir(req.user, [PERMISSAO_FILIAIS.transferenciaReceber], ErroTransferencia);
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
      permissoesEstoque.exigir(req.user, [PERMISSAO_FILIAIS.transferenciaCancelar], ErroTransferencia);
      const r = await desfazerTransferencia({ user: req.user, id: req.params.id, corpo: req.body || {}, acao });
      logNasDuas(req.user, { ...r.transferencia, id: req.params.id }, `${acao === 'recusar' ? 'Recusou' : 'Cancelou'} a transferência nº ${r.numeroTransferencia}: ${String(req.body?.motivo || '').slice(0, 120)}`);
      return res.json({ ok: true });
    } catch (erro) {
      return responderErro(res, erro, `${acao} a transferência`);
    }
  });
}

router.post('/:id/nota', async (req, res) => {
  try {
    permissoesEstoque.exigir(req.user, ['fiscal.emitir'], ErroTransferencia);
    const r = await reemitirNota({ user: req.user, id: req.params.id });
    logNasDuas(req.user, { ...r, id: req.params.id }, `Emitiu de novo a nota da transferência nº ${r.numeroTransferencia}`);
    return res.json({ ok: true, nota: r.nota, avisos: r.avisos || [] });
  } catch (erro) {
    return responderErro(res, erro, 'emitir a nota da transferência');
  }
});

router.get('/:id/nota', async (req, res) => {
  try {
    return res.json(await consultarNota({ user: req.user, id: req.params.id }));
  } catch (erro) {
    return responderErro(res, erro, 'consultar a nota da transferência');
  }
});

module.exports = router;
