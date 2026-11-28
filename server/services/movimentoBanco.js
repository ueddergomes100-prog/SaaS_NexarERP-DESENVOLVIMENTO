/*
 * MOVIMENTO DE SALDO DE BANCO NO SERVIDOR (item 8 da auditoria de infra,
 * fatia 2 -- 2026-10-05).
 *
 * Continua o que a fatia 1 fez com Dar Baixa/Estornar (services/
 * baixaFinanceira.js): as telas do Financeiro que ainda mexiam em
 * `bancos.saldoCentavos` pelo navegador passam a pedir ao servidor.
 *
 *   - Banco > conciliar recebimento de cartao      (financeiro.banco)
 *   - Cheques > compensar cheque recebido          (financeiro.cheques)
 *   - Cheques > compensar cheque emitido           (financeiro.cheques)
 *   - Boletos > baixa pelo arquivo de retorno      (financeiro.boletos)
 *   - Cadastro de Bancos > lancamento manual       (cadastros.bancos)
 *   - Cadastro de Bancos > transferencia           (cadastros.bancos)
 *
 * As gravacoes sao as mesmas que as telas faziam (campo a campo), com as
 * regras de dinheiro de server/domain/ (o src/utils compilado). Diferencas de
 * proposito: tudo precisa ser da mesma empresa; o nome do banco vem do
 * cadastro; titulo ja' pago nao e' compensado/conciliado de novo (a tela
 * ignorava em silencio e dizia "sucesso"); e o resumo de pagamentos da
 * venda/OS sai completo tambem no cheque (antes faltavam taxas e liquido).
 */
/** Categoria do plano de contas da tarifa do banco no boleto pago (28/11/2026). */
const CATEGORIA_TARIFA_BANCARIA = 'Tarifas bancárias';
const { db } = require('../config/firebase');
const {
  applyPaymentReceipt,
  isCardPayment,
  legacyPaymentForTransaction,
  settledFinancialNatureForPayment,
  transactionNetCents,
  validateBankTransfer,
} = require('../domain/financeDomain');
const { montarBaixaManual, validarDataBaixa } = require('../domain/baixaFinanceiraDomain');
const { CATEGORIA_DO_ACRESCIMO, CATEGORIA_DO_DESCONTO } = require('../domain/ajustesDaBaixaDomain');
const vpc = require('../domain/vinculosPlanoContasDomain');

/** Configuracao da filial para o plano de contas (28/11/2026). Ler antes de qualquer escrita da transacao. */
const lerConfigDoPlano = async (tx, tenantId) => {
  const snap = await tx.get(db.collection('configuracoes').doc(tenantId));
  return snap.exists ? (snap.data() || {}) : {};
};
const { centavosParaAOrigem } = require('../domain/alteracaoValorTituloDomain');
const { recusarSeRenegociada, lerRenegociacaoDoTitulo, quitarOrigensSeRenegociacaoPaga } = require('./renegociacaoOrigem');
const cashback = require('./cashback');

/** Vendas que podem ter ficado pagas por inteiro: o cashback gera depois da transacao (idempotente). */
const vendasParaCashback = (dados, renegociacao, quitou) => {
  const ids = new Set();
  if (dados && dados.pedidoId) ids.add(String(dados.pedidoId));
  if (quitou && renegociacao) renegociacao.origens.forEach((o) => { if (o.ref.parent.id === 'pedidos_venda') ids.add(o.ref.id); });
  return [...ids];
};
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const {
  ErroBaixa,
  camposDoResumoDePagamentos,
  agora,
  lerTitulo,
  lerOrigem,
  lerBanco,
  centavosDoTitulo,
} = require('./baixaFinanceira');

