const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const {
  ErroBaixa,
  PERMISSAO_DA_BAIXA,
  temPermissao,
  validarPedidoDeBaixa,
  validarPedidoDeEstorno,
  registrarBaixa,
  registrarEstorno,
  hojeNoBrasil,
} = require('../services/baixaFinanceira');

/**
 * FINANCEIRO -- baixa e estorno de titulos (item 8 da auditoria, fatia 1).
 * Ver services/baixaFinanceira.js. O navegador manda so' o que a pessoa
 * escolheu; valor, saldo do banco e venda/OS sao lidos e gravados aqui.
 */
const router = express.Router();
router.use(authenticate);

/** Empresa da operacao: a do token. Admin da plataforma pode agir na empresa que escolheu na tela. */
const empresaDaOperacao = (user, corpo) => {
  const pedida = typeof corpo?.tenantId === 'string' ? corpo.tenantId.trim() : '';
  if (!pedida || pedida === user.tenantId) return user.tenantId;
  if (user.isPlatformAdmin) return pedida;
  throw new ErroBaixa(403, 'Você não pode mexer no financeiro de outra empresa.');
};

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroBaixa) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Financeiro] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Nada foi alterado. Tente de novo em instantes.` });
};

const reais = (centavos) => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;

/** POST /api/financeiro/baixa  { tipo, transacaoId, formaPagamento, dataPagamento, bancoId?, tenantId? } */
router.post('/baixa', async (req, res) => {
  try {
    const { erro, pedido } = validarPedidoDeBaixa(req.body, hojeNoBrasil());
    if (erro) return res.status(400).json({ error: erro });

    if (!temPermissao(req.user, PERMISSAO_DA_BAIXA[pedido.tipo])) {
      return res.status(403).json({
        error: pedido.tipo === 'saida'
          ? 'Você não tem permissão para dar baixa em contas a pagar. Peça a um responsável liberar "Financeiro: Contas a Pagar" no seu usuário.'
          : 'Você não tem permissão para dar baixa em contas a receber. Peça a um responsável liberar "Financeiro: Contas a Receber" no seu usuário.',
      });
    }

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await registrarBaixa({ user: req.user, tenantId, pedido });

    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `${pedido.tipo === 'saida' ? 'Pagamento' : 'Recebimento'} "${resumo.descricao}" de ${reais(resumo.valorCentavos)} baixado em ${pedido.dataPagamento.split('-').reverse().join('/')} (${pedido.formaPagamento}${resumo.bancoNome ? `, banco ${resumo.bancoNome}` : ''}).`,
      registroId: pedido.transacaoId,
    });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'dar baixa');
  }
});

/** POST /api/financeiro/estorno  { tipo, transacaoId, motivo, tenantId? } */
router.post('/estorno', async (req, res) => {
  try {
    const { erro, pedido } = validarPedidoDeEstorno(req.body);
    if (erro) return res.status(400).json({ error: erro });

    if (!temPermissao(req.user, 'financeiro.estornar')) {
      return res.status(403).json({
        error: `Você não tem permissão para estornar ${pedido.tipo === 'saida' ? 'pagamentos' : 'recebimentos'}. Peça a um responsável liberar "Financeiro: Estornar Pagamento/Recebimento" no seu usuário.`,
      });
    }

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await registrarEstorno({ user: req.user, tenantId, pedido });

    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `${pedido.tipo === 'saida' ? 'Pagamento' : 'Recebimento'} "${resumo.descricao}" de ${reais(resumo.valorCentavos)} estornado para Pendente. Motivo: ${pedido.motivo}`,
      registroId: pedido.transacaoId,
      critico: true,
    });
    return res.json({ ok: true, ajusteBancoCentavos: resumo.ajusteBancoCentavos });
  } catch (erro) {
    return responderErro(res, erro, 'estornar');
  }
});

module.exports = router;
