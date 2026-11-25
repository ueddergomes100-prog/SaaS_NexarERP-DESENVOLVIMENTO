/*
 * CONTAS A RECEBER: BAIXA EM CHEQUE E ABATIMENTO COM CREDITO DO CLIENTE PELO
 * SERVIDOR (item 15 da Embala Minas, fase 2, 25/11/2026).
 *
 * As duas gravavam direto do navegador (ContasReceber.tsx). A regra de
 * negocio e' a MESMA de antes, so' mudou de lugar:
 *
 *  - CHEQUE: nao da' baixa. O titulo continua Pendente, com os dados do
 *    cheque (ou sem eles, no pagamento simplificado) e a data de compensacao;
 *    a venda/OS marca o pagamento como cheque aguardando compensacao. O
 *    cheque sai pelo valor inteiro, sem juros nem multa, e so' vira Paga ao
 *    compensar em Financeiro › Cheques.
 *  - CREDITO: usa o saldo dos creditos do cliente (pelo codigo E pelo nome,
 *    creditoDomain) para quitar ou abater o titulo; a venda/OS recebe o
 *    valor. Os creditos sao lidos AQUI, nunca a lista da tela.
 *
 * O nome do banco vem do cadastro, nao do navegador.
 */
const { admin, db } = require('../config/firebase');
const {
  applyPaymentReceipt,
  buildChequeDetails,
  fromCents,
  legacyPaymentForTransaction,
  parsePagamentoCartaoSimplificadoAtivo,
  summarizePayments,
  tagPaymentAsChequeAwaitingClearance,
  toCents,
} = require('../domain/financeDomain');
const { validarDataBaixa } = require('../domain/baixaFinanceiraDomain');
const { centavosParaAOrigem } = require('../domain/alteracaoValorTituloDomain');
const { creditoEhDoCliente, juntarCreditosSemRepetir } = require('../domain/creditoDomain');
const { STATUS_RENEGOCIADA, ehParcelaDeRenegociacao } = require('../domain/renegociacaoDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { ErroBaixa } = require('./baixaFinanceira');

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const ID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_CREDITO_EM_ABERTO = ['disponivel', 'usado_parcial'];

/** AAAA-MM-DD que existe no calendario (31/02 nao). */
const dataExiste = (v) => {
  if (!DATA_VALIDA.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && Number(v.slice(0, 4)) >= 2000;
};

const lerTransacaoId = (corpo) => {
  const id = String((corpo && corpo.transacaoId) || '');
  if (!ID_VALIDO.test(id)) throw new ErroBaixa(400, 'Conta inválida. Atualize a tela e tente de novo.');
  return id;
};

/** Venda/OS de origem do titulo (referencia), ou null. */
const origemDoTitulo = (dados) => {
  if (dados.pedidoId) return { ref: db.collection('pedidos_venda').doc(String(dados.pedidoId)), tipo: 'venda' };
  if (dados.osId) return { ref: db.collection('ordens_de_servico').doc(String(dados.osId)), tipo: 'os' };
  return null;
};

const conferirTituloAReceber = (dados, tenantId) => {
  if (!dados || dados.tenantId !== tenantId) throw new ErroBaixa(404, 'Conta a receber não encontrada. Atualize a tela.');
  if (dados.tipo && dados.tipo !== 'entrada') throw new ErroBaixa(400, 'Só contas do Contas a Receber são recebidas aqui.');
  if (dados.status === 'Cancelada') throw new ErroBaixa(409, 'Uma conta cancelada não pode ser recebida.');
  if (dados.status === STATUS_RENEGOCIADA) {
    throw new ErroBaixa(409, 'Esta parcela foi renegociada. Receba pelas parcelas da renegociação (ou desfaça a renegociação).');
  }
};

// ---------------------------------------------------------------------------
// CHEQUE (fica aguardando compensacao)
// ---------------------------------------------------------------------------

/**
 * corpo: { transacaoId, dataCompensacao, bancoId?, cheque?: { bancoEmissor, numeroCheque, agencia?, titular?, emitente?, documentoEmitente? } }
 * Sem `cheque` so' no pagamento simplificado da filial (o cheque entra sem os dados).
 */
const lerPedidoDeCheque = (corpo) => {
  const c = corpo || {};
  const transacaoId = lerTransacaoId(c);
  const dataCompensacao = String(c.dataCompensacao || '');
  if (!dataExiste(dataCompensacao)) {
    throw new ErroBaixa(400, 'Informe uma data de compensação (bom para) válida.');
  }
  const bancoId = String(c.bancoId || '').trim();
  if (bancoId && !ID_VALIDO.test(bancoId)) throw new ErroBaixa(400, 'Banco inválido. Escolha de novo na lista.');
  let cheque = null;
  if (c.cheque && typeof c.cheque === 'object') {
    try {
      const bruto = c.cheque;
      const texto = (v, limite) => String(v == null ? '' : v).trim().slice(0, limite);
      const opcional = (campo, valor) => (valor ? { [campo]: valor } : {});
      cheque = buildChequeDetails({
        bancoEmissor: texto(bruto.bancoEmissor, 80),
        numeroCheque: texto(bruto.numeroCheque, 30),
        dataCompensacao,
        ...opcional('agencia', texto(bruto.agencia, 20)),
        ...opcional('titular', texto(bruto.titular, 120)),
        ...opcional('emitente', texto(bruto.emitente, 120)),
        ...opcional('documentoEmitente', texto(bruto.documentoEmitente, 20)),
      });
      // Nada `undefined` no Firestore (CLAUDE.md, regra 3).
      cheque = Object.fromEntries(Object.entries(cheque).filter(([, v]) => v !== undefined && v !== ''));
    } catch (erro) {
      throw new ErroBaixa(400, `${erro.message} Confira os dados do cheque e tente de novo.`);
    }
  }
  return { transacaoId, dataCompensacao, bancoId, cheque };
};

const registrarChequeNaBaixa = async ({ user, tenantId, corpo }) => {
  const pedido = lerPedidoDeCheque(corpo);

  // Cheque sem os dados so' quando a filial usa o pagamento simplificado (configuracao).
  if (!pedido.cheque) {
    const config = await db.collection('configuracoes').doc(tenantId).get();
    const simplificado = config.exists && parsePagamentoCartaoSimplificadoAtivo(config.data().pagamentoCartaoSimplificadoAtivo);
    if (!simplificado) throw new ErroBaixa(400, 'Informe os dados do cheque: banco emissor, número e data de compensação.');
  }
  let bancoNome = '';
  if (pedido.bancoId) {
    const banco = await db.collection('bancos').doc(pedido.bancoId).get();
    if (!banco.exists || banco.data().tenantId !== tenantId) {
      throw new ErroBaixa(404, 'O banco escolhido não foi encontrado nesta empresa. Escolha de novo na lista.');
    }
    bancoNome = String(banco.data().nome || '');
  }

  const ref = db.collection('transacoes').doc(pedido.transacaoId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const dados = snap.exists ? snap.data() : null;
    conferirTituloAReceber(dados, tenantId);
    // Ja' recebida (outra pessoa deu baixa no meio tempo): nada a fazer, como antes.
    if (dados.status === 'Paga') return { jaPaga: true };

    const origem = origemDoTitulo(dados);
    const origemSnap = origem ? await tx.get(origem.ref) : null;
    if (origemSnap && origemSnap.exists && origemSnap.data().status === 'Cancelada') {
      throw new ErroBaixa(409, origem.tipo === 'venda' ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
    }

    const nota = 'Baixa registrada em cheque, aguardando compensação';
    tx.update(ref, {
      formaPagamentoOriginal: dados.formaPagamentoOriginal || dados.formaPagamento || null,
      formaPagamento: 'Cheque',
      ...(pedido.cheque ? { cheque: pedido.cheque } : {}),
      dataPrevistaRecebimento: pedido.dataCompensacao,
      ...(pedido.bancoId ? { bancoId: pedido.bancoId, bancoNome: bancoNome || null } : {}),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), nota),
    });

    if (origemSnap && origemSnap.exists) {
      const origemDados = origemSnap.data();
      const pagamentos = Array.isArray(origemDados.pagamentos) && origemDados.pagamentos.length > 0
        ? origemDados.pagamentos
        : [legacyPaymentForTransaction(pedido.transacaoId, dados)];
      let atualizados;
      try {
        atualizados = tagPaymentAsChequeAwaitingClearance(pagamentos, {
          transactionId: pedido.transacaoId,
          paymentIndex: dados.paymentIndex,
          cheque: pedido.cheque,
          dataCompensacao: pedido.dataCompensacao,
          ...(pedido.bancoId ? { bancoId: pedido.bancoId, bancoNome } : {}),
        });
      } catch (erro) {
        throw new ErroBaixa(409, `${erro.message} Avise o suporte.`);
      }
      tx.update(origem.ref, {
        pagamentos: atualizados,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), nota),
      });
    }
    return {
      jaPaga: false,
      descricao: String(dados.descricao || ''),
      valorCentavos: Number(dados.valorCentavos ?? toCents(Number(dados.valor || 0))),
      formaAnterior: String(dados.formaPagamento || ''),
      pedidoId: dados.pedidoId ? String(dados.pedidoId) : '',
      osId: dados.osId ? String(dados.osId) : '',
      vendedorId: String(dados.vendedorId || ''),
      numeroCheque: pedido.cheque ? pedido.cheque.numeroCheque : '',
      dataCompensacao: pedido.dataCompensacao,
      bancoNome,
    };
  });
};

