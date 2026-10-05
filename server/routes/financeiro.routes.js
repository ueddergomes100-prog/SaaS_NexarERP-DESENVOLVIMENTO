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
const {
  conciliarCartao,
  compensarChequeRecebido,
  compensarChequeEmitido,
  baixarBoletoPeloRetorno,
  lancarNoBanco,
  transferirEntreBancos,
} = require('../services/movimentoBanco');

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

// ---------------------------------------------------------------------------
// Fatia 2: o resto das telas do Financeiro que mexiam no saldo do banco
// (services/movimentoBanco.js). Cada rota exige a permissao da sua tela.
// ---------------------------------------------------------------------------

const MENSAGEM_SEM_PERMISSAO = {
  'financeiro.banco': 'Você não tem permissão para conciliar recebimentos no banco. Peça a um responsável liberar "Financeiro: Banco" no seu usuário.',
  'financeiro.cheques': 'Você não tem permissão para compensar cheques. Peça a um responsável liberar "Financeiro: Cheques" no seu usuário.',
  'financeiro.boletos': 'Você não tem permissão para dar baixa em boletos. Peça a um responsável liberar "Financeiro: Boletos" no seu usuário.',
  'cadastros.bancos': 'Você não tem permissão para lançar no banco. Peça a um responsável liberar "Cadastros: Bancos" no seu usuário.',
};

/** Monta uma rota de movimento: permissao, empresa, operacao e log. */
const rotaDeMovimento = (permissao, acao, operacao, descreverLog) => async (req, res) => {
  try {
    if (!temPermissao(req.user, permissao)) {
      return res.status(403).json({ error: MENSAGEM_SEM_PERMISSAO[permissao] });
    }
    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await operacao({ user: req.user, tenantId, corpo: req.body || {}, hoje: hojeNoBrasil() });
    const descricao = descreverLog(resumo, req.body || {});
    if (descricao) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'edicao',
        descricao,
        registroId: String(req.body?.transacaoId || req.body?.bancoId || req.body?.origemId || ''),
      });
    }
    return res.json({ ok: true, ...resumo });
  } catch (erro) {
    return responderErro(res, erro, acao);
  }
};

/** POST /api/financeiro/cartao/conciliar  { transacaoId, bancoId? } */
router.post('/cartao/conciliar', rotaDeMovimento('financeiro.banco', 'conciliar o cartão', conciliarCartao,
  (r) => `Recebimento de cartão "${r.descricao}" conciliado: ${reais(r.liquidoCentavos)} entraram no banco ${r.bancoNome || ''}.`));

/** POST /api/financeiro/cheque/compensar  { transacaoId, bancoId? } -- cheque RECEBIDO */
router.post('/cheque/compensar', rotaDeMovimento('financeiro.cheques', 'compensar o cheque', compensarChequeRecebido,
  (r) => `Cheque recebido "${r.descricao}" compensado: ${reais(r.liquidoCentavos)} entraram no banco ${r.bancoNome || ''}.`));

/** POST /api/financeiro/cheque-emitido/compensar  { transacaoId, dataPagamento } */
router.post('/cheque-emitido/compensar', rotaDeMovimento('financeiro.cheques', 'compensar o cheque', compensarChequeEmitido,
  (r, corpo) => `Cheque emitido "${r.descricao}" compensado em ${String(corpo.dataPagamento).split('-').reverse().join('/')}: ${reais(r.valorCentavos)} saíram do banco.`));

/** POST /api/financeiro/boleto/retorno  { transacaoId, valorPagoCentavos, dataPagamento? } -- um boleto por chamada */
router.post('/boleto/retorno', rotaDeMovimento('financeiro.boletos', 'dar baixa no boleto', baixarBoletoPeloRetorno,
  (r, corpo) => (r.jaEstavaPago ? '' : `Boleto "${r.descricao}" baixado pelo arquivo de retorno: ${reais(Number(corpo.valorPagoCentavos))}.`)));

/** POST /api/financeiro/banco/lancamento  { bancoId, tipo, direcao, valorCentavos, descricao, data } */
router.post('/banco/lancamento', rotaDeMovimento('cadastros.bancos', 'registrar o lançamento', lancarNoBanco,
  (r) => `Lançamento manual (${r.tipo}, ${r.direcao === 'credito' ? 'entrada' : 'saída'}) de ${reais(r.valorCentavos)} no banco ${r.bancoNome}: ${r.descricao}`));

/** POST /api/financeiro/banco/transferencia  { origemId, destinoId, valorCentavos, descricao?, data } */
router.post('/banco/transferencia', rotaDeMovimento('cadastros.bancos', 'fazer a transferência', transferirEntreBancos,
  (r) => `Transferência de ${reais(r.valorCentavos)} do banco ${r.nomeOrigem} para ${r.nomeDestino}.`));

module.exports = router;
