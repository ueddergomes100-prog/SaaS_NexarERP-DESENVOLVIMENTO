const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const {
  ErroBaixa,
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
const { lancarContaAReceber, editarContaAReceber, cancelarContaAReceber } = require('../services/lancamentoReceber');
const { lancarContaAPagar, editarContaAPagar, cancelarContaAPagar } = require('../services/lancamentoPagar');
const { registrarChequeNaBaixa, abaterComCredito } = require('../services/recebimentoChequeCredito');
const { adicionarCategoria, ErroConfiguracoesGerais } = require('../services/configuracoesGerais');
const { descricaoDosAjustes } = require('../domain/ajustesDaBaixaDomain');
const { listarAbertasDoCliente, receberNoCaixa } = require('../services/recebimentoNoCaixa');
const {
  conciliarCartao,
  alterarTaxaDoCartao,
  compensarChequeRecebido,
  compensarChequeEmitido,
  baixarBoletoPeloRetorno,
  receberBoletoCanceladoPeloRetorno,
  lancarNoBanco,
  transferirEntreBancos,
} = require('../services/movimentoBanco');
const { depositarCheque, devolverCheque, voltarChequeParaCarteira } = require('../services/chequeSituacao');
const acertoFornecedor = require('../services/acertoFornecedor');
const { vincularBoletosAnteriores } = require('../services/boletoSistemaAnterior');
const {
  permissoesQueFaltam,
  permissoesDaBaixa,
  jurosNoPadrao,
  mensagemSemPermissao,
} = require('../services/permissoesFinanceiro');
const { PERMISSAO_FINANCEIRO } = require('../domain/permissoesNovasDomain');
const { db } = require('../config/firebase');

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

/**
 * Item 15 (25/11/2026): confere as permissoes POR ACAO (efetivas: quem tem a da
 * tela e ainda nao teve as permissoes salvas de novo ja' tem as novas). Devolve
 * true se respondeu 403 com a frase em portugues.
 */
const barrarSemPermissoes = (req, res, ids) => {
  const faltam = permissoesQueFaltam(req.user, ids);
  if (faltam.length === 0) return false;
  res.status(403).json({ error: mensagemSemPermissao(faltam) });
  return true;
};

/** Como o usuario conhece o titulo no Historico de alteracoes. */
const numeroDoTitulo = (tipo, descricao, transacaoId) => `${tipo === 'saida' ? 'Conta a pagar' : 'Conta a receber'} ${descricao || transacaoId}`;

const registrarLogDaBaixa = (user, tenantId, pedido, resumo, sufixo = '') => {
  // Juros, multa e desconto (15/10/2026) entram no texto do log.
  const ajustes = resumo.ajustes ? descricaoDosAjustes(resumo.ajustes) : '';
  registrarLog({ ...user, tenantId }, {
    modulo: 'financeiro',
    acao: 'baixa',
    descricao: `${pedido.tipo === 'saida' ? 'Pagamento' : 'Recebimento'} "${resumo.descricao}" de ${reais(resumo.valorCentavos)} baixado em ${pedido.dataPagamento.split('-').reverse().join('/')} (${pedido.formaPagamento}${resumo.bancoNome ? `, banco ${resumo.bancoNome}` : ''})${ajustes ? `, com ${ajustes}` : ''}${sufixo}.`,
    registroId: pedido.transacaoId,
    // Titulo <-> venda/OS de origem e, no pagamento parcial, o lancamento do parcial.
    documentosRelacionados: [resumo.pedidoId, resumo.osId, resumo.parcial && resumo.parcial.transacaoId].filter(Boolean),
    documentoTipo: pedido.tipo === 'saida' ? 'conta_pagar' : 'conta_receber',
    documentoNumero: numeroDoTitulo(pedido.tipo, resumo.descricao, pedido.transacaoId),
    alteracoes: [{
      campo: 'Situação',
      valorAnterior: 'Pendente',
      valorNovo: resumo.parcial ? `Pendente (pago ${reais(resumo.parcial.principalCentavos)}, falta ${reais(resumo.parcial.restanteCentavos)})` : 'Paga',
    }],
    ...(resumo.vendedorId ? { vendedorId: resumo.vendedorId } : {}),
  });
};

/** POST /api/financeiro/baixa  { tipo, transacaoId, formaPagamento, dataPagamento, bancoId?, tenantId? } */
router.post('/baixa', async (req, res) => {
  try {
    const hoje = hojeNoBrasil();
    const { erro, pedido } = validarPedidoDeBaixa(req.body, hoje);
    if (erro) return res.status(400).json({ error: erro });

    // Dar baixa do tipo + juros/multa e data anterior, se o pedido trouxer (item 15).
    if (barrarSemPermissoes(req, res, permissoesDaBaixa({ tipo: pedido.tipo, pedidos: [pedido], hoje }))) return undefined;

    const tenantId = empresaDaOperacao(req.user, req.body);
    // Receber sem "alterar juros e multa": juros e multa no padrao da filial (item 15).
    if (jurosNoPadrao(req.user, pedido.tipo)) pedido.jurosNoPadrao = true;
    const resumo = await registrarBaixa({ user: req.user, tenantId, pedido });

    registrarLogDaBaixa(req.user, tenantId, pedido, resumo, resumo.parcial ? ` (pagamento parcial; fica em aberto ${reais(resumo.parcial.restanteCentavos)})` : '');
    // Parcial (16/10/2026): a tela usa o id do lancamento parcial no numero do recibo.
    return res.json({ ok: true, ...(resumo.parcial ? { parcial: resumo.parcial } : {}) });
  } catch (erro) {
    return responderErro(res, erro, 'dar baixa');
  }
});

/**
 * Frente de Caixa (28/11/2026): receber notinha do cliente no caixa.
 * POST /api/financeiro/caixa/contas-abertas { clienteId }
 * POST /api/financeiro/caixa/receber { sessaoId, formaPagamento, bancoId?, titulos: [{ transacaoId, jurosCentavos, multaCentavos }] }
 * Regras e permissao em services/recebimentoNoCaixa.js.
 */
router.post('/caixa/contas-abertas', async (req, res) => {
  try {
    const contas = await listarAbertasDoCliente({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    return res.json({ ok: true, contas });
  } catch (erro) {
    return responderErro(res, erro, 'listar as contas do cliente');
  }
});

router.post('/caixa/receber', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const r = await receberNoCaixa({ user: req.user, tenantId, corpo: req.body || {} });
    r.resultados.filter((x) => x.ok).forEach((x) => {
      registrarLogDaBaixa(req.user, tenantId, {
        tipo: 'entrada', transacaoId: x.transacaoId, formaPagamento: r.formaPagamento, dataPagamento: r.dataPagamento,
      }, { descricao: x.descricao, valorCentavos: x.valorCentavos, bancoNome: x.bancoNome, ajustes: null }, ' (recebida na Frente de Caixa)');
    });
    return res.json({ ok: true, resultados: r.resultados });
  } catch (erro) {
    return responderErro(res, erro, 'receber as contas no caixa');
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
    const hoje = hojeNoBrasil();
    const { erro, pedidos } = validarPedidoDeBaixaEmLote(req.body, hoje);
    if (erro) return res.status(400).json({ error: erro });

    const { tipo } = pedidos[0];
    // Baixa em lote + dar baixa do tipo + juros/multa e data anterior (item 15), antes de gravar qualquer conta.
    if (barrarSemPermissoes(req, res, permissoesDaBaixa({ tipo, pedidos, hoje, lote: true }))) return undefined;

    const tenantId = empresaDaOperacao(req.user, req.body);
    const noPadrao = jurosNoPadrao(req.user, tipo);
    const resultados = [];
    for (const pedido of pedidos) {
      try {
        if (noPadrao) pedido.jurosNoPadrao = true;
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
    // O Historico de alteracoes do estorno e' gravado DENTRO da transacao (services/baixaFinanceira.js).
    const resumo = await registrarEstorno({ user: req.user, tenantId, pedido });
    return res.json({ ok: true, ajusteBancoCentavos: resumo.ajusteBancoCentavos });
  } catch (erro) {
    return responderErro(res, erro, 'estornar');
  }
});

/**
 * ACERTO COM FORNECEDOR (24/11/2026): o cliente paga direto o fornecedor. Ver
 * services/acertoFornecedor.js.
 *   GET  /api/financeiro/acerto-fornecedor            ultimos acertos
 *   POST /api/financeiro/acerto-fornecedor            { idAcerto, receber:[{transacaoId,valorCentavos}], pagar:[...], data, observacao }
 *   POST /api/financeiro/acerto-fornecedor/desfazer   { acertoId, motivo }
 * Quem faz precisa da permissao do acerto e de dar baixa em Receber E em Pagar
 * (item 15, 25/11/2026); desfazer pede a do acerto e a de estorno.
 */
router.get('/acerto-fornecedor', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'financeiro.receber')) {
      return res.status(403).json({ error: semPermissaoDeBaixa('entrada') });
    }
    const tenantId = empresaDaOperacao(req.user, { tenantId: req.query.tenantId });
    return res.json({ acertos: await acertoFornecedor.listar({ tenantId }) });
  } catch (erro) {
    return responderErro(res, erro, 'ler os acertos com fornecedor');
  }
});

