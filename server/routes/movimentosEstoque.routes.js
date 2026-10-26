const express = require('express');
const { authenticate } = require('../middleware/auth');
const s = require('../services/movimentosEstoque');
const { PERMISSAO_MOVIMENTACAO, lerFiltroDaConsulta } = require('../domain/movimentosEstoqueDomain');

/*
 * Movimentacao de produtos (26/10/2026): todas as entradas e saidas de estoque,
 * materia-prima e insumo, montadas a partir dos documentos ja' gravados (venda,
 * OS, compra, producao, ajuste, balanco...). Ver services/movimentosEstoque.js.
 */
const router = express.Router();
router.use(authenticate);

const tem = (user) => Boolean(
  user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(PERMISSAO_MOVIMENTACAO)),
);

/** POST /api/movimentos-estoque -- { de, ate, itemId?, colecao? } (datas AAAA-MM-DD). */
router.post('/', async (req, res) => {
  try {
    if (!tem(req.user)) {
      return res.status(403).json({ error: 'Você não tem permissão para ver a movimentação de produtos. Peça a um responsável liberar "Estoque: Movimentação de Produtos" no seu usuário.' });
    }
    const lido = lerFiltroDaConsulta(req.body);
    if ('erro' in lido) return res.status(400).json({ error: lido.erro });
    const r = await s.consultar({ tenantId: req.user.tenantId, ...lido.filtro });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    if (erro && erro.status && erro.message) return res.status(erro.status).json({ error: erro.message });
    console.error('[Movimentacao] erro ao consultar:', erro);
    return res.status(500).json({ error: 'Não foi possível montar a movimentação agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