/** "R$ 532,00" para as descricoes gravadas. */
const reaisSimples = (centavos) => `R$ ${(Number(centavos || 0) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DESCRICAO_MAX = 200;

const idObrigatorio = (valor, mensagem) => {
  const id = String(valor || '').trim();
  if (!ID_VALIDO.test(id)) throw new ErroBaixa(400, mensagem);
  return id;
};

const jaFoiPago = (mensagem) => new ErroBaixa(409, mensagem);

/** Atualiza a venda/OS de origem com o recebimento (mesma regra da baixa). */
const registrarRecebimentoNaOrigem = (tx, user, origem, transacaoId, dados, recebimento, resumoDaAlteracao) => {
  if (!origem.ref) return;
  const pagamentos = Array.isArray(origem.dados.pagamentos) && origem.dados.pagamentos.length > 0
    ? origem.dados.pagamentos
    : [legacyPaymentForTransaction(transacaoId, dados)];
  const atualizados = applyPaymentReceipt(pagamentos, {
    transactionId: transacaoId,
    paymentIndex: dados.paymentIndex,
    receiptId: transacaoId,
    ...recebimento,
    // O titulo sai daqui quitado: com valor alterado, quita o pagamento inteiro da venda.
    amountCents: centavosParaAOrigem(pagamentos, {
      transactionId: transacaoId,
      paymentIndex: dados.paymentIndex,
      titulo: dados,
      recebidoCentavos: recebimento.amountCents,
      tituloQuitado: true,
    }),
  });
  tx.update(origem.ref, {
    ...camposDoResumoDePagamentos(atualizados),
    updatedAt: agora(),
    ...buildDocumentUpdateMetadata(user.uid, agora(), resumoDaAlteracao),
  });
};

/** Venda/OS do titulo, sem travar quando ela esta' cancelada (retorno do banco: o dinheiro ja' entrou). */
const lerOrigemSemTravar = async (tx, tenantId, dados) => {
  const vendaId = dados.pedidoId;
  const osId = dados.osId;
  if (!vendaId && !osId) return { ref: null, dados: null };
  const ref = vendaId
    ? db.collection('pedidos_venda').doc(String(vendaId))
    : db.collection('ordens_de_servico').doc(String(osId));
  const snap = await tx.get(ref);
  if (!snap.exists || snap.data().tenantId !== tenantId || snap.data().status === 'Cancelada') return { ref: null, dados: null };
  return { ref, dados: snap.data() };
};

/**
 * Titulo de Receber que entra no banco de uma vez (cartao conciliado, cheque
 * compensado): titulo Paga, banco credita o LIQUIDO, venda/OS atualizada.
 */
const creditarRecebimento = async ({ user, tenantId, transacaoId, bancoIdEscolhido, hoje, tipoRecebimento }) => {
  const ehCheque = tipoRecebimento === 'cheque';
  const resumo = {};

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    if (dados.status === 'Paga') {
      throw jaFoiPago(ehCheque
        ? 'Este cheque já foi compensado (talvez por outra pessoa). Atualize a tela.'
        : 'Este recebimento de cartão já foi conciliado (talvez por outra pessoa). Atualize a tela.');
    }
    if (dados.status === 'Cancelada') throw new ErroBaixa(400, 'Um título cancelado não pode ser conciliado.');
    recusarSeRenegociada(dados);

    const forma = String(dados.formaPagamento || '');
    if (ehCheque && forma !== 'Cheque' && !dados.cheque) {
      throw new ErroBaixa(400, 'Este título não é um cheque. Dê baixa por Contas a Receber.');
    }
    if (!ehCheque && !isCardPayment(forma)) {
      throw new ErroBaixa(400, 'Este título não é de cartão. Dê baixa por Contas a Receber.');
    }

    // O banco gravado no titulo manda; a escolha da tela so' vale para titulo antigo sem banco.
    const bancoId = dados.bancoId || bancoIdEscolhido;
    if (!bancoId || !ID_VALIDO.test(String(bancoId))) {
      throw new ErroBaixa(400, ehCheque ? 'Escolha em qual banco o cheque compensou.' : 'Escolha em qual banco o valor caiu.');
    }

    const origem = await lerOrigem(tx, tenantId, dados, 'conciliado');
    const banco = await lerBanco(tx, tenantId, String(bancoId), 'O banco selecionado não foi encontrado. Atualize a tela e escolha de novo.');
    const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, transacaoId, dados);

    const valorCentavos = centavosDoTitulo(dados);
    const liquidoCentavos = transactionNetCents(dados);
    const bancoNome = String(banco.dados.nome || '').trim() || null;
    resumo.descricao = String(dados.descricao || '');
    resumo.liquidoCentavos = liquidoCentavos;
    resumo.bancoNome = bancoNome;

    tx.update(titulo.ref, {
      status: 'Paga',
      dataPagamento: hoje,
      naturezaFinanceira: settledFinancialNatureForPayment(ehCheque ? 'Cheque' : forma),
      movimentaCaixaFisico: false,
      bancoId: String(bancoId),
      bancoNome,
      recebidoEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), ehCheque ? 'Cheque compensado' : 'Cartão conciliado no banco'),
    });
    tx.update(banco.ref, {
      saldoCentavos: Number(banco.dados.saldoCentavos || 0) + liquidoCentavos,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), ehCheque
        ? `Compensação de cheque nº ${dados.cheque?.numeroCheque || ''}`
        : 'Recebimento de cartão conciliado'),
    });
    registrarRecebimentoNaOrigem(tx, user, origem, transacaoId, dados, {
      amountCents: valorCentavos,
      method: ehCheque ? 'Cheque' : forma,
      receivedAt: hoje,
    }, ehCheque ? 'Cheque compensado' : 'Recebimento de cartão conciliado no banco');
    const quitou = quitarOrigensSeRenegociacaoPaga(tx, user, renegociacao, hoje);
    resumo.vendasParaCashback = vendasParaCashback(dados, renegociacao, quitou);
  });

  for (const pedidoId of resumo.vendasParaCashback || []) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });

  return resumo;
};

const conciliarCartao = ({ user, tenantId, corpo, hoje }) => creditarRecebimento({
  user,
  tenantId,
  hoje,
  tipoRecebimento: 'cartao',
  transacaoId: idObrigatorio(corpo?.transacaoId, 'Título inválido. Atualize a tela e tente de novo.'),
  bancoIdEscolhido: corpo?.bancoId ? String(corpo.bancoId).trim() : '',
});

/**
 * TAXA DO CARTAO A CONCILIAR (26/11/2026, Embala Minas: "as vezes da uma
 * diferenca"). O dono, ou quem tem "Financeiro: Banco -- alterar a taxa do
 * cartao a conciliar", corrige a taxa de UMA parcela ainda pendente: muda a taxa
 * e o liquido do titulo (que e' o que entra no banco ao conciliar) e o total de
 * taxas da venda/OS. Parcela ja' conciliada nao muda: o banco ja' recebeu.
 * Regra pura em `camposDaTaxaDoCartao` (testada sem banco).
 */
const camposDaTaxaDoCartao = ({ dados, taxaCentavos }) => {
  const bruto = Number(dados.valorBrutoCentavos ?? dados.valorCentavos ?? Math.round(Number(dados.valor || 0) * 100));
  if (!Number.isInteger(taxaCentavos) || taxaCentavos < 0) {
    return { erro: 'Informe a taxa em reais, zero ou maior (por exemplo 1,76).' };
  }
  if (!(bruto > 0)) return { erro: 'Esta parcela não tem valor. Atualize a tela.' };
  if (taxaCentavos >= bruto) {
    return { erro: `A taxa não pode ser igual ou maior que a parcela (${reaisSimples(bruto)}). Confira o valor digitado.` };
  }
  const liquido = bruto - taxaCentavos;
  const percentual = Math.round((taxaCentavos / bruto) * 10000) / 100;
  const reais = (c) => Math.round(c) / 100;
  const cartao = dados.cartao && typeof dados.cartao === 'object' ? dados.cartao : null;
  const detalhe = cartao && Array.isArray(cartao.detalhamentoParcelas) && cartao.detalhamentoParcelas.length === 1
    ? [{ ...cartao.detalhamentoParcelas[0], valorLiquidoCentavos: liquido, valorLiquido: reais(liquido) }]
    : null;
  const anterior = Number(dados.valorTaxaCentavos ?? (cartao && cartao.valorTaxaCentavos) ?? 0) || 0;
  return {
    anteriorCentavos: anterior,
    diferencaCentavos: taxaCentavos - anterior,
    liquidoCentavos: liquido,
    percentual,
    campos: {
      valorTaxa: reais(taxaCentavos),
      valorTaxaCentavos: taxaCentavos,
      valorLiquido: reais(liquido),
      valorLiquidoCentavos: liquido,
      ...(cartao ? {
        cartao: {
          ...cartao,
          taxaPercentual: percentual,
          valorTaxa: reais(taxaCentavos),
          valorTaxaCentavos: taxaCentavos,
          valorLiquido: reais(liquido),
          valorLiquidoCentavos: liquido,
          ...(detalhe ? { detalhamentoParcelas: detalhe } : {}),
        },
      } : {}),
    },
  };
};

const alterarTaxaDoCartao = async ({ user, tenantId, corpo }) => {
  const transacaoId = idObrigatorio(corpo?.transacaoId, 'Parcela inválida. Atualize a tela e tente de novo.');
  const taxaCentavos = Math.round(Number(corpo?.taxaCentavos));
  const resumo = {};
  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    if (!isCardPayment(String(dados.formaPagamento || ''))) throw new ErroBaixa(400, 'Esta parcela não é de cartão: não tem taxa para alterar.');
    if (dados.status === 'Paga') throw new ErroBaixa(409, 'Esta parcela já foi conciliada: o banco já recebeu o líquido. A taxa não muda mais por aqui.');
    if (dados.status === 'Cancelada') throw new ErroBaixa(409, 'Esta parcela foi cancelada: não há taxa para alterar.');
    const conta = camposDaTaxaDoCartao({ dados, taxaCentavos });
    if (conta.erro) throw new ErroBaixa(400, conta.erro);
    // Total de taxas gravado na venda/OS (o resumo dos pagamentos) acompanha a diferenca.
    const origem = await lerOrigemSemTravar(tx, tenantId, dados);
    tx.update(titulo.ref, {
      ...conta.campos,
      taxaAlteradaManualmente: { deCentavos: conta.anteriorCentavos, paraCentavos: taxaCentavos, por: user.uid, em: agora() },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Taxa do cartão alterada'),
    });
    if (origem.ref && conta.diferencaCentavos !== 0 && origem.dados.totalTaxasPagamentoCentavos !== undefined) {
      const total = Math.max(0, Number(origem.dados.totalTaxasPagamentoCentavos || 0) + conta.diferencaCentavos);
      tx.update(origem.ref, { totalTaxasPagamentoCentavos: total, totalTaxasPagamento: total / 100, updatedAt: agora() });
    }
    resumo.descricao = String(dados.descricao || '');
    resumo.anteriorCentavos = conta.anteriorCentavos;
    resumo.taxaCentavos = taxaCentavos;
    resumo.liquidoCentavos = conta.liquidoCentavos;
    resumo.percentual = conta.percentual;
  });
  return resumo;
};

const compensarChequeRecebido = ({ user, tenantId, corpo, hoje }) => creditarRecebimento({
  user,
  tenantId,
  hoje,
  tipoRecebimento: 'cheque',
  transacaoId: idObrigatorio(corpo?.transacaoId, 'Cheque inválido. Atualize a tela e tente de novo.'),
  bancoIdEscolhido: corpo?.bancoId ? String(corpo.bancoId).trim() : '',
});

/**
 * Cheque EMITIDO pela empresa (pagou uma despesa): so' na compensacao o banco
 * e' debitado e o titulo vira Pago, com a mesma marca do "Dar Baixa" do Contas
 * a Pagar -- o estorno funciona igual.
 */
const compensarChequeEmitido = async ({ user, tenantId, corpo, hoje }) => {
  const transacaoId = idObrigatorio(corpo?.transacaoId, 'Cheque inválido. Atualize a tela e tente de novo.');
  const dataPagamento = String(corpo?.dataPagamento || '').trim();
  const erroData = validarDataBaixa(dataPagamento, hoje);
  if (erroData) throw new ErroBaixa(400, erroData === 'Informe a data em que foi pago.' ? 'Informe a data em que o cheque compensou.' : erroData);
  const resumo = {};

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'saida' });
    const dados = titulo.dados;
    if (dados.status === 'Paga') throw jaFoiPago('Este cheque já foi compensado (talvez por outra pessoa). Atualize a tela.');
    if (dados.status === 'Cancelada') throw new ErroBaixa(400, 'Um título cancelado não pode ser compensado.');
    if (!dados.bancoId) {
      throw new ErroBaixa(400, 'Este cheque emitido não tem o banco da conta. Lance a despesa de novo informando o banco do cheque.');
    }
    const banco = await lerBanco(tx, tenantId, String(dados.bancoId), 'O banco do cheque não foi encontrado. Confira o cadastro de bancos.');
    const valorCentavos = centavosDoTitulo(dados);
    resumo.descricao = String(dados.descricao || '');
    resumo.valorCentavos = valorCentavos;

    tx.update(titulo.ref, {
      status: 'Paga',
      dataPagamento,
      valorCentavos,
      baixaManual: montarBaixaManual({
        origem: 'contas_pagar',
        formaPagamento: 'Cheque',
        dataPagamento,
        valorCentavos,
        bancoId: String(dados.bancoId),
        movimentoBancoCentavos: -valorCentavos,
      }),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Cheque emitido compensado'),
    });
    tx.update(banco.ref, {
      saldoCentavos: Number(banco.dados.saldoCentavos || 0) - valorCentavos,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Compensação do cheque nº ${dados.cheque?.numeroCheque || ''} (${dados.descricao || ''})`),
    });
  });

  return resumo;
};

