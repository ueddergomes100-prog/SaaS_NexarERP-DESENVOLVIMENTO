const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const { ErroVenda, finalizarVenda, temPermissao } = require('../services/vendaFechamento');

/**
 * VENDAS -- fechamento da venda pelo servidor (item 8 da auditoria, fatia 3).
 * Ver services/vendaFechamento.js. Usado pelo Pedido de Venda quando a
 * empresa tem a chave "Venda pelo servidor" ligada no SuperAdmin.
 */
const router = express.Router();
router.use(authenticate);

/** Empresa da operacao: a do token (a filial ativa). Admin da plataforma pode escolher. */
const empresaDaOperacao = (user, corpo) => {
  const pedida = typeof corpo?.tenantId === 'string' ? corpo.tenantId.trim() : '';
  if (!pedida || pedida === user.tenantId) return user.tenantId;
  if (user.isPlatformAdmin) return pedida;
  throw new ErroVenda(403, 'Você não pode vender em outra empresa.');
};

const reais = (centavos) => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;

/**
 * POST /api/vendas/finalizar
 * Venda direta: { idDocumento, ... }. Pre-venda/pedido do agente: { pedidoId, ... }.
 * Corpo completo em lerPedidoDeFechamento (src/utils/vendaFechamentoDomain.ts).
 */
router.post('/finalizar', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    // Pre-venda e pedido do agente: a permissao depende do status e e'
    // conferida no servico, com o pedido lido do banco.
    if (!req.body?.pedidoId && !temPermissao(req.user, 'vendas.pedidos')) {
      return res.status(403).json({ error: 'Você não tem permissão para vender. Peça a um responsável liberar "Vendas: Pedidos" no seu usuário.' });
    }
    const resultado = await finalizarVenda({ user: req.user, tenantId, corpo: req.body || {} });
    if (!resultado.jaEnviado) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'vendas',
        acao: 'criacao',
        descricao: `Venda #${resultado.numeroPedido} finalizada pelo servidor no valor de ${reais(resultado.totalCentavos)} (${resultado.formaPagamento}). Cliente: ${String(req.body?.clienteNome || 'CONSUMIDOR FINAL').toUpperCase()}. Vendedor: ${resultado.vendedorNome}.`,
        registroId: resultado.pedidoId,
      });
    }
    return res.json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof ErroVenda) return res.status(erro.status).json({ error: erro.message });
    console.error('[Vendas] erro ao finalizar a venda:', erro);
    return res.status(500).json({ error: 'Não foi possível finalizar a venda. Nada foi gravado. Tente de novo em instantes.' });
  }
});

module.exports = router;
