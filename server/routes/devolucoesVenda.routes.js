const express = require('express');
const { authenticate } = require('../middleware/auth');
const { ErroDevolucaoVenda, dadosParaDevolver, solicitarPeloApp, listarDoVendedor } = require('../services/devolucaoVenda');
const escritorio = require('../services/devolucaoVendaEscritorio');

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
  // Erros de regra de outros servicos (baixa, renegociacao) ja' vem em portugues, com o status.
  if (erro && Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 500) return res.status(erro.status).json({ error: erro.message });
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


// ---------------------------------------------------------------------------
// Escritorio (25/11/2026): devolucao feita no sistema e confirmacao da do app,
// gravadas aqui -- ver services/devolucaoVendaEscritorio.js.
// ---------------------------------------------------------------------------

/** Janela do destino do valor: parcelas em aberto do cliente e bancos. */
router.get('/opcoes-do-valor', async (req, res) => {
  try {
    return res.json(await escritorio.opcoesDoValor({ user: req.user, tenantId: req.user.tenantId, clienteId: req.query.clienteId, clienteNome: req.query.clienteNome }));
  } catch (erro) {
    return responderErro(res, erro, 'opções do valor');
  }
});

/** Pedidos do cliente que tem os produtos escolhidos (devolução por cliente e produto). */
router.post('/pedidos-do-cliente', async (req, res) => {
  try {
    return res.json(await escritorio.pedidosDoClienteComProdutos({ user: req.user, tenantId: req.user.tenantId, clienteId: req.body?.clienteId, produtoIds: req.body?.produtoIds }));
  } catch (erro) {
    return responderErro(res, erro, 'pedidos do cliente');
  }
});

/** Devolução feita no sistema: um ou vários pedidos e/ou sem pedido, com o destino do valor. */
router.post('/sistema', async (req, res) => {
  try {
    return res.json({ ok: true, ...(await escritorio.registrarNoSistema({ user: req.user, tenantId: req.user.tenantId, corpo: req.body })) });
  } catch (erro) {
    return responderErro(res, erro, 'devolução no sistema');
  }
});

/** Confirma a devolução pedida pelo app, com o destino do valor escolhido na janela. */
router.post('/:devolucaoId/confirmar', async (req, res) => {
  try {
    return res.json({ ok: true, ...(await escritorio.confirmarDoApp({ user: req.user, tenantId: req.user.tenantId, devolucaoId: req.params.devolucaoId, corpo: req.body })) });
  } catch (erro) {
    return responderErro(res, erro, 'confirmar devolução');
  }
});
module.exports = router;
