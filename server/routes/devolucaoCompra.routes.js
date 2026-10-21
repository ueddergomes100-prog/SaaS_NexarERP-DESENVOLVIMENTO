const express = require('express');
const { authenticate } = require('../middleware/auth');
const { canUseFiscal, resolveTenantId } = require('../services/spedyAcesso');
const { registrarLog } = require('../services/auditoria');
const { ErroDevolucaoCompra, registrar, emitir, listar } = require('../services/devolucaoCompra');

/**
 * DEVOLUCAO DE COMPRA AO FORNECEDOR (21/10/2026). Ver services/devolucaoCompra.js.
 * Registrar mexe em estoque e financeiro: pede "Fiscal: Entrada de XML" (quem lanca a
 * nota de entrada). Emitir a NF-e pede "Fiscal: Emitir Nota Fiscal".
 */
const router = express.Router();
router.use(authenticate);

const temPermissao = (user, permissao) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)),
);

const responderErro = (res, erro, oQue) => {
  if (erro instanceof ErroDevolucaoCompra || (erro && erro.status && erro.message)) {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[Devolucao compra] erro ao ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

const reais = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',')}`;

/** GET /api/devolucao-compra?notaEntradaId=... -- devolucoes da nota. */
router.get('/', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'fiscal.entrada') && !canUseFiscal(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para ver devoluções ao fornecedor.' });
    }
    return res.json({ ok: true, devolucoes: await listar({ tenantId: resolveTenantId(req), notaEntradaId: req.query.notaEntradaId }) });
  } catch (erro) {
    return responderErro(res, erro, 'carregar as devoluções');
  }
});

/** POST /api/devolucao-compra -- { notaEntradaId, itens: [{ indice, quantidade }], motivo }. */
router.post('/', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'fiscal.entrada')) {
      return res.status(403).json({ error: 'Você não tem permissão para devolver ao fornecedor. Peça a um responsável liberar "Fiscal: Entrada de XML" no seu usuário.' });
    }
    const tenantId = resolveTenantId(req);
    const r = await registrar({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'fiscal',
      acao: 'devolucao_compra',
      descricao: `Devolução ao fornecedor ${r.fornecedorNome} (NF ${r.notaNumero}) de ${reais(r.totalCentavos)}: `
        + `${r.itens.map((i) => `${i.quantidade} ${i.unidade} de ${i.nome}`).join('; ')}. `
        + `Abatido do a pagar: ${reais(r.abatidoCentavos)}${r.aReceberCentavos > 0 ? `; a receber do fornecedor: ${reais(r.aReceberCentavos)}` : ''}. Motivo: ${r.motivo}.`,
      registroId: r.id,
      critico: true,
    });
    return res.json({ ok: true, devolucao: { id: r.id, totalCentavos: r.totalCentavos, abatidoCentavos: r.abatidoCentavos, aReceberCentavos: r.aReceberCentavos } });
  } catch (erro) {
    return responderErro(res, erro, 'registrar a devolução');
  }
});

/** POST /api/devolucao-compra/emitir -- { devolucaoId }. */
router.post('/emitir', async (req, res) => {
  try {
    if (!canUseFiscal(req.user, 'emit')) {
      return res.status(403).json({ error: 'Você não tem permissão para emitir nota fiscal. Peça a um responsável liberar "Fiscal: Emitir Nota Fiscal" no seu usuário.' });
    }
    const tenantId = resolveTenantId(req);
    const r = await emitir({ user: req.user, tenantId, corpo: req.body || {} });
    return res.json({ ok: true, nota: r });
  } catch (erro) {
    return responderErro(res, erro, 'emitir a nota de devolução');
  }
});

module.exports = router;