/**
 * Baixa de UM boleto pago, vinda do arquivo de retorno do banco. O valor pago
 * e a data vem do arquivo (lido na tela); o titulo e o banco, daqui.
 * Boleto ja' pago e' ignorado (o mesmo arquivo pode ser importado de novo).
 */
const baixarBoletoPeloRetorno = async ({ user, tenantId, corpo, hoje }) => {
  const transacaoId = idObrigatorio(corpo?.transacaoId, 'Boleto inválido. Atualize a tela e tente de novo.');
  const valorPagoCentavos = Number(corpo?.valorPagoCentavos);
  if (!Number.isInteger(valorPagoCentavos) || valorPagoCentavos <= 0) {
    throw new ErroBaixa(400, 'O arquivo de retorno trouxe um valor pago inválido para este boleto. Confira o arquivo com o banco.');
  }
  const dataInformada = String(corpo?.dataPagamento || '').trim();
  const dataPagamento = DATA_ISO.test(dataInformada) ? dataInformada : hoje;
  // Detalhe do arquivo do banco (28/11/2026): so' para a tela de Boletos mostrar o
  // recebido de fato. Nao muda a baixa (ela segue pelo valor pago). So' numero inteiro >= 0.
  const detalheBruto = corpo && typeof corpo.detalheDoRetorno === 'object' && corpo.detalheDoRetorno ? corpo.detalheDoRetorno : {};
  const retornoDoBanco = {};
  for (const campo of ['jurosMultaCentavos', 'descontoCentavos', 'tarifaCentavos', 'valorLiquidoCentavos']) {
    const n = Number(detalheBruto[campo]);
    if (Number.isInteger(n) && n >= 0 && n <= 100000000000) retornoDoBanco[campo] = n;
  }
  const temRetornoDoBanco = Object.keys(retornoDoBanco).length > 0;
  const resumo = { jaEstavaPago: false };

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    const config = await lerConfigDoPlano(tx, tenantId);
    if (dados.status === 'Paga') {
      resumo.jaEstavaPago = true;
      return;
    }
    if (dados.status === 'Cancelada') {
      // Cancelado aqui, pago no banco (03/11/2026): nao da' baixa (a venda nao
      // existe mais), mas tambem nao derruba o lote -- a tela pergunta se
      // lanca como recebimento avulso (receberBoletoCanceladoPeloRetorno).
      Object.assign(resumo, {
        boletoCancelado: true,
        jaLancadoAvulso: Boolean(dados.boleto && dados.boleto.recebimentoAvulsoId),
        descricao: String(dados.descricao || transacaoId),
        clienteNome: String(dados.clienteNome || dados.fornecedorNome || ''),
        valorCentavos: centavosDoTitulo(dados),
      });
      return;
    }
    recusarSeRenegociada(dados);
    if (!dados.boleto) throw new ErroBaixa(400, `O título "${dados.descricao || transacaoId}" não é um boleto emitido pelo sistema.`);

    const banco = dados.bancoId
      ? await lerBanco(tx, tenantId, String(dados.bancoId), 'Banco do boleto não encontrado. Confira o cadastro de bancos.')
      : null;
    // Boleto de parcela de renegociacao (15/10/2026): o ultimo pago quita as vendas/OS antigas.
    const renegociacao = await lerRenegociacaoDoTitulo(tx, tenantId, transacaoId, dados);
    // Venda/OS de origem (15/10/2026): o boleto pago pelo retorno passa a quitar o
    // pagamento dela, como o Dar Baixa ja' fazia -- antes a venda ficava "Pendente"
    // para sempre. Venda/OS cancelada nao trava o retorno (o dinheiro entrou no banco).
    const origem = await lerOrigemSemTravar(tx, tenantId, dados);
    resumo.descricao = String(dados.descricao || '');

    // Pago diferente do titulo (25/11/2026): o banco recebe o valor pago, mas o
    // extrato so' mostrava o titulo -- a Embala Minas teve R$ 9,33 de juros no
    // saldo sem linha nenhuma. A diferenca vira lancamento proprio, como na baixa
    // manual: a mais = "Juros e multa" (ou "Valor pago a mais" no boleto do
    // sistema anterior com parte ja' paga la'); a menos = "Desconto concedido".
    const valorTituloCentavos = centavosDoTitulo(dados);
    const aMaisCentavos = Math.max(0, valorPagoCentavos - valorTituloCentavos);
    const aMenosCentavos = Math.max(0, valorTituloCentavos - valorPagoCentavos);
    const valorNoBancoCentavos = Number((dados.boleto && dados.boleto.valorNoBancoCentavos) || 0);
    const pagoAMaisDoSistemaAnterior = aMaisCentavos > 0 && valorNoBancoCentavos > valorTituloCentavos;
    const acrescimoRef = aMaisCentavos > 0 ? db.collection('transacoes').doc() : null;
    const descontoRef = aMenosCentavos > 0 ? db.collection('transacoes').doc() : null;
    // Tarifa do banco (28/11/2026, decisao do dono): o banco credita o LIQUIDO.
    // A tarifa que o arquivo trouxe vira despesa propria ("Tarifas bancarias",
    // no plano de contas) e sai do saldo do banco -- o saldo bate com o extrato.
    const tarifaCentavos = Math.min(valorPagoCentavos, Number(retornoDoBanco.tarifaCentavos) || 0);
    const tarifaRef = tarifaCentavos > 0 ? db.collection('transacoes').doc() : null;
    const lancamentoDaDiferenca = ({ tipo, categoria, descricao, valorCentavos, ligacao, motivo }) => ({
      tenantId,
      tipo,
      status: 'Paga',
      descricao,
      categoria,
      valor: valorCentavos / 100,
      valorCentavos,
      data: dataPagamento,
      dataVencimento: dataPagamento,
      dataPagamento,
      formaPagamento: 'Boleto',
      naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
      movimentaCaixaFisico: false,
      ...(banco ? { bancoId: String(dados.bancoId), bancoNome: String(banco.dados.nome || dados.bancoNome || '') } : {}),
      clienteId: dados.clienteId || null,
      clienteNome: dados.clienteNome || null,
      ...(dados.filialId ? { filialId: dados.filialId } : {}),
      ...(dados.vendedorId ? { vendedorId: dados.vendedorId } : {}),
      ...ligacao,
      origemLancamento: 'retorno_boleto',
      createdAt: agora(),
      ...(tipo === 'entrada' ? { recebidoEm: agora() } : {}),
      updatedAt: agora(),
      criadoPor: user.uid,
      criadoEm: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), motivo),
    });
    if (acrescimoRef) {
      tx.set(acrescimoRef, lancamentoDaDiferenca({
        tipo: 'entrada',
        // Plano de contas (28/11/2026): vinculos "Boleto pago a mais" e "Juros e multa recebidos".
        categoria: pagoAMaisDoSistemaAnterior ? vpc.categoriaDoEvento(config, 'pago_a_mais') : (vpc.categoriaDoEvento(config, 'juros_recebidos') || CATEGORIA_DO_ACRESCIMO.entrada),
        descricao: pagoAMaisDoSistemaAnterior
          ? `Valor pago a mais — ${resumo.descricao} (o boleto do sistema anterior valia ${reaisSimples(valorNoBancoCentavos)}; parte já tinha sido paga lá)`
          : `Juros e multa — ${resumo.descricao}`,
        valorCentavos: aMaisCentavos,
        ligacao: { acrescimoDaTransacaoId: transacaoId, jurosCentavos: aMaisCentavos, multaCentavos: 0 },
        motivo: `Diferença a mais do boleto pago (retorno do banco): "${resumo.descricao}"`,
      }));
    }
    if (descontoRef) {
      tx.set(descontoRef, lancamentoDaDiferenca({
        tipo: 'saida',
        categoria: vpc.categoriaDoEvento(config, 'descontos_concedidos') || CATEGORIA_DO_DESCONTO.entrada,
        descricao: `Desconto concedido — ${resumo.descricao}`,
        valorCentavos: aMenosCentavos,
        ligacao: { descontoDaTransacaoId: transacaoId },
        motivo: `Boleto pago com valor menor que o título (retorno do banco): "${resumo.descricao}"`,
      }));
    }
    if (tarifaRef) {
      tx.set(tarifaRef, lancamentoDaDiferenca({
        tipo: 'saida',
        categoria: vpc.categoriaDoEvento(config, 'tarifa_bancaria') || CATEGORIA_TARIFA_BANCARIA,
        descricao: `Tarifa do banco — ${resumo.descricao}`,
        valorCentavos: tarifaCentavos,
        ligacao: { tarifaDaTransacaoId: transacaoId },
        motivo: `Tarifa cobrada pelo banco no boleto pago (retorno do banco): "${resumo.descricao}"`,
      }));
    }
    resumo.valorPagoCentavos = valorPagoCentavos;
    resumo.acrescimoCentavos = aMaisCentavos;
    resumo.descontoCentavos = aMenosCentavos;
    resumo.tarifaCentavos = tarifaCentavos;

    tx.update(titulo.ref, {
      status: 'Paga',
      dataPagamento,
      naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
      movimentaCaixaFisico: false,
      boleto: { ...(dados.boleto || {}), status: 'pago', valorPagoCentavos, ...(temRetornoDoBanco ? { retorno: retornoDoBanco } : {}) },
      ...(acrescimoRef ? { acrescimoCentavos: aMaisCentavos, acrescimoTransacaoId: acrescimoRef.id, jurosCentavos: aMaisCentavos, multaCentavos: 0 } : {}),
      ...(descontoRef ? { descontoCentavos: aMenosCentavos, descontoTransacaoId: descontoRef.id } : {}),
      ...(tarifaRef ? { tarifaCentavos, tarifaTransacaoId: tarifaRef.id } : {}),
      recebidoEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Baixa pelo retorno do banco'),
    });
    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + valorPagoCentavos - tarifaCentavos,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Boleto pago (retorno): "${resumo.descricao}"`),
      });
    }
    if (origem.ref) {
      try {
        registrarRecebimentoNaOrigem(tx, user, origem, transacaoId, dados, {
          amountCents: centavosDoTitulo(dados),
          method: 'Boleto',
          receivedAt: dataPagamento,
        }, 'Boleto pago (retorno do banco)');
      } catch (erroOrigem) {
        // Pagamento da venda nao encontrado (venda antiga/editada): o boleto e' baixado
        // assim mesmo, como sempre foi -- so' a venda fica sem a marca.
        console.warn(`[Financeiro] retorno do boleto ${transacaoId}: venda/OS de origem nao atualizada:`, erroOrigem && erroOrigem.message);
      }
    }
    const quitou = quitarOrigensSeRenegociacaoPaga(tx, user, renegociacao, dataPagamento);
    resumo.vendasParaCashback = vendasParaCashback(dados, renegociacao, quitou);
  });

  for (const pedidoId of resumo.vendasParaCashback || []) await cashback.gerarSeDevidoSemFalhar({ user, tenantId, pedidoId });

  return resumo;
};

/** Categoria do titulo avulso que nasce de boleto cancelado pago no banco. */
const CATEGORIA_BOLETO_CANCELADO_PAGO = 'BOLETO PAGO DE VENDA CANCELADA';
const ORIGEM_RETORNO_BOLETO_CANCELADO = 'retorno_boleto_cancelado';

/**
 * Boleto CANCELADO no sistema que o cliente pagou no banco (03/11/2026, caso
 * real da Sol Life). A venda e o boleto continuam cancelados -- ressuscitar o
 * titulo misturaria receita de venda que nao existe. O dinheiro entrou, entao
 * nasce um titulo de Receber avulso ja' pago, ligado ao boleto, e o banco
 * credita. Id fixo (`<boleto>_avulso`) + marca no boleto: repetir o arquivo
 * nao lanca de novo. Quem decide devolver ou refaturar e' a empresa, depois.
 */
const receberBoletoCanceladoPeloRetorno = async ({ user, tenantId, corpo, hoje }) => {
  const transacaoId = idObrigatorio(corpo?.transacaoId, 'Boleto inválido. Atualize a tela e tente de novo.');
  const valorPagoCentavos = Number(corpo?.valorPagoCentavos);
  if (!Number.isInteger(valorPagoCentavos) || valorPagoCentavos <= 0) {
    throw new ErroBaixa(400, 'O arquivo de retorno trouxe um valor pago inválido para este boleto. Confira o arquivo com o banco.');
  }
  const dataInformada = String(corpo?.dataPagamento || '').trim();
  const dataPagamento = DATA_ISO.test(dataInformada) ? dataInformada : hoje;
  const resumo = { jaLancado: false, valorPagoCentavos };

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    const descricaoDoBoleto = String(dados.descricao || transacaoId);
    resumo.descricao = descricaoDoBoleto;
    if (!dados.boleto) throw new ErroBaixa(400, `O título "${descricaoDoBoleto}" não é um boleto emitido pelo sistema.`);
    if (dados.status !== 'Cancelada') {
      throw new ErroBaixa(409, `O boleto "${descricaoDoBoleto}" não está cancelado: importe o retorno de novo para dar a baixa normal.`);
    }
    if (dados.boleto.recebimentoAvulsoId) {
      resumo.jaLancado = true;
      resumo.novoId = String(dados.boleto.recebimentoAvulsoId);
      return;
    }
    if (!dados.bancoId) {
      throw new ErroBaixa(400, `O boleto "${descricaoDoBoleto}" não tem banco vinculado. Lance o recebimento à mão em Contas a Receber.`);
    }
    const banco = await lerBanco(tx, tenantId, String(dados.bancoId), 'Banco do boleto não encontrado. Confira o cadastro de bancos.');
    const bancoNome = String(banco.dados.nome || '');
    const nossoNumero = String(dados.boleto.nossoNumero || '');
    const novoRef = db.collection('transacoes').doc(`${transacaoId}_avulso`);
    const dataBr = dataPagamento.split('-').reverse().join('/');
    resumo.novoId = novoRef.id;
    resumo.bancoNome = bancoNome;

    tx.set(novoRef, {
      tenantId,
      tipo: 'entrada',
      status: 'Paga',
      descricao: `${CATEGORIA_BOLETO_CANCELADO_PAGO}: ${descricaoDoBoleto}`.slice(0, DESCRICAO_MAX),
      categoria: CATEGORIA_BOLETO_CANCELADO_PAGO,
      valor: valorPagoCentavos / 100,
      valorCentavos: valorPagoCentavos,
      valorBruto: valorPagoCentavos / 100,
      valorBrutoCentavos: valorPagoCentavos,
      valorTaxa: 0,
      valorTaxaCentavos: 0,
      valorLiquido: valorPagoCentavos / 100,
      valorLiquidoCentavos: valorPagoCentavos,
      formaPagamento: 'Boleto',
      condicaoPagamento: 'aprazo',
      naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
      movimentaCaixaFisico: false,
      data: dataPagamento,
      dataVencimento: dataPagamento,
      dataPrevistaRecebimento: dataPagamento,
      dataPagamento,
      recebidoEm: agora(),
      bancoId: String(dados.bancoId),
      bancoNome,
      ...(dados.clienteId ? { clienteId: String(dados.clienteId), clienteNome: String(dados.clienteNome || '') } : {}),
      ...(!dados.clienteId && dados.fornecedorId ? { fornecedorId: String(dados.fornecedorId), fornecedorNome: String(dados.fornecedorNome || '') } : {}),
      ...(dados.filialId ? { filialId: String(dados.filialId) } : {}),
      origemLancamento: ORIGEM_RETORNO_BOLETO_CANCELADO,
      boletoCanceladoId: transacaoId,
      ...(nossoNumero ? { boletoCanceladoNossoNumero: nossoNumero } : {}),
      observacao: `O cliente pagou no banco em ${dataBr} o boleto "${descricaoDoBoleto}"${nossoNumero ? ` (nosso número ${nossoNumero})` : ''}, que já estava cancelado no sistema. Recebimento registrado pelo arquivo de retorno; a venda e o boleto seguem cancelados.`,
      lancadoPor: user.uid,
      idempotencyKey: `retorno-boleto-cancelado:${transacaoId}`,
      lancadoEm: agora(),
      createdAt: agora(),
      updatedAt: agora(),
      criadoPor: user.uid,
      ...buildDocumentMetadata(user.uid, agora()),
    });
    tx.update(titulo.ref, {
      boleto: { ...dados.boleto, recebimentoAvulsoId: novoRef.id },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Boleto cancelado pago no banco: recebimento avulso lançado pelo retorno'),
    });
    tx.update(banco.ref, {
      saldoCentavos: Number(banco.dados.saldoCentavos || 0) + valorPagoCentavos,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Boleto cancelado pago (retorno): "${descricaoDoBoleto}"`),
    });
  });

  return resumo;
};

