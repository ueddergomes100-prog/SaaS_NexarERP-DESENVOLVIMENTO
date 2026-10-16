const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const {
  ErroBaixa,
  PERMISSAO_DA_BAIXA,
  temPermissao,
  validarPedidoDeBaixa,
  validarPedidoDeBaixaEmLote,
  validarPedidoDeEstorno,
  registrarBaixa,
  registrarEstorno,
  hojeNoBrasil,
} = require('../services/baixaFinanceira');
const { validarPedidoDeAlteracaoDeValor, alterarValorDoTitulo } = require('../services/alteracaoValorTitulo');
const { PERMISSAO_ALTERAR_VALOR } = require('../domain/alteracaoValorTituloDomain');
const { prepararCobrancaEmBoleto } = require('../services/cobrancaEmBoleto');
const {
  validarPedidoDeRenegociacao,
  criarRenegociacao,
  validarPedidoDeDesfazer,
  desfazerRenegociacao,
} = require('../services/renegociacao');
const { PERMISSAO_RENEGOCIAR } = require('../domain/renegociacaoDomain');
const { descricaoDosAjustes } = require('../domain/ajustesDaBaixaDomain');
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

const semPermissaoDeBaixa = (tipo) => (tipo === 'saida'
  ? 'Você não tem permissão para dar baixa em contas a pagar. Peça a um responsável liberar "Financeiro: Contas a Pagar" no seu usuário.'
  : 'Você não tem permissão para dar baixa em contas a receber. Peça a um responsável liberar "Financeiro: Contas a Receber" no seu usuário.');

const registrarLogDaBaixa = (user, tenantId, pedido, resumo, sufixo = '') => {
  // Juros, multa e desconto (15/10/2026) entram no texto do log.
  const ajustes = resumo.ajustes ? descricaoDosAjustes(resumo.ajustes) : '';
  registrarLog({ ...user, tenantId }, {
    modulo: 'financeiro',
    acao: 'edicao',
    descricao: `${pedido.tipo === 'saida' ? 'Pagamento' : 'Recebimento'} "${resumo.descricao}" de ${reais(resumo.valorCentavos)} baixado em ${pedido.dataPagamento.split('-').reverse().join('/')} (${pedido.formaPagamento}${resumo.bancoNome ? `, banco ${resumo.bancoNome}` : ''})${ajustes ? `, com ${ajustes}` : ''}${sufixo}.`,
    registroId: pedido.transacaoId,
  });
};

/** POST /api/financeiro/baixa  { tipo, transacaoId, formaPagamento, dataPagamento, bancoId?, tenantId? } */
router.post('/baixa', async (req, res) => {
  try {
    const { erro, pedido } = validarPedidoDeBaixa(req.body, hojeNoBrasil());
    if (erro) return res.status(400).json({ error: erro });

    if (!temPermissao(req.user, PERMISSAO_DA_BAIXA[pedido.tipo])) {
      return res.status(403).json({ error: semPermissaoDeBaixa(pedido.tipo) });
    }

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await registrarBaixa({ user: req.user, tenantId, pedido });

    registrarLogDaBaixa(req.user, tenantId, pedido, resumo, resumo.parcial ? ` (pagamento parcial; fica em aberto ${reais(resumo.parcial.restanteCentavos)})` : '');
    // Parcial (16/10/2026): a tela usa o id do lancamento parcial no numero do recibo.
    return res.json({ ok: true, ...(resumo.parcial ? { parcial: resumo.parcial } : {}) });
  } catch (erro) {
    return responderErro(res, erro, 'dar baixa');
  }
});

/**
 * POST /api/financeiro/baixa-lote
 *   { tipo, formaPagamento, dataPagamento, bancoId?, tenantId?, titulos: [{ transacaoId, acrescimoCentavos? }] }
 *
 * Baixa em lote (2026-10-14): cada conta e' uma baixa COMPLETA e independente
 * -- a mesma registrarBaixa da rota /baixa, com titulo, saldo do banco e
 * venda/OS de origem numa transacao --, uma depois da outra (todas mexem no
 * mesmo saldo de banco). Conta que falha (ja' paga, cancelada...) nao desfaz
 * as outras: a resposta traz o resultado de cada uma.
 */
