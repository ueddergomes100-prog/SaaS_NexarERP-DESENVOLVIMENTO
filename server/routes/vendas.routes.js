const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const { ErroVenda, finalizarVenda, temPermissao } = require('../services/vendaFechamento');
const { alterarPagamento, cancelarPreVenda, cancelarVenda } = require('../services/vendaCancelamento');

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
    // conferida no servico, com o pedido lido do banco. PDV (fatia 3c): a do PDV.
    if (req.body?.pdvSessionId) {
      if (!temPermissao(req.user, 'vendas.pdv')) {
        return res.status(403).json({ error: 'Você não tem permissão para vender no PDV. Peça a um responsável liberar "Vendas: Frente de Caixa (PDV)" no seu usuário.' });
      }
    } else if (!req.body?.pedidoId && !temPermissao(req.user, 'vendas.pedidos')) {
      return res.status(403).json({ error: 'Você não tem permissão para vender. Peça a um responsável liberar "Vendas: Pedidos" no seu usuário.' });
    }
    const resultado = await finalizarVenda({ user: req.user, tenantId, corpo: req.body || {} });
    if (!resultado.jaEnviado) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'vendas',
        acao: resultado.pdv ? 'criar_pdv' : 'criacao',
        descricao: `${resultado.pdv ? 'Venda PDV' : 'Venda'} #${resultado.numeroPedido} finalizada pelo servidor no valor de ${reais(resultado.totalCentavos)} (${resultado.formaPagamento}). Cliente: ${String(req.body?.clienteNome || 'CONSUMIDOR FINAL').toUpperCase()}. Vendedor: ${resultado.vendedorNome}.`,
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

/** Resposta comum dos erros das rotas abaixo. */
const responderErro = (res, erro, oQue) => {
  if (erro instanceof ErroVenda) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Vendas] erro ao ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

/**
 * POST /api/vendas/cancelar -- { pedidoId, motivo }. Venda finalizada (fatia 3b,
 * 19/10/2026). A nota fiscal ja' foi cancelada pela tela; aqui so' se confere.
 */
router.post('/cancelar', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'vendas.alterar')) {
      return res.status(403).json({ error: 'Você não tem permissão para cancelar vendas. Peça a um responsável liberar "Vendas: Alterar" no seu usuário.' });
    }
    const r = await cancelarVenda({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'vendas',
      acao: 'cancelamento',
      descricao: `Venda Direta #${r.numeroPedido} CANCELADA e estoque estornado. Motivo: ${String(req.body.motivo).trim()}.`
        + (r.creditoDevolvidoCentavos > 0 ? ` Crédito de devolução de ${reais(r.creditoDevolvidoCentavos)} devolvido ao cliente.` : ''),
      registroId: r.pedidoId,
      vendedorId: r.vendedorId,
      vendedorNome: r.vendedorNome,
      snapshotExcluido: r.snapshot,
      critico: true,
    });
    const { snapshot, ...resposta } = r;
    return res.json({ ok: true, ...resposta });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a venda');
  }
});

/** POST /api/vendas/cancelar-pre-venda -- { pedidoId, nota? }. Libera a reserva de estoque. */
router.post('/cancelar-pre-venda', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'vendas.pre_venda_cancelar')) {
      return res.status(403).json({ error: 'Você não tem permissão para cancelar pré-venda. Peça a um responsável liberar "Cancelar pré-venda" no seu usuário.' });
    }
    const r = await cancelarPreVenda({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'vendas',
      acao: 'cancelamento',
      descricao: `Pré-venda #${r.numeroPedido} cancelada.${r.reservaLiberada ? ' Estoque reservado liberado.' : ''}`,
      registroId: r.pedidoId,
      vendedorId: r.vendedorId,
      vendedorNome: r.vendedorNome,
      critico: false,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a pré-venda');
  }
});

/** POST /api/vendas/alterar-pagamento -- { pedidoId, pagamentos }. Venda finalizada. */
router.post('/alterar-pagamento', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'vendas.alterar_pagamento_finalizada')) {
      return res.status(403).json({ error: 'Você não tem permissão para alterar o pagamento de venda finalizada. Peça a um responsável liberar a permissão no seu usuário.' });
    }
    const r = await alterarPagamento({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'vendas',
      acao: 'edicao',
      descricao: `Forma de pagamento da venda #${r.numeroPedido} alterada de "${r.formaAnterior}" para "${r.formaNova}". Valor mantido em ${reais(r.totalCentavos)}.`,
      registroId: r.pedidoId,
      vendedorId: r.vendedorId,
      vendedorNome: r.vendedorNome,
      alteracoes: [{ campo: 'formaPagamento', valorAnterior: r.formaAnterior, valorNovo: r.formaNova }],
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'alterar a forma de pagamento');
  }
});

module.exports = router;