router.post('/acerto-fornecedor', async (req, res) => {
  try {
    // O acerto da' baixa nos dois lados: alem da permissao dele, as de dar baixa em Receber e Pagar.
    if (barrarSemPermissoes(req, res, [
      PERMISSAO_FINANCEIRO.acertoFornecedor,
      PERMISSAO_FINANCEIRO.receberBaixar,
      PERMISSAO_FINANCEIRO.pagarBaixar,
    ])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    let usuarioNome = '';
    try {
      const snap = await db.collection('usuarios').doc(req.user.uid).get();
      usuarioNome = snap.exists ? String(snap.data().nome || snap.data().nomeResponsavel || '') : '';
    } catch { usuarioNome = ''; }
    const r = await acertoFornecedor.registrar({ user: req.user, tenantId, corpo: req.body || {}, usuarioNome });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'fazer o acerto com fornecedor');
  }
});

router.post('/acerto-fornecedor/desfazer', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.acertoFornecedor])) return undefined;
    if (!temPermissao(req.user, 'financeiro.estornar')) {
      return res.status(403).json({
        error: 'Você não tem permissão para desfazer acertos. Peça a um responsável liberar "Financeiro: Estornar Pagamento/Recebimento" no seu usuário.',
      });
    }
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await acertoFornecedor.desfazer({ user: req.user, tenantId, corpo: req.body || {} });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'desfazer o acerto com fornecedor');
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
      documentosRelacionados: [resumo.pedidoId, resumo.osId].filter(Boolean),
      documentoTipo: 'conta_receber',
      documentoNumero: numeroDoTitulo('entrada', resumo.descricao, pedido.transacaoId),
      motivo: pedido.motivo,
      alteracoes: [{ campo: 'Valor da parcela', valorAnterior: reais(resumo.deCentavos), valorNovo: reais(resumo.paraCentavos) }],
      critico: true,
    });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'alterar o valor da parcela');
  }
});