// ---------------------------------------------------------------------------
// CREDITO DO CLIENTE (quita ou abate)
// ---------------------------------------------------------------------------

/** corpo: { transacaoId, valorCentavos, dataPagamento, valorEsperadoCentavos? } */
const lerPedidoDeCredito = (corpo, hoje) => {
  const c = corpo || {};
  const transacaoId = lerTransacaoId(c);
  const valorCentavos = Number(c.valorCentavos);
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new ErroBaixa(400, 'Informe quanto do crédito usar (maior que zero).');
  const erroData = validarDataBaixa(c.dataPagamento, hoje);
  if (erroData) throw new ErroBaixa(400, erroData);
  const esperado = Number(c.valorEsperadoCentavos);
  return {
    transacaoId,
    valorCentavos,
    dataPagamento: String(c.dataPagamento).trim(),
    ...(Number.isInteger(esperado) && esperado > 0 ? { valorEsperadoCentavos: esperado } : {}),
  };
};

/** Creditos em aberto do cliente do titulo: pelo codigo E pelo nome, sem repetir (creditoDomain). */
const creditosDoCliente = async (tenantId, titulo) => {
  const idDoCliente = typeof titulo.clienteId === 'string' ? titulo.clienteId : '';
  const nome = String(titulo.clienteNome || '');
  if (!idDoCliente && !nome) return [];
  const emAberto = (consulta) => consulta.where('tenantId', '==', tenantId).where('status', 'in', STATUS_CREDITO_EM_ABERTO);
  const [porNome, porCodigo] = await Promise.all([
    nome ? emAberto(db.collection('creditos_cliente')).where('clienteNome', '==', nome).get() : Promise.resolve(null),
    idDoCliente ? emAberto(db.collection('creditos_cliente')).where('clienteId', '==', idDoCliente).get() : Promise.resolve(null),
  ]);
  return juntarCreditosSemRepetir(porCodigo ? porCodigo.docs : [], porNome ? porNome.docs : [])
    .filter((d) => creditoEhDoCliente(d.data(), { id: idDoCliente, nome }))
    .map((d) => d.id);
};

