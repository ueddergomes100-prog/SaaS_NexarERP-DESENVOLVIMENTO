const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { liberarDesconto } = require('../services/liberacaoDesconto');
const { NOME_DA_TELA } = require('../domain/conferenciaDescontoDomain');

/**
 * LIBERACAO DE DESCONTO (19/10/2026): a senha/PIN do aprovador e' conferida
 * aqui e vira um comprovante de curta duracao. Ver services/liberacaoDesconto.js.
 * O tenant vem sempre do token de quem chamou (a estacao), nunca do corpo.
 */
const router = express.Router();
router.use(authenticate);

const reais = (centavos) => `R$ ${(Number(centavos) / 100).toFixed(2).replace('.', ',')}`;

/** POST /api/descontos/liberar -- { tela, baseCentavos, descontoCentavos, aprovador }. */
router.post('/liberar', async (req, res) => {
  try {
    const r = await liberarDesconto({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: r.tela === 'os' ? 'mecanica' : 'vendas',
      acao: 'aprovacao_desconto',
      descricao: `Desconto de ${reais(req.body.descontoCentavos)} sobre ${reais(req.body.baseCentavos)} liberado por ${r.aprovadoPorNome} (${NOME_DA_TELA[r.tela]}), conferido pelo servidor.`,
      registroId: r.comprovanteId,
      vendedorId: r.aprovadoPorId,
      vendedorNome: r.aprovadoPorNome,
      critico: true,
    });
    return res.json({ ok: true, comprovanteId: r.comprovanteId, validoAteMs: r.validoAteMs, aprovadoPorId: r.aprovadoPorId, aprovadoPorNome: r.aprovadoPorNome });
  } catch (erro) {
    if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
    console.error('[Descontos] erro ao liberar:', erro);
    return res.status(500).json({ error: 'Não foi possível conferir a liberação agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