// ---------------------------------------------------------------------------
// CONTA A RECEBER LANCADA A MAO (19/10/2026) -- services/lancamentoReceber.js
// ---------------------------------------------------------------------------

/** POST /api/financeiro/receber/lancar -- { idLancamento, devedor, descricao, categoria, formaPrevista, documento, observacao, parcelas } */
router.post('/receber/lancar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.receberLancar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await lancarContaAReceber({ user: req.user, tenantId, corpo: req.body || {} });
    if (!r.jaLancado) {
      const quem = `${r.devedorTipo === 'fornecedor' ? 'fornecedor' : 'cliente'} ${r.devedorNome}`;
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'criacao',
        descricao: `Conta a receber lançada à mão por ${r.usuarioNome}: "${r.descricao}" do ${quem}, ${reais(r.totalCentavos)} em ${r.quantidade} parcela(s), forma prevista ${r.formaPrevista}.`,
        registroId: r.ids[0],
        // As outras parcelas do mesmo lancamento (o registro aparece em cada uma).
        documentosRelacionados: r.ids.slice(1),
        documentoTipo: 'conta_receber',
        documentoNumero: numeroDoTitulo('entrada', r.descricao, r.ids[0]),
        critico: true,
      });
    }
    return res.json({ ok: true, ids: r.ids, jaLancado: r.jaLancado, totalCentavos: r.totalCentavos, quantidade: r.quantidade });
  } catch (erro) {
    return responderErro(res, erro, 'lançar a conta a receber');
  }
});

