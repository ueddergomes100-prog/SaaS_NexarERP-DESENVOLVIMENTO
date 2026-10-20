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
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const {
  ErroBaixa,
  camposDoResumoDePagamentos,
  agora,
  lerTitulo,
  lerOrigem,
  lerBanco,
  centavosDoTitulo,
} = require('./baixaFinanceira');

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
  const resumo = { jaEstavaPago: false };

  await db.runTransaction(async (tx) => {
    const titulo = await lerTitulo(tx, tenantId, { transacaoId, tipo: 'entrada' });
    const dados = titulo.dados;
    if (dados.status === 'Paga') {
      resumo.jaEstavaPago = true;
      return;
    }
    if (dados.status === 'Cancelada') throw new ErroBaixa(400, `O boleto "${dados.descricao || transacaoId}" está cancelado e não pode receber baixa.`);
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

    tx.update(titulo.ref, {
      status: 'Paga',
      dataPagamento,
      naturezaFinanceira: settledFinancialNatureForPayment('Boleto'),
      movimentaCaixaFisico: false,
      boleto: { ...(dados.boleto || {}), status: 'pago' },
      recebidoEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Baixa pelo retorno do banco'),
    });
    if (banco) {
      tx.update(banco.ref, {
        saldoCentavos: Number(banco.dados.saldoCentavos || 0) + valorPagoCentavos,
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

module.exports = {
  conciliarCartao,
  compensarChequeRecebido,
  compensarChequeEmitido,
  baixarBoletoPeloRetorno,
  lancarNoBanco,
  transferirEntreBancos,
};
