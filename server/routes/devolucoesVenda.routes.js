const express = require('express');
const { authenticate } = require('../middleware/auth');
const { ErroDevolucaoVenda, dadosParaDevolver, solicitarPeloApp, listarDoVendedor } = require('../services/devolucaoVenda');

/**
 * DEVOLUCAO DE VENDA PELO APP VENDAS (24/11/2026) -- ver services/devolucaoVenda.js.
 *
 * O app nunca grava em `devolucoes_venda`: pede aqui. O tenant e o vendedor
 * saem SEMPRE do token de quem chamou; o servidor confere que o pedido e' do
 * app, desse vendedor, ja' faturado, e as quantidades que sobram.
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroDevolucaoVenda) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Devolucao app] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a devolução agora. Tente de novo em instantes; se continuar, avise o escritório.' });
};

/** O que da' para devolver do pedido (itens, bancos, motivos, prazo). */
router.get('/app/pedido/:pedidoId', async (req, res) => {
  try {
    return res.json(await dadosParaDevolver({ user: req.user, tenantId: req.user.tenantId, pedidoId: req.params.pedidoId }));
  } catch (erro) {
    return responderErro(res, erro, 'dados do pedido');
  }
});

/** Pede a devolucao (ou faz, com "ja' entra confirmada"). `idDocumento` torna reenviar seguro. */
router.post('/app', async (req, res) => {
  try {
    return res.json({ ok: true, ...(await solicitarPeloApp({ user: req.user, tenantId: req.user.tenantId, corpo: req.body })) });
  } catch (erro) {
    return responderErro(res, erro, 'pedir devolução');
  }
});

/** As devolucoes que este vendedor pediu (mais novas primeiro). */
router.get('/app/minhas', async (req, res) => {
  try {
    return res.json({ devolucoes: await listarDoVendedor({ user: req.user, tenantId: req.user.tenantId }) });
  } catch (erro) {
    return responderErro(res, erro, 'listar devoluções');
  }
});

module.exports = router;