/** POST /api/financeiro/receber/editar -- conta avulsa em aberto: descritivos, vencimento e quem paga (valor, so' pelo "Alterar valor"). */
router.post('/receber/editar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.receberEditar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await editarContaAReceber({ user: req.user, tenantId, corpo: req.body || {} });
    if (r.alteracoes.length > 0) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'edicao',
        descricao: `Conta a receber "${r.descricao}" editada: ${r.alteracoes.map((a) => a.campo).join(', ')}.`,
        registroId: req.body.transacaoId,
        documentoTipo: 'conta_receber',
        documentoNumero: numeroDoTitulo('entrada', r.descricao, req.body.transacaoId),
        alteracoes: r.alteracoes,
      });
    }
    return res.json({ ok: true, alterou: r.alteracoes.length > 0 });
  } catch (erro) {
    return responderErro(res, erro, 'editar a conta a receber');
  }
});

/** POST /api/financeiro/receber/cancelar -- { transacaoId, motivo } */
router.post('/receber/cancelar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.receberCancelar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    // O Historico de alteracoes do cancelamento e' gravado DENTRO da transacao (services/lancamentoReceber.js).
    await cancelarContaAReceber({ user: req.user, tenantId, corpo: req.body || {} });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a conta a receber');
  }
});

// ---------------------------------------------------------------------------
// CONTAS A RECEBER: CHEQUE E CREDITO DO CLIENTE (item 15, fase 2, 25/11/2026)
// -- services/recebimentoChequeCredito.js. Antes gravavam pelo navegador.
// ---------------------------------------------------------------------------

/**
 * POST /api/financeiro/receber/cheque -- { transacaoId, dataCompensacao, bancoId?, cheque? }
 * Baixa em cheque: a conta continua em aberto, aguardando a compensacao
 * (pelo valor inteiro, sem juros nem multa -- regra de sempre).
 */
router.post('/receber/cheque', async (req, res) => {
  try {
    const hoje = hojeNoBrasil();
    const dataCompensacao = String(req.body?.dataCompensacao || '');
    const pedidas = [PERMISSAO_FINANCEIRO.receberBaixar];
    // Bom para anterior a hoje (pagamento simplificado com data passada) pede a de data anterior, como a baixa.
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataCompensacao) && dataCompensacao < hoje) pedidas.push(PERMISSAO_FINANCEIRO.baixaDataAnterior);
    if (barrarSemPermissoes(req, res, pedidas)) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await registrarChequeNaBaixa({ user: req.user, tenantId, corpo: req.body || {} });
    if (!r.jaPaga) {
      const numero = r.numeroCheque ? ` nº ${r.numeroCheque}` : '';
      const dataBr = r.dataCompensacao.split('-').reverse().join('/');
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'baixa',
        descricao: `Recebimento "${r.descricao}" de ${reais(r.valorCentavos)} registrado em cheque${numero}, aguardando compensação em ${dataBr}`
          + `${r.bancoNome ? ` (banco ${r.bancoNome})` : ''}${r.numeroCheque ? '' : ' (sem os dados do cheque)'}. A conta continua em aberto até o cheque compensar.`,
        registroId: String(req.body.transacaoId),
        documentosRelacionados: [r.pedidoId, r.osId].filter(Boolean),
        documentoTipo: 'conta_receber',
        documentoNumero: numeroDoTitulo('entrada', r.descricao, req.body.transacaoId),
        alteracoes: [
          { campo: 'Forma de pagamento', valorAnterior: r.formaAnterior || null, valorNovo: 'Cheque' },
          { campo: 'Compensação prevista', valorAnterior: null, valorNovo: dataBr },
        ],
        ...(r.vendedorId ? { vendedorId: r.vendedorId } : {}),
      });
    }
    return res.json({ ok: true, jaPaga: r.jaPaga });
  } catch (erro) {
    return responderErro(res, erro, 'registrar o cheque');
  }
});

/**
 * POST /api/financeiro/receber/credito -- { transacaoId, valorCentavos, dataPagamento, valorEsperadoCentavos? }
 * Quita ou abate a conta com o credito de devolucao do cliente (lido aqui).
 */