router.post('/baixa-lote', async (req, res) => {
  try {
    const { erro, pedidos } = validarPedidoDeBaixaEmLote(req.body, hojeNoBrasil());
    if (erro) return res.status(400).json({ error: erro });

    const { tipo } = pedidos[0];
    if (!temPermissao(req.user, PERMISSAO_DA_BAIXA[tipo])) {
      return res.status(403).json({ error: semPermissaoDeBaixa(tipo) });
    }

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resultados = [];
    for (const pedido of pedidos) {
      try {
        const resumo = await registrarBaixa({ user: req.user, tenantId, pedido });
        registrarLogDaBaixa(req.user, tenantId, pedido, resumo, ' (baixa em lote)');
        resultados.push({ transacaoId: pedido.transacaoId, ok: true });
      } catch (erroDaConta) {
        if (!(erroDaConta instanceof ErroBaixa)) console.error('[Financeiro] erro na baixa em lote:', erroDaConta);
        resultados.push({
          transacaoId: pedido.transacaoId,
          ok: false,
          erro: erroDaConta instanceof ErroBaixa
            ? erroDaConta.message
            : 'Não foi possível dar baixa nesta conta. Nada foi alterado nela. Tente de novo em instantes.',
        });
      }
    }
    return res.json({ ok: true, resultados });
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

/**
 * POST /api/financeiro/alterar-valor  { transacaoId, novoValorCentavos, motivo, tenantId? }
 *
 * Valor de UMA parcela a receber (15/10/2026): nota com o valor da venda,
 * boleto com desconto. Muda so' o titulo; a venda/OS fica como esta'. Ver
 * services/alteracaoValorTitulo.js.
 */
router.post('/alterar-valor', async (req, res) => {
  try {
    const { erro, pedido } = validarPedidoDeAlteracaoDeValor(req.body);
    if (erro) return res.status(400).json({ error: erro });

    if (!temPermissao(req.user, PERMISSAO_ALTERAR_VALOR)) {
      return res.status(403).json({
        error: 'Você não tem permissão para alterar o valor de parcelas. Peça a um responsável liberar "Financeiro: Alterar Valor de Documentos" no seu usuário.',
      });
    }

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await alterarValorDoTitulo({ user: req.user, tenantId, pedido });

    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `Valor da parcela "${resumo.descricao}" alterado de ${reais(resumo.deCentavos)} para ${reais(resumo.paraCentavos)}. Motivo: ${pedido.motivo}`,
      registroId: pedido.transacaoId,
      critico: true,
    });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'alterar o valor da parcela');
  }
});

const SEM_PERMISSAO_RENEGOCIAR = 'Você não tem permissão para renegociar documentos. Peça a um responsável liberar "Financeiro: Renegociar Documentos" no seu usuário.';

/**
 * POST /api/financeiro/renegociar
 *   { transacaoIds: [...], parcelas: [{ valorCentavos, vencimento }], formaPagamento, motivo, tenantId? }
 *
 * Renegociacao (15/10/2026): parcelas em aberto de um cliente viram
 * "Renegociada" e nascem as parcelas novas. Ver services/renegociacao.js.
 */
router.post('/renegociar', async (req, res) => {
  try {
    const hoje = hojeNoBrasil();
    const { erro, pedido } = validarPedidoDeRenegociacao(req.body, hoje);
    if (erro) return res.status(400).json({ error: erro });
    if (!temPermissao(req.user, PERMISSAO_RENEGOCIAR)) return res.status(403).json({ error: SEM_PERMISSAO_RENEGOCIAR });

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await criarRenegociacao({ user: req.user, tenantId, pedido, hoje });

    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'criacao',
      descricao: `Renegociação de ${resumo.quantidadeAntigas} parcela(s) de ${resumo.clienteNome}: ${reais(resumo.totalOrigemCentavos)} viraram ${reais(resumo.totalNovoCentavos)} em ${resumo.quantidadeNovas} parcela(s) (${pedido.formaPagamento}). Motivo: ${pedido.motivo}`,
      registroId: resumo.renegociacaoId,
      critico: true,
    });
    return res.json({ ok: true, renegociacaoId: resumo.renegociacaoId });
  } catch (erro) {
    return responderErro(res, erro, 'renegociar');
  }
});

