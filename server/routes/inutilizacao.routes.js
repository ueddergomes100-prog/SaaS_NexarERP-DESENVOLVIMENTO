const express = require('express');
const { authenticate } = require('../middleware/auth');
const { canUseFiscal, resolveTenantId } = require('../services/spedyAcesso');
const { registrarLog } = require('../services/auditoria');
const { ErroInutilizacao, solicitar, consultar, listar } = require('../services/inutilizacao');
const { ROTULO_DO_MODELO, textoDaFaixa, ROTULO_STATUS_INUTILIZACAO } = require('../domain/inutilizacaoDomain');

/**
 * INUTILIZACAO DE NUMERACAO (21/10/2026). Ver services/inutilizacao.js.
 * Mesma permissao de emitir nota ("Fiscal: Emitir Nota Fiscal").
 */
const router = express.Router();
router.use(authenticate);

const SEM_PERMISSAO = 'Você não tem permissão para inutilizar numeração. Peça a um responsável liberar "Fiscal: Emitir Nota Fiscal" no seu usuário.';

// Erro com `status` ja' vem com a mensagem pro usuario (regra, Spedy sem configuracao,
// tempo esgotado/sem resposta do fetchComTimeout); o resto e' falha interna.
const responderErro = (res, erro, oQue) => {
  if (erro instanceof ErroInutilizacao || (erro && erro.status && erro.message)) {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[Inutilizacao] erro ao ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Tente de novo em instantes.` });
};

/** GET /api/inutilizacoes -- lista da empresa. */
router.get('/', async (req, res) => {
  try {
    if (!canUseFiscal(req.user)) return res.status(403).json({ error: SEM_PERMISSAO });
    return res.json({ ok: true, inutilizacoes: await listar({ tenantId: resolveTenantId(req) }) });
  } catch (erro) {
    return responderErro(res, erro, 'carregar as inutilizações');
  }
});

/** POST /api/inutilizacoes -- { modelo, serie, inicial, final, motivo }. */
router.post('/', async (req, res) => {
  try {
    if (!canUseFiscal(req.user)) return res.status(403).json({ error: SEM_PERMISSAO });
    const tenantId = resolveTenantId(req);
    const r = await solicitar({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'fiscal',
      acao: 'inutilizacao',
      descricao: `Inutilização de ${ROTULO_DO_MODELO[r.modelo]} série ${r.serie} ${textoDaFaixa(r.inicial, r.final)} pedida à SEFAZ (${ROTULO_STATUS_INUTILIZACAO[r.status]}). Motivo: ${r.motivo}.`,
      registroId: r.id,
      critico: true,
    });
    return res.json({ ok: true, inutilizacao: r });
  } catch (erro) {
    return responderErro(res, erro, 'pedir a inutilização');
  }
});

/** POST /api/inutilizacoes/:id/consultar -- situacao atual na Spedy. */
router.post('/:id/consultar', async (req, res) => {
  try {
    if (!canUseFiscal(req.user)) return res.status(403).json({ error: SEM_PERMISSAO });
    return res.json({ ok: true, inutilizacao: await consultar({ tenantId: resolveTenantId(req), id: req.params.id }) });
  } catch (erro) {
    return responderErro(res, erro, 'consultar a inutilização');
  }
});

module.exports = router;