router.post('/receber/credito', async (req, res) => {
  try {
    const hoje = hojeNoBrasil();
    const dataPagamento = String(req.body?.dataPagamento || '');
    const pedidas = [PERMISSAO_FINANCEIRO.receberBaixar, PERMISSAO_FINANCEIRO.baixaCreditoCliente];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dataPagamento) && dataPagamento < hoje) pedidas.push(PERMISSAO_FINANCEIRO.baixaDataAnterior);
    if (barrarSemPermissoes(req, res, pedidas)) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await abaterComCredito({ user: req.user, tenantId, corpo: req.body || {}, hoje });
    const dataBr = r.dataPagamento.split('-').reverse().join('/');
    const doCliente = r.clienteNome ? ` ${r.clienteNome}` : '';
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'financeiro',
      acao: 'baixa',
      descricao: r.quitou
        ? `Recebimento "${r.descricao}" quitado com ${reais(r.valorCentavos)} de crédito de devolução do cliente${doCliente}, em ${dataBr}.`
        : `Recebimento "${r.descricao}" abatido em ${reais(r.valorCentavos)} com crédito de devolução do cliente${doCliente}, em ${dataBr}. Fica em aberto ${reais(r.restanteCentavos)}.`,
      registroId: String(req.body.transacaoId),
      documentosRelacionados: [r.pedidoId, r.osId, r.pagamentoId].filter(Boolean),
      documentoTipo: 'conta_receber',
      documentoNumero: numeroDoTitulo('entrada', r.descricao, req.body.transacaoId),
      alteracoes: r.quitou
        ? [{ campo: 'Situação', valorAnterior: 'Pendente', valorNovo: 'Paga' }, { campo: 'Forma de pagamento', valorAnterior: r.formaAnterior || null, valorNovo: 'Crédito de Devolução' }]
        : [{ campo: 'Valor em aberto', valorAnterior: reais(r.anteriorCentavos), valorNovo: reais(r.restanteCentavos) }],
      ...(r.vendedorId ? { vendedorId: r.vendedorId } : {}),
    });
    return res.json({ ok: true, quitou: r.quitou, restanteCentavos: r.restanteCentavos });
  } catch (erro) {
    return responderErro(res, erro, 'abater com o crédito do cliente');
  }
});

// ---------------------------------------------------------------------------
// CONTAS A PAGAR PELO SERVIDOR (item 15, fase 2, 25/11/2026) -- services/lancamentoPagar.js
// ---------------------------------------------------------------------------

const quemFornece = (nome) => (nome ? `, fornecedor ${nome}` : ', sem fornecedor');

/** POST /api/financeiro/pagar/lancar -- { idLancamento, descricao, categoria, forma, totalCentavos, vencimento?, parcelas?, fornecedorId?, veiculoId?, motoristaId?, aceitarSomaDiferente? } */
router.post('/pagar/lancar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.pagarLancar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await lancarContaAPagar({ user: req.user, tenantId, corpo: req.body || {} });
    if (!r.jaLancado) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'criacao',
        descricao: `Conta a pagar "${r.descricao}" lançada por ${r.usuarioNome} em ${r.quantidade} ${r.forma === 'Cheque' ? 'cheque(s)' : 'parcela(s)'}, total de ${reais(r.totalCentavos)}${quemFornece(r.fornecedorNome)}. Forma: ${r.forma}.`,
        registroId: r.ids[0],
        documentosRelacionados: r.ids.slice(1),
        documentoTipo: 'conta_pagar',
        documentoNumero: numeroDoTitulo('saida', r.descricao, r.ids[0]),
      });
    }
    return res.json({ ok: true, ids: r.ids, jaLancado: r.jaLancado, totalCentavos: r.totalCentavos, quantidade: r.quantidade });
  } catch (erro) {
    return responderErro(res, erro, 'lançar a conta a pagar');
  }
});

/** POST /api/financeiro/pagar/editar -- { transacaoId, descricao, categoria, valorCentavos, vencimento, fornecedorId, veiculoId, motoristaId } */
router.post('/pagar/editar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.pagarEditar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await editarContaAPagar({ user: req.user, tenantId, corpo: req.body || {} });
    if (r.alteracoes.length > 0) {
      const mudouValor = r.alteracoes.some((a) => a.campo === 'Valor' || a.campo === 'Vencimento');
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'edicao',
        descricao: `Conta a pagar "${r.descricao}" alterada (${r.alteracoes.map((a) => a.campo).join(', ')}).`,
        registroId: String(req.body.transacaoId),
        documentoTipo: 'conta_pagar',
        documentoNumero: numeroDoTitulo('saida', r.descricao, req.body.transacaoId),
        alteracoes: r.alteracoes,
        ...(mudouValor ? { critico: true } : {}),
      });
    }
    return res.json({ ok: true, alterou: r.alteracoes.length > 0 });
  } catch (erro) {
    return responderErro(res, erro, 'alterar a conta a pagar');
  }
});