const abaterComCredito = async ({ user, tenantId, corpo, hoje }) => {
  const pedido = lerPedidoDeCredito(corpo, hoje);
  const ref = db.collection('transacoes').doc(pedido.transacaoId);

  const antes = await ref.get();
  const dadosAntes = antes.exists ? antes.data() : null;
  conferirTituloAReceber(dadosAntes, tenantId);
  if (ehParcelaDeRenegociacao(dadosAntes)) {
    throw new ErroBaixa(409, 'Parcela de renegociação não é abatida com crédito. Use "Receber sem usar crédito".');
  }
  const idsDosCreditos = await creditosDoCliente(tenantId, dadosAntes);
  if (idsDosCreditos.length === 0) throw new ErroBaixa(409, 'Este cliente não tem crédito disponível. Receba sem usar crédito.');

  const pagamentoRef = db.collection('transacoes').doc();
  const creditoRefs = idsDosCreditos.map((id) => db.collection('creditos_cliente').doc(id));
  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const snap = await tx.get(ref);
    const dados = snap.exists ? snap.data() : null;
    conferirTituloAReceber(dados, tenantId);
    if (dados.status !== 'Pendente') throw new ErroBaixa(409, 'Esta conta já foi processada ou cancelada. Atualize a tela.');
    const centavosDoTitulo = Number(dados.valorCentavos ?? toCents(Number(dados.valor || 0)));
    if (pedido.valorEsperadoCentavos !== undefined && centavosDoTitulo !== pedido.valorEsperadoCentavos) {
      throw new ErroBaixa(409, 'O valor da conta foi alterado. Feche a janela e abra de novo.');
    }
    if (pedido.valorCentavos > centavosDoTitulo) {
      throw new ErroBaixa(400, `O crédito usado não pode passar do valor da conta (R$ ${fromCents(centavosDoTitulo).toFixed(2).replace('.', ',')}).`);
    }
    const creditoSnaps = await Promise.all(creditoRefs.map((r) => tx.get(r)));
    const origem = origemDoTitulo(dados);
    const origemSnap = origem ? await tx.get(origem.ref) : null;
    if (origemSnap && origemSnap.exists && origemSnap.data().status === 'Cancelada') {
      throw new ErroBaixa(409, origem.tipo === 'venda' ? 'A venda vinculada está cancelada.' : 'A OS vinculada está cancelada.');
    }

    // ---------------- CONTA ----------------
    let falta = pedido.valorCentavos;
    const usos = [];
    creditoSnaps.forEach((cs, i) => {
      if (falta <= 0 || !cs.exists) return;
      const c = cs.data();
      if (c.tenantId !== tenantId || !STATUS_CREDITO_EM_ABERTO.includes(c.status)) return;
      const disponivel = Number(c.saldoDisponivelCentavos ?? toCents(Number(c.saldoDisponivel || 0)));
      const usado = Math.min(disponivel, falta);
      if (usado <= 0) return;
      usos.push({ ref: creditoRefs[i], saldoCentavos: disponivel - usado });
      falta -= usado;
    });
    if (falta > 0) throw new ErroBaixa(409, 'O saldo de crédito do cliente mudou e não cobre esse valor. Feche a janela e abra de novo.');
    const restanteCentavos = centavosDoTitulo - pedido.valorCentavos;

    // ---------------- ESCRITAS ----------------
    usos.forEach(({ ref: r, saldoCentavos }) => {
      tx.update(r, {
        saldoDisponivelCentavos: saldoCentavos,
        saldoDisponivel: fromCents(saldoCentavos),
        status: saldoCentavos <= 0 ? 'esgotado' : 'usado_parcial',
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Crédito usado na baixa'),
      });
    });

    const reciboId = restanteCentavos === 0 ? pedido.transacaoId : pagamentoRef.id;
    if (restanteCentavos === 0) {
      tx.update(ref, {
        status: 'Paga',
        formaPagamentoOriginal: dados.formaPagamentoOriginal || dados.formaPagamento || null,
        formaPagamento: 'Crédito de Devolução',
        naturezaFinanceira: 'credito_cliente',
        movimentaCaixaFisico: false,
        dataPagamento: pedido.dataPagamento,
        recebidoEm: agora(),
        observacao: `Pagamento realizado utilizando ${fromCents(pedido.valorCentavos).toFixed(2)} em crédito do cliente.`,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Quitada com crédito de devolução'),
      });
    } else {
      tx.update(ref, {
        valorCentavos: restanteCentavos,
        valor: fromCents(restanteCentavos),
        observacao: `Abatimento de R$ ${fromCents(pedido.valorCentavos).toFixed(2)} em crédito; saldo pendente de R$ ${fromCents(restanteCentavos).toFixed(2)}.`,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Abatida parcialmente com crédito de devolução'),
      });
      tx.set(pagamentoRef, {
        descricao: `${dados.descricao || ''} - Crédito de devolução`,
        categoria: dados.categoria || null,
        valorCentavos: pedido.valorCentavos,
        valor: fromCents(pedido.valorCentavos),
        tipo: 'entrada',
        status: 'Paga',
        formaPagamento: 'Crédito de Devolução',
        naturezaFinanceira: 'credito_cliente',
        movimentaCaixaFisico: false,
        data: pedido.dataPagamento,
        dataPagamento: pedido.dataPagamento,
        recebidoEm: agora(),
        clienteNome: dados.clienteNome || null,
        pedidoId: dados.pedidoId || null,
        osId: dados.osId || null,
        sourcePaymentTransactionId: pedido.transacaoId,
        idempotencyKey: `credito:${pagamentoRef.id}`,
        tenantId,
        createdAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
    }

    if (origemSnap && origemSnap.exists) {
      const origemDados = origemSnap.data();
      const pagamentos = Array.isArray(origemDados.pagamentos) && origemDados.pagamentos.length > 0
        ? origemDados.pagamentos
        : [legacyPaymentForTransaction(pedido.transacaoId, dados)];
      const atualizados = applyPaymentReceipt(pagamentos, {
        transactionId: pedido.transacaoId,
        paymentIndex: dados.paymentIndex,
        // Parcela com valor alterado: a venda so' fecha junto com a parcela, e por inteiro.
        amountCents: centavosParaAOrigem(pagamentos, {
          transactionId: pedido.transacaoId,
          paymentIndex: dados.paymentIndex,
          titulo: dados,
          recebidoCentavos: pedido.valorCentavos,
          tituloQuitado: restanteCentavos === 0,
        }),
        method: 'Crédito de Devolução',
        receiptId: reciboId,
        receivedAt: pedido.dataPagamento,
      });
      const resumo = summarizePayments(atualizados);
      tx.update(origem.ref, {
        pagamentos: atualizados,
        totalRecebidoCentavos: resumo.receivedCents,
        totalRecebido: resumo.received,
        totalPendenteCentavos: resumo.pendingCents,
        totalPendente: resumo.pending,
        totalTaxasPagamentoCentavos: resumo.cardFeeCents,
        totalTaxasPagamento: resumo.cardFee,
        totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
        totalLiquidoFinanceiro: resumo.financialNet,
        statusPagamento: resumo.pendingCents === 0 ? 'Paga' : resumo.receivedCents > 0 ? 'Parcial' : 'Pendente',
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Baixa com crédito de devolução'),
      });
    }

    return {
      quitou: restanteCentavos === 0,
      valorCentavos: pedido.valorCentavos,
      anteriorCentavos: centavosDoTitulo,
      restanteCentavos,
      pagamentoId: restanteCentavos === 0 ? '' : pagamentoRef.id,
      descricao: String(dados.descricao || ''),
      clienteNome: String(dados.clienteNome || ''),
      formaAnterior: String(dados.formaPagamento || ''),
      pedidoId: dados.pedidoId ? String(dados.pedidoId) : '',
      osId: dados.osId ? String(dados.osId) : '',
      vendedorId: String(dados.vendedorId || ''),
      dataPagamento: pedido.dataPagamento,
    };
  });
};

module.exports = { registrarChequeNaBaixa, abaterComCredito, lerPedidoDeCheque, lerPedidoDeCredito };
