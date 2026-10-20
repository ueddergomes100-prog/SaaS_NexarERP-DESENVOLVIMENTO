const express = require('express');
const { authenticate } = require('../middleware/auth');
const { ErroCashback, gerarSeDevido, estornarVenda, estornarDevolucao } = require('../services/cashback');

const router = express.Router();

// Tudo autenticado; o tenant sai do token. As operacoes sao idempotentes e
// so' agem sobre o que ja' esta' gravado (a venda, a devolucao): a tela chama
// depois de gravar por conta propria (chave "Venda pelo servidor" desligada,
// baixa com credito, devolucao). Ver services/cashback.js.
router.use(authenticate);

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroCashback) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Cashback] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação de cashback. Tente novamente em instantes.' });
};

/** Gera o cashback da venda, se ela estiver paga por inteiro e ainda nao tiver gerado. */
router.post('/gerar', async (req, res) => {
  try {
    const r = await gerarSeDevido({ user: req.user, tenantId: req.user.tenantId, pedidoId: req.body?.pedidoId });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'gerar');
  }
});

/** Venda cancelada pela tela: estorna o que ela gerou. */
router.post('/estornar-venda', async (req, res) => {
  try {
    const r = await estornarVenda({ user: req.user, tenantId: req.user.tenantId, pedidoId: req.body?.pedidoId });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'estornar venda');
  }
});

/** Devolucao de mercadoria: estorna a parte proporcional ao valor devolvido. */
router.post('/estornar-devolucao', async (req, res) => {
  try {
    const r = await estornarDevolucao({ user: req.user, tenantId: req.user.tenantId, devolucaoId: req.body?.devolucaoId });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'estornar devolução');
  }
});

module.exports = router;