/** POST /api/financeiro/pagar/cancelar -- { transacaoId, motivo } */
router.post('/pagar/cancelar', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.pagarCancelar])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    // O Historico de alteracoes do cancelamento e' gravado DENTRO da transacao (services/lancamentoPagar.js).
    await cancelarContaAPagar({ user: req.user, tenantId, corpo: req.body || {} });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a conta a pagar');
  }
});

/**
 * POST /api/financeiro/categorias -- { tipo: 'receita'|'despesa', nome }. Categoria nova no plano
 * de contas pela tela de lancamento (19/10/2026); so' acrescenta. Desde 25/11/2026 (item 15)
 * pede a permissao propria (ja' vem marcada para quem tem Contas a Receber ou a Pagar).
 */
router.post('/categorias', async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.categorias])) return undefined;
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await adicionarCategoria({ user: req.user, tenantId, corpo: req.body || {} });
    if (!r.jaExistia) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'configuracoes',
        acao: 'criacao',
        descricao: `Categoria de ${r.tipo} "${r.nome}" criada no plano de contas pela tela de lançamento${r.filiais > 1 ? ` (vale nas ${r.filiais} filiais)` : ''}.`,
      });
    }
    return res.json({ ok: true, nome: r.nome, lista: r.lista, jaExistia: r.jaExistia });
  } catch (erro) {
    if (erro instanceof ErroConfiguracoesGerais) return res.status(erro.status).json({ error: erro.message });
    return responderErro(res, erro, 'criar a categoria');
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
      // As parcelas antigas (que viraram "Renegociada") e as novas.
      documentosRelacionados: [
        ...pedido.transacaoIds,
        ...Array.from({ length: resumo.quantidadeNovas || 0 }, (_, i) => `${resumo.renegociacaoId}_p${i + 1}`),
      ],
      documentoTipo: 'renegociacao',
      documentoNumero: `Renegociação de ${resumo.clienteNome}`,
      motivo: pedido.motivo,
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
    // O Historico de alteracoes e' gravado DENTRO da transacao (services/renegociacao.js).
    const resumo = await desfazerRenegociacao({ user: req.user, tenantId, pedido });
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
  'financeiro.cartao_taxa': 'Você não tem permissão para alterar a taxa do cartão. Peça a um responsável liberar "Financeiro: Banco — alterar a taxa do cartão a conciliar" no seu usuário.',
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

/** POST /api/financeiro/cartao/taxa  { transacaoId, taxaCentavos } -- parcela de cartao ainda a conciliar (26/11/2026). */
router.post('/cartao/taxa', rotaDeMovimento('financeiro.cartao_taxa', 'alterar a taxa do cartão', alterarTaxaDoCartao,
  (r) => `Taxa do cartão "${r.descricao}" alterada de ${reais(r.anteriorCentavos)} para ${reais(r.taxaCentavos)} (${String(r.percentual).replace('.', ',')}%); líquido a conciliar: ${reais(r.liquidoCentavos)}.`));

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
 * POST /api/financeiro/boleto/retorno/cancelado  { transacaoId, valorPagoCentavos, dataPagamento? }
 * Boleto cancelado aqui que o cliente pagou no banco (03/11/2026): nasce um
 * titulo avulso ja' pago, ligado ao boleto; venda e boleto seguem cancelados.
 */
router.post('/boleto/retorno/cancelado', rotaDeMovimento('financeiro.boletos', 'lançar o recebimento do boleto cancelado', receberBoletoCanceladoPeloRetorno,
  (r) => (r.jaLancado ? '' : `Boleto cancelado "${r.descricao}" pago no banco: recebimento avulso de ${reais(r.valorPagoCentavos)} lançado no banco ${r.bancoNome || ''} (${r.novoId}).`)));

/**
 * POST /api/financeiro/boleto/sistema-anterior
 *   { bancoId, boletos: [{ chave, nossoNumero, vencimento, emissao?, valorBoletoCentavos, arquivoRemessa? }] }
 * Liga as contas da migracao ao boleto que o sistema anterior ja' registrou no
 * banco (24/11/2026): o retorno passa a dar baixa nelas. Ver services/boletoSistemaAnterior.js.
 */
router.post('/boleto/sistema-anterior', async (req, res) => {
  try {
    if (!temPermissao(req.user, 'financeiro.boletos')) {
      return res.status(403).json({ error: MENSAGEM_SEM_PERMISSAO['financeiro.boletos'] });
    }
    const tenantId = empresaDaOperacao(req.user, req.body);
    const r = await vincularBoletosAnteriores({ user: req.user, tenantId, corpo: req.body || {}, hoje: hojeNoBrasil() });
    if (r.vinculados > 0) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'financeiro',
        acao: 'edicao',
        descricao: `${r.vinculados} boleto(s) do sistema anterior vinculado(s) às contas a receber da migração (banco ${r.bancoNome}), total de ${reais(r.totalCentavos)}. `
          + 'Já estavam registrados no banco; o arquivo de retorno passa a dar baixa neles.',
        registroId: String(req.body?.bancoId || ''),
        documentosRelacionados: r.idsVinculados.slice(0, 50),
        documentoTipo: 'conta_receber',
        documentoNumero: 'Boletos do sistema anterior',
      });
    }
    const resposta = { ...r };
    delete resposta.idsVinculados;
    return res.json({ ok: true, ...resposta });
  } catch (erro) {
    return responderErro(res, erro, 'vincular os boletos do sistema anterior');
  }
});

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