const lerTextoObrigatorio = (valor, mensagem) => {
  const texto = String(valor || '').trim();
  if (!texto) throw new ErroBaixa(400, mensagem);
  return texto.slice(0, DESCRICAO_MAX);
};

const lerDataDoLancamento = (valor) => {
  const data = String(valor || '').trim();
  if (!DATA_ISO.test(data)) throw new ErroBaixa(400, 'Informe a data do lançamento.');
  return data;
};

/** Cadastro de Bancos: ajuste ou tarifa lancado a mao (credito ou debito). */
const lancarNoBanco = async ({ user, tenantId, corpo }) => {
  const bancoId = idObrigatorio(corpo?.bancoId, 'Banco inválido. Atualize a tela e tente de novo.');
  const tipo = corpo?.tipo === 'tarifa' ? 'tarifa' : corpo?.tipo === 'ajuste' ? 'ajuste' : '';
  if (!tipo) throw new ErroBaixa(400, 'Escolha o tipo do lançamento (ajuste ou tarifa).');
  const direcao = corpo?.direcao === 'credito' || corpo?.direcao === 'debito' ? corpo.direcao : '';
  if (!direcao) throw new ErroBaixa(400, 'Escolha se o lançamento é entrada (crédito) ou saída (débito).');
  const valorCentavos = Number(corpo?.valorCentavos);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new ErroBaixa(400, 'Informe um valor maior que zero.');
  const descricao = lerTextoObrigatorio(corpo?.descricao, 'Informe uma descrição para o lançamento.');
  const data = lerDataDoLancamento(corpo?.data);
  const resumo = {};

  await db.runTransaction(async (tx) => {
    const banco = await lerBanco(tx, tenantId, bancoId, 'Banco não encontrado. Atualize a tela.');
    const bancoNome = String(banco.dados.nome || '');
    resumo.bancoNome = bancoNome;
    tx.set(db.collection('lancamentos_bancarios').doc(), {
      tenantId,
      bancoId,
      bancoNome,
      tipo,
      direcao,
      valorCentavos,
      descricao,
      data,
      createdBy: user.uid,
      createdAt: agora(),
    });
    tx.update(banco.ref, {
      saldoCentavos: Number(banco.dados.saldoCentavos || 0) + (direcao === 'credito' ? valorCentavos : -valorCentavos),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Lançamento manual registrado'),
    });
  });

  return { ...resumo, tipo, direcao, valorCentavos, descricao };
};