/** POST /api/financeiro/renegociacao/desfazer  { transacaoId (qualquer parcela nova), motivo, tenantId? } */
router.post('/renegociacao/desfazer', async (req, res) => {
  try {
    const { erro, pedido } = validarPedidoDeDesfazer(req.body);
    if (erro) return res.status(400).json({ error: erro });
    if (!temPermissao(req.user, PERMISSAO_RENEGOCIAR)) return res.status(403).json({ error: SEM_PERMISSAO_RENEGOCIAR });

    const tenantId = empresaDaOperacao(req.user, req.body);
    const resumo = await desfazerRenegociacao({ user: req.user, tenantId, pedido });

    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'edicao',
      descricao: `Renegociação de ${resumo.clienteNome} desfeita: ${resumo.quantidadeNovas} parcela(s) nova(s) cancelada(s)${resumo.estornadas ? ` (${resumo.estornadas} recebida(s) estornada(s), ${reais(resumo.retiradoDoBancoCentavos)} saíram do banco)` : ''} e ${resumo.quantidadeAntigas} parcela(s) antiga(s) de volta em aberto. Motivo: ${pedido.motivo}`,
      registroId: resumo.renegociacaoId,
      critico: true,
    });
    return res.json({ ok: true, estornadas: resumo.estornadas });
  } catch (erro) {
    return responderErro(res, erro, 'desfazer a renegociação');
  }
});

// ---------------------------------------------------------------------------
// Fatia 2: o resto das telas do Financeiro que mexiam no saldo do banco
// (services/movimentoBanco.js). Cada rota exige a permissao da sua tela.
// ---------------------------------------------------------------------------

const MENSAGEM_SEM_PERMISSAO = {
  'financeiro.banco': 'Você não tem permissão para conciliar recebimentos no banco. Peça a um responsável liberar "Financeiro: Banco" no seu usuário.',
  'financeiro.cheques': 'Você não tem permissão para compensar cheques. Peça a um responsável liberar "Financeiro: Cheques" no seu usuário.',
  'financeiro.boletos': 'Você não tem permissão para mexer em boletos. Peça a um responsável liberar "Financeiro: Boletos (Emissão, Remessa e Retorno)" no seu usuário.',
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

/**
 * POST /api/financeiro/cobrar-em-boleto  { transacaoId, vencimento }
 * "Dar Baixa" com a forma Boleto (15/10/2026): a parcela passa a ser cobrada em
 * boleto, com o vencimento escolhido; a tela emite o boleto logo em seguida.
 */
router.post('/cobrar-em-boleto', rotaDeMovimento('financeiro.boletos', 'preparar o boleto da parcela', prepararCobrancaEmBoleto,
  (r) => `Parcela "${r.descricao}" passou a ser cobrada em boleto${r.formaAnterior && r.formaAnterior !== 'Boleto' ? ` (era "${r.formaAnterior}")` : ''}, vencimento ${String(r.vencimento).split('-').reverse().join('/')}.`));

/** POST /api/financeiro/banco/lancamento  { bancoId, tipo, direcao, valorCentavos, descricao, data } */
router.post('/banco/lancamento', rotaDeMovimento('cadastros.bancos', 'registrar o lançamento', lancarNoBanco,
  (r) => `Lançamento manual (${r.tipo}, ${r.direcao === 'credito' ? 'entrada' : 'saída'}) de ${reais(r.valorCentavos)} no banco ${r.bancoNome}: ${r.descricao}`));

/** POST /api/financeiro/banco/transferencia  { origemId, destinoId, valorCentavos, descricao?, data } */
router.post('/banco/transferencia', rotaDeMovimento('cadastros.bancos', 'fazer a transferência', transferirEntreBancos,
  (r) => `Transferência de ${reais(r.valorCentavos)} do banco ${r.nomeOrigem} para ${r.nomeDestino}.`));

module.exports = router;