/** Cheque recebido, antes de compensar (21/10/2026) -- ver services/chequeSituacao.js. */
router.post('/cheque/depositar', rotaDeMovimento('financeiro.cheques', 'depositar o cheque', depositarCheque,
  (r) => `Cheque nº ${r.numeroCheque} ("${r.descricao}") depositado no banco ${r.bancoNome}, aguardando compensação.`));
router.post('/cheque/devolver', rotaDeMovimento('financeiro.cheques', 'marcar o cheque como devolvido', devolverCheque,
  (r, corpo) => `Cheque nº ${r.numeroCheque} ("${r.descricao}") marcado como devolvido${corpo?.motivo ? `: ${String(corpo.motivo).slice(0, 200)}` : ''}.`));
router.post('/cheque/voltar-carteira', rotaDeMovimento('financeiro.cheques', 'voltar o cheque para a carteira', voltarChequeParaCarteira,
  (r) => `Cheque nº ${r.numeroCheque} ("${r.descricao}") de volta à carteira.`));

/** POST /api/financeiro/banco/transferencia  { origemId, destinoId, valorCentavos, descricao?, data } */
router.post('/banco/transferencia', rotaDeMovimento('cadastros.bancos', 'fazer a transferência', transferirEntreBancos,
  (r) => `Transferência de ${reais(r.valorCentavos)} do banco ${r.nomeOrigem} para ${r.nomeDestino}.`));

// ---------------------------------------------------------------------------
// Creditos e de onde vem cada um (26/11/2026) -- so' leitura, services/creditosConsulta.js.
// ---------------------------------------------------------------------------
const creditosConsulta = require('../services/creditosConsulta');

const rotaDeCreditos = (acao, consulta) => async (req, res) => {
  try {
    if (barrarSemPermissoes(req, res, [PERMISSAO_FINANCEIRO.creditosVer])) return undefined;
    return res.json(await consulta(req.user.tenantId, req.query || {}));
  } catch (erro) {
    return responderErro(res, erro, acao);
  }
};

/** GET /api/financeiro/creditos/clientes -- saldo de credito em aberto de cada cliente. */
router.get('/creditos/clientes', rotaDeCreditos('ver os créditos dos clientes', (tenantId) => creditosConsulta.saldosDosClientes({ tenantId })));

/** GET /api/financeiro/creditos/cliente?clienteId=&clienteNome= -- os creditos, a origem e onde foram usados. */
router.get('/creditos/cliente', rotaDeCreditos('ver os créditos do cliente', (tenantId, q) => creditosConsulta.creditosDoCliente({
  tenantId,
  clienteId: String(q.clienteId || '').slice(0, 128),
  clienteNome: String(q.clienteNome || '').slice(0, 200),
})));

/** GET /api/financeiro/creditos/fornecedores -- o que cada fornecedor deve a empresa, em aberto. */
router.get('/creditos/fornecedores', rotaDeCreditos('ver o que os fornecedores devem', (tenantId) => creditosConsulta.saldosDosFornecedores({ tenantId })));

/** GET /api/financeiro/creditos/fornecedor?fornecedorId= -- as contas a receber do fornecedor e a origem. */
router.get('/creditos/fornecedor', rotaDeCreditos('ver o que o fornecedor deve', (tenantId, q) => creditosConsulta.contasDoFornecedor({
  tenantId,
  fornecedorId: String(q.fornecedorId || '').slice(0, 128),
})));

module.exports = router;