/** Cadastro de Bancos: transferencia entre dois bancos da empresa (par de lancamentos). */
const transferirEntreBancos = async ({ user, tenantId, corpo }) => {
  const origemId = String(corpo?.origemId || '').trim();
  const destinoId = String(corpo?.destinoId || '').trim();
  const valorCentavos = Number(corpo?.valorCentavos);
  try {
    validateBankTransfer({ originId: origemId, destinationId: destinoId, amountCents: valorCentavos });
  } catch (erro) {
    throw new ErroBaixa(400, erro.message);
  }
  idObrigatorio(origemId, 'Banco de origem inválido.');
  idObrigatorio(destinoId, 'Banco de destino inválido.');
  const descricaoInformada = String(corpo?.descricao || '').trim().slice(0, DESCRICAO_MAX);
  const data = lerDataDoLancamento(corpo?.data);
  const resumo = {};

  await db.runTransaction(async (tx) => {
    const origem = await lerBanco(tx, tenantId, origemId, 'Banco de origem ou destino não encontrado.');
    const destino = await lerBanco(tx, tenantId, destinoId, 'Banco de origem ou destino não encontrado.');
    const nomeOrigem = String(origem.dados.nome || '');
    const nomeDestino = String(destino.dados.nome || '');
    resumo.nomeOrigem = nomeOrigem;
    resumo.nomeDestino = nomeDestino;

    const saidaRef = db.collection('lancamentos_bancarios').doc();
    const entradaRef = db.collection('lancamentos_bancarios').doc();
    tx.set(saidaRef, {
      tenantId,
      bancoId: origemId,
      bancoNome: nomeOrigem,
      tipo: 'transferencia_saida',
      direcao: 'debito',
      valorCentavos,
      descricao: descricaoInformada || `Transferência para ${nomeDestino}`,
      data,
      transferenciaParId: entradaRef.id,
      createdBy: user.uid,
      createdAt: agora(),
    });
    tx.set(entradaRef, {
      tenantId,
      bancoId: destinoId,
      bancoNome: nomeDestino,
      tipo: 'transferencia_entrada',
      direcao: 'credito',
      valorCentavos,
      descricao: descricaoInformada || `Transferência de ${nomeOrigem}`,
      data,
      transferenciaParId: saidaRef.id,
      createdBy: user.uid,
      createdAt: agora(),
    });
    tx.update(origem.ref, {
      saldoCentavos: Number(origem.dados.saldoCentavos || 0) - valorCentavos,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Transferência para ${nomeDestino}`),
    });
    tx.update(destino.ref, {
      saldoCentavos: Number(destino.dados.saldoCentavos || 0) + valorCentavos,
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), `Transferência de ${nomeOrigem}`),
    });
  });

  return { ...resumo, valorCentavos };
};

/**
 * BOLETO BAIXADO PELO BANCO POR DECURSO DE PRAZO (28/11/2026, pedido do dono).
 * O banco tirou o boleto da cobranca (passou o limite de pagamento). Aqui:
 *  - o boleto fica marcado `baixaPorPrazo` (nao pode mais ser pago);
 *  - a CONTA continua em aberto, para cobrar do jeito que a loja quiser;
 *  - a tarifa que o banco cobrou vira despesa "Tarifas bancarias" e sai do saldo.
 * Importar o mesmo arquivo de novo nao registra duas vezes.
 */
const registrarBaixaPorPrazo = async ({ user, tenantId, corpo, hoje }) => {
  const transacaoId = idObrigatorio(corpo?.transacaoId, 'Boleto inválido. Atualize a tela e importe o retorno de novo.');
  const dataInformada = String(corpo?.dataOcorrencia || '').trim();
  const dataBaixa = DATA_ISO.test(dataInformada) ? dataInformada : hoje;
  const tarifaBruta = Number(corpo?.tarifaCentavos);
  const tarifaPedida = Number.isInteger(tarifaBruta) && tarifaBruta >= 0 && tarifaBruta <= 100000 ? tarifaBruta : 0;
  const resumo = { jaRegistrado: false, jaPago: false, cancelado: false, descricao: '', tarifaCentavos: 0 };

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    const config = await lerConfigDoPlano(tx, tenantId);
    resumo.descricao = String(dados.descricao || transacaoId);
    if (!dados.boleto) throw new ErroBaixa(400, `O título "${resumo.descricao}" não é um boleto emitido pelo sistema.`);
    if (dados.status === 'Paga') { resumo.jaPago = true; return; }
    if (dados.status === 'Cancelada') { resumo.cancelado = true; return; }
    if (dados.boleto.baixaPorPrazo) { resumo.jaRegistrado = true; return; }
    const banco = tarifaPedida > 0 && dados.bancoId
      ? await lerBanco(tx, tenantId, String(dados.bancoId), 'Banco do boleto não encontrado. Confira o cadastro de bancos.')
      : null;
    const tarifaRef = tarifaPedida > 0 ? db.collection('transacoes').doc() : null;

    tx.update(titulo.ref, {
      boleto: { ...dados.boleto, baixaPorPrazo: { em: dataBaixa, tarifaCentavos: tarifaPedida } },
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Boleto baixado pelo banco por decurso de prazo (retorno do banco)'),
    });
    if (tarifaRef) {
      tx.set(tarifaRef, {
        tenantId,
        tipo: 'saida',
        status: 'Paga',
        descricao: `Tarifa do banco (baixa por prazo) — ${resumo.descricao}`,
        categoria: vpc.categoriaDoEvento(config, 'tarifa_bancaria') || CATEGORIA_TARIFA_BANCARIA,
        valor: tarifaPedida / 100,
        valorCentavos: tarifaPedida,
        data: dataBaixa,
        dataVencimento: dataBaixa,
        dataPagamento: dataBaixa,
        formaPagamento: 'Boleto',
        naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
        movimentaCaixaFisico: false,
        ...(banco ? { bancoId: String(dados.bancoId), bancoNome: String(banco.dados.nome || dados.bancoNome || '') } : {}),
        clienteId: dados.clienteId || null,
        clienteNome: dados.clienteNome || null,
        ...(dados.filialId ? { filialId: dados.filialId } : {}),
        tarifaDaTransacaoId: transacaoId,
        origemLancamento: 'retorno_boleto',
        createdAt: agora(),
        updatedAt: agora(),
        criadoPor: user.uid,
        criadoEm: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Tarifa da baixa por decurso de prazo: "${resumo.descricao}"`),
      });
    }
    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) - tarifaPedida,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Tarifa de baixa por prazo do boleto "${resumo.descricao}"`),
      });
    }
    resumo.tarifaCentavos = tarifaPedida;
  });
  return resumo;
};

module.exports = {
  registrarBaixaPorPrazo,
  alterarTaxaDoCartao,
  camposDaTaxaDoCartao,
  // Tambem usado pelo repasse de cheque na nota avulsa (services/repasseCheques.js).
  registrarRecebimentoNaOrigem,
  conciliarCartao,
  compensarChequeRecebido,
  compensarChequeEmitido,
  baixarBoletoPeloRetorno,
  receberBoletoCanceladoPeloRetorno,
  lancarNoBanco,
  transferirEntreBancos,
};
