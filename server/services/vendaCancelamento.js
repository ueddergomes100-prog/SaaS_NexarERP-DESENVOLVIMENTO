/*
 * CANCELAR VENDA, CANCELAR PRE-VENDA E ALTERAR A FORMA DE PAGAMENTO NO
 * SERVIDOR (item 8 da auditoria, fatia 3b -- 19/10/2026).
 *
 * Mesmo comportamento do Pedido de Venda pela tela (regra comum em
 * src/utils/cancelamentoVendaDomain.ts, compilada para server/domain), mas o
 * estoque, os lancamentos, o SALDO DO BANCO e o credito do cliente sao lidos e
 * gravados aqui, numa transacao, com todas as leituras antes das escritas.
 * Usado quando a empresa tem a chave "Venda pelo servidor" ligada (SuperAdmin).
 *
 * A nota fiscal continua sendo cancelada pela tela ANTES de chamar aqui (Spedy
 * pelo proxy, com a justificativa). Este servico so' confere que nao sobrou nota
 * valida: se sobrou, recusa.
 */
const { admin, db } = require('../config/firebase');
const fin = require('../domain/financeDomain');
const { configFinanceiraDaEmpresa } = require('../domain/vendaFechamentoDomain');
const cv = require('../domain/cancelamentoVendaDomain');
const { lotesQueVoltamNoCancelamento } = require('../domain/loteRetornoDomain');
const { classificarNotasDaVenda, listaDeNotas } = require('../domain/cancelamentoNotaVendaDomain');
const { bloqueioPorParcelaRenegociada } = require('../domain/renegociacaoDomain');
const { bloqueioParaRefazerParcelas } = require('../domain/alteracaoValorTituloDomain');
const { computeReservationRelease } = require('../domain/estoqueReservaDomain');
const { erroParaCancelarComEntregaFutura } = require('../domain/entregaFuturaDomain');
const { toStockAdjustmentItems } = require('../domain/embalagemDomain');
const { isPedidoAberto, parseAlterarPagamentoVendaFinalizada, STATUS_CANCELADA } = require('../domain/preVendaDomain');
const { buildDocumentMetadata, buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { getDateInputInTimeZone } = require('../domain/dateTime');
const { ErroVenda, temPermissao } = require('./vendaFechamento');

const agora = () => admin.firestore.FieldValue.serverTimestamp();
const incremento = (n) => admin.firestore.FieldValue.increment(n);

const MENSAGEM_DEVOLUCAO = 'Não é possível cancelar uma venda que já possui itens devolvidos. O cancelamento só é permitido caso nenhuma devolução tenha sido feita.';

/** Lancamentos da venda (consulta fora da transacao). Sem nenhum: o lancamento antigo tem o id da venda. */
const refsDosTitulos = async (tenantId, pedidoId) => {
  const snap = await db.collection('transacoes').where('tenantId', '==', tenantId).where('pedidoId', '==', pedidoId).get();
  return snap.empty ? [db.collection('transacoes').doc(pedidoId)] : snap.docs.map((d) => d.ref);
};

const notasDaVenda = async (tenantId, pedidoId) => {
  const snap = await db.collection('notas_fiscais').where('tenantId', '==', tenantId).where('pedidoId', '==', pedidoId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

const lerPedido = (snap, tenantId, rotulo = 'Esta venda') => {
  if (!snap.exists || snap.data().tenantId !== tenantId) throw new ErroVenda(404, `${rotulo} não existe mais. Atualize a lista de pedidos.`);
  return snap.data();
};

/** Soma a quantidade (unidade base) por produto: a venda pode ter o mesmo produto em duas linhas. */
const quantidadePorProduto = (itens) => {
  const porId = new Map();
  toStockAdjustmentItems(Array.isArray(itens) ? itens : []).forEach((i) => {
    if (!i.id || i.id === 'avulso') return;
    porId.set(i.id, (porId.get(i.id) || 0) + Number(i.quantidade || 0));
  });
  return porId;
};

const temItemDevolvido = (itens) => (Array.isArray(itens) ? itens : []).some((i) => Number(i && i.quantidadeJaDevolvida) > 0);

// ===========================================================================
// CANCELAR VENDA FINALIZADA
// ===========================================================================

const cancelarVenda = async ({ user, tenantId, corpo }) => {
  const lido = cv.lerPedidoDeCancelamento(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const { pedidoId, motivo } = lido;

  // Nota fiscal: a tela cancela antes. Sobrou nota valida (ou na SEFAZ): recusa.
  const { autorizadas, emTransmissao } = classificarNotasDaVenda(await notasDaVenda(tenantId, pedidoId));
  if (emTransmissao.length > 0) {
    throw new ErroVenda(409, `A ${listaDeNotas(emTransmissao)} desta venda ainda não tem resposta da SEFAZ. Espere a resposta (Notas Fiscais → Sincronizar Notas) antes de cancelar a venda.`);
  }
  if (autorizadas.length > 0) {
    throw new ErroVenda(409, `A ${listaDeNotas(autorizadas)} desta venda ainda está autorizada. Cancele pela opção "Estornar/Cancelar venda" do pedido: ela cancela a nota na SEFAZ primeiro.`);
  }

  const refsTitulos = await refsDosTitulos(tenantId, pedidoId);
  const hoje = getDateInputInTimeZone();

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const pedidoRef = db.collection('pedidos_venda').doc(pedidoId);
    const venda = lerPedido(await tx.get(pedidoRef), tenantId, 'A venda');
    const numeroPedido = String(venda.numeroPedido || '');
    if (venda.status === 'Cancelada') throw new ErroVenda(409, 'Esta venda já foi cancelada.');
    if (venda.status !== 'Finalizada') {
      throw new ErroVenda(409, `O pedido #${numeroPedido} ainda não foi finalizado. Para cancelar uma pré-venda, use "Cancelar pré-venda".`);
    }
    if (temItemDevolvido(venda.itens)) throw new ErroVenda(409, MENSAGEM_DEVOLUCAO);
    // Entrega futura (23/10/2026): com mercadoria ja' entregue, o caminho e' a devolucao.
    const erroEntregaFutura = erroParaCancelarComEntregaFutura(venda);
    if (erroEntregaFutura) throw new ErroVenda(409, erroEntregaFutura);
    const vendaComReserva = venda.entregaFutura === true && venda.estoqueReservado === true;

    const travaSnap = await tx.get(db.collection('romaneio_pedidos').doc(pedidoId));
    const erroRota = cv.erroDaRotaParaCancelar(travaSnap.exists ? travaSnap.data() : null, numeroPedido);
    if (erroRota) throw new ErroVenda(409, erroRota);

    const titulosSnaps = await tx.getAll(...refsTitulos);
    const titulos = titulosSnaps.filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => ({ id: s.id, dados: s.data() }));
    const bloqueioRenegociacao = bloqueioPorParcelaRenegociada(titulos.map((t) => t.dados), 'cancelar a venda');
    if (bloqueioRenegociacao) throw new ErroVenda(409, bloqueioRenegociacao);

    // Saldo dos bancos: o que os pagamentos confirmados da venda creditaram.
    const debitoPorBanco = fin.computeBankCreditsMap(venda.pagamentos || []);
    const saldos = new Map();
    for (const bancoId of debitoPorBanco.keys()) {
      const s = await tx.get(db.collection('bancos').doc(bancoId));
      if (s.exists && s.data().tenantId === tenantId) saldos.set(bancoId, Number(s.data().saldoCentavos || 0));
    }

    // Estoque e lotes: o que a venda GRAVADA tirou (nao o que a tela mostra).
    const devolver = quantidadePorProduto(venda.itens);
    const produtoRefs = [...devolver.keys()].map((id) => db.collection('estoque').doc(id));
    const produtosSnaps = (produtoRefs.length ? await tx.getAll(...produtoRefs) : []).filter((s) => s.exists && s.data().tenantId === tenantId);
    const produtosExistentes = new Set(produtosSnaps.map((s) => s.id));
    const reservadaAtual = new Map(produtosSnaps.map((s) => [s.id, Number(s.data().quantidadeReservada || 0)]));
    // Entrega futura sem entrega: nada saiu do estoque, so' a reserva volta.
    const voltasDeLote = vendaComReserva ? [] : lotesQueVoltamNoCancelamento(venda.itens);
    const loteRefs = voltasDeLote.map((l) => db.collection('estoque_lotes').doc(l.loteId));
    const lotesExistentes = new Set((loteRefs.length ? await tx.getAll(...loteRefs) : [])
      .filter((s) => s.exists && s.data().tenantId === tenantId).map((s) => s.id));

    // Credito de devolucao usado na venda volta para o cliente (decisao do dono, 19/10/2026).
    const creditoCentavos = cv.creditoUsadoNaVenda(venda.pagamentos);
    const creditoRef = creditoCentavos > 0 ? db.collection('creditos_cliente').doc(cv.idDoCreditoDevolvido(pedidoId)) : null;
    const creditoJaDevolvido = creditoRef ? (await tx.get(creditoRef)).exists : false;

    const orcamentoRef = venda.orcamentoId ? db.collection('orcamentos').doc(String(venda.orcamentoId)) : null;
    const orcamentoSnap = orcamentoRef ? await tx.get(orcamentoRef) : null;
    const reabrirOrcamento = Boolean(orcamentoSnap && orcamentoSnap.exists && orcamentoSnap.data().tenantId === tenantId);

    // ---------------- ESCRITAS ----------------
    const usuarioNome = user.nome || user.email || 'Usuário';
    tx.update(pedidoRef, {
      status: 'Cancelada',
      ...(venda.comissao ? { comissao: fin.cancelCommissionSnapshot(venda.comissao) } : {}),
      motivoCancelamento: motivo,
      canceladaPor: user.uid,
      canceladaPorNome: usuarioNome,
      canceladaEm: agora(),
      updatedAt: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Venda cancelada'),
    });

    debitoPorBanco.forEach((delta, bancoId) => {
      if (!saldos.has(bancoId)) return;
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: saldos.get(bancoId) - delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Estorno da venda #${numeroPedido} cancelada`),
      });
    });

    const escritas = cv.estornoDosTitulosDaVenda(titulos, {
      pedidoId, numeroPedido, clienteNome: venda.clienteNome || '', usuarioId: user.uid, tenantId, hoje,
    });
    escritas.atualizar.forEach((a) => {
      tx.update(db.collection('transacoes').doc(a.id), {
        ...a.campos,
        estornadaEm: agora(),
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), a.nota),
      });
    });
    escritas.criar.forEach((c) => {
      tx.set(db.collection('transacoes').doc(c.id), { ...c.campos, createdAt: agora(), ...buildDocumentMetadata(user.uid, agora()) }, { merge: true });
    });

    devolver.forEach((quantidade, produtoId) => {
      if (!produtosExistentes.has(produtoId) || !(quantidade > 0)) return;
      if (vendaComReserva) {
        tx.update(db.collection('estoque').doc(produtoId), { quantidadeReservada: Math.max(0, (reservadaAtual.get(produtoId) || 0) - quantidade), updatedAt: agora() });
        return;
      }
      tx.update(db.collection('estoque').doc(produtoId), { quantidade: incremento(quantidade), updatedAt: agora() });
    });
    voltasDeLote.forEach((l) => {
      if (!lotesExistentes.has(l.loteId) || !(l.quantidade > 0)) return;
      tx.update(db.collection('estoque_lotes').doc(l.loteId), { quantidade: incremento(l.quantidade), updatedAt: agora() });
    });

    if (creditoRef && !creditoJaDevolvido) {
      tx.set(creditoRef, {
        ...cv.camposDoCreditoDevolvido({ pedidoId, numeroPedido, clienteNome: venda.clienteNome || '', valorCentavos: creditoCentavos, tenantId }),
        createdAt: agora(),
        updatedAt: agora(),
        ...buildDocumentMetadata(user.uid, agora()),
      });
    }

    if (reabrirOrcamento) {
      tx.update(orcamentoRef, { status: 'Pendente', ...buildDocumentUpdateMetadata(user.uid, agora(), 'Reaberto pelo cancelamento da venda') });
    }

    return {
      pedidoId,
      numeroPedido,
      vendedorId: venda.vendedorId || '',
      vendedorNome: venda.vendedorNome || '',
      totalCentavos: Number(venda.valorTotalCentavos ?? fin.toCents(Number(venda.valorTotal || 0))),
      creditoDevolvidoCentavos: creditoRef && !creditoJaDevolvido ? creditoCentavos : 0,
      snapshot: venda,
    };
  });
};

// ===========================================================================
// CANCELAR PRE-VENDA (ou pedido em aberto)
// ===========================================================================

const cancelarPreVenda = async ({ user, tenantId, corpo }) => {
  const lido = cv.lerPedidoDeCancelamentoDaPreVenda(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const { pedidoId, nota, soDoVendedor } = lido;

  return db.runTransaction(async (tx) => {
    const pedidoRef = db.collection('pedidos_venda').doc(pedidoId);
    const pedido = lerPedido(await tx.get(pedidoRef), tenantId, 'Esta pré-venda');
    const numeroPedido = String(pedido.numeroPedido || '');
    // App Vendas (21/10/2026): so' o pedido do proprio vendedor.
    if (soDoVendedor && pedido.vendedorId !== user.uid) {
      throw new ErroVenda(403, 'Este pedido é de outro vendedor e não pode ser cancelado por aqui.');
    }
    if (!isPedidoAberto(pedido.status)) {
      throw new ErroVenda(409, soDoVendedor
        ? `Este pedido está "${pedido.status}" e não pode mais ser cancelado pelo aplicativo. Fale com a loja.`
        : 'Esta pré-venda não está mais em aberto. Recarregue a tela.');
    }

    const travaSnap = await tx.get(db.collection('romaneio_pedidos').doc(pedidoId));
    const erroRota = cv.erroDaRotaParaCancelar(travaSnap.exists ? travaSnap.data() : null, numeroPedido);
    if (erroRota) throw new ErroVenda(409, erroRota);

    // Reserva de estoque: so' soltar o que estava separado (nada foi baixado).
    const deltas = pedido.estoqueReservado === true ? computeReservationRelease(toStockAdjustmentItems(pedido.itens || [])) : [];
    const produtoRefs = deltas.map((d) => db.collection('estoque').doc(d.id));
    const produtos = new Map();
    (produtoRefs.length ? await tx.getAll(...produtoRefs) : []).forEach((s) => {
      if (s.exists && s.data().tenantId === tenantId) produtos.set(s.id, s.data());
    });

    const orcamentoRef = pedido.orcamentoId ? db.collection('orcamentos').doc(String(pedido.orcamentoId)) : null;
    const orcamentoSnap = orcamentoRef ? await tx.get(orcamentoRef) : null;
    const reabrirOrcamento = Boolean(orcamentoSnap && orcamentoSnap.exists && orcamentoSnap.data().tenantId === tenantId);

    deltas.forEach((d) => {
      const produto = produtos.get(d.id);
      if (!produto) return;
      tx.update(db.collection('estoque').doc(d.id), {
        quantidade: Number(produto.quantidade || 0) + d.quantidadeDelta,
        quantidadeReservada: Math.max(0, Number(produto.quantidadeReservada || 0) + d.quantidadeReservadaDelta),
        updatedAt: agora(),
      });
    });
    tx.update(pedidoRef, {
      status: STATUS_CANCELADA,
      estoqueReservado: false,
      ...buildDocumentUpdateMetadata(user.uid, agora(), nota),
    });
    if (reabrirOrcamento) {
      tx.update(orcamentoRef, { status: 'Pendente', ...buildDocumentUpdateMetadata(user.uid, agora(), 'Reaberto pelo cancelamento da pré-venda') });
    }
    return { pedidoId, numeroPedido, vendedorId: pedido.vendedorId || '', vendedorNome: pedido.vendedorNome || '', reservaLiberada: deltas.length > 0, peloApp: soDoVendedor };
  });
};

// ===========================================================================
// ALTERAR A FORMA DE PAGAMENTO DE VENDA FINALIZADA
// ===========================================================================

const alterarPagamento = async ({ user, tenantId, corpo }) => {
  const lido = cv.lerPedidoDeAlteracaoDePagamento(corpo);
  if ('erro' in lido) throw new ErroVenda(400, lido.erro);
  const { pedidoId } = lido;

  const configSnap = await db.collection('configuracoes').doc(tenantId).get();
  const config = configSnap.exists ? configSnap.data() : {};
  if (!parseAlterarPagamentoVendaFinalizada(config.alterarPagamentoVendaFinalizada)) {
    throw new ErroVenda(403, 'Alterar a forma de pagamento de venda finalizada está desligado nas Configurações da filial.');
  }

  // Cupom fiscal (NFC-e) autorizado: a forma de pagamento ja' foi para a SEFAZ.
  const { autorizadas } = classificarNotasDaVenda(await notasDaVenda(tenantId, pedidoId));
  if (autorizadas.some((n) => n.tipo === 'NFC-e')) {
    throw new ErroVenda(409, 'Esta venda tem cupom fiscal (NFC-e) autorizado. A nota já foi transmitida à SEFAZ e não pode ser alterada. Para corrigir, cancele o cupom fiscal primeiro.');
  }

  // Total e data vem da venda GRAVADA, nunca da tela.
  const vendaAntes = lerPedido(await db.collection('pedidos_venda').doc(pedidoId).get(), tenantId);
  const totalCentavos = Number(vendaAntes.valorTotalCentavos ?? fin.toCents(Number(vendaAntes.valorTotal || 0)));
  const financeiro = configFinanceiraDaEmpresa(config);
  const [bandeirasSnap, bancosSnap] = await Promise.all([
    db.collection('bandeiras_cartao').where('tenantId', '==', tenantId).get(),
    db.collection('bancos').where('tenantId', '==', tenantId).get(),
  ]);
  let pagamentos;
  try {
    pagamentos = fin.normalizePayments(totalCentavos, lido.pagamentos, {
      saleDate: String(vendaAntes.dataVenda || getDateInputInTimeZone()),
      maxCreditInstallments: financeiro.maxCreditInstallments || undefined,
      creditFeePercentByInstallment: financeiro.creditFeePercentByInstallment,
      debitFeePercent: financeiro.debitFeePercent,
      creditSettlementDays: financeiro.creditSettlementDays,
      debitSettlementDays: financeiro.debitSettlementDays,
      cardFeeSchedulesByBrand: fin.buildCardFeeSchedulesByBrand(bandeirasSnap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      pagamentoCartaoSimplificadoAtivo: fin.parsePagamentoCartaoSimplificadoAtivo(config.pagamentoCartaoSimplificadoAtivo),
      bancoPadraoSimplificado: fin.resolveBancoPadraoSimplificado(bancosSnap.docs.map((d) => ({ id: d.id, nome: String(d.data().nome || ''), ativo: d.data().ativo }))),
    });
  } catch (erro) {
    throw new ErroVenda(400, erro instanceof Error && erro.message ? erro.message : 'Revise os dados do pagamento.');
  }
  pagamentos = fin.explodeInstallmentPaymentRecords(pagamentos);
  const resumo = fin.summarizePayments(pagamentos);
  const novos = pagamentos.map((p, indice) => ({ ...p, transactionId: indice === 0 ? pedidoId : `${pedidoId}_pag_${indice + 1}` }));
  const refsTitulos = await refsDosTitulos(tenantId, pedidoId);

  return db.runTransaction(async (tx) => {
    // ---------------- LEITURAS ----------------
    const pedidoRef = db.collection('pedidos_venda').doc(pedidoId);
    const venda = lerPedido(await tx.get(pedidoRef), tenantId);
    const numeroPedido = String(venda.numeroPedido || '');
    if (venda.status !== 'Finalizada') throw new ErroVenda(409, 'Esta venda não está mais finalizada. Recarregue a tela.');
    if (Number(venda.valorTotalCentavos ?? fin.toCents(Number(venda.valorTotal || 0))) !== totalCentavos) {
      throw new ErroVenda(409, 'O valor desta venda mudou enquanto você alterava o pagamento. Recarregue a tela e faça de novo.');
    }
    if (temItemDevolvido(venda.itens)) {
      throw new ErroVenda(409, 'Esta venda tem itens devolvidos. Como o valor já se moveu pela devolução, a forma de pagamento não pode mais ser alterada por aqui.');
    }

    const titulosSnaps = await tx.getAll(...refsTitulos);
    const antigos = titulosSnaps.filter((s) => s.exists && s.data().tenantId === tenantId);
    if (antigos.some((s) => s.data().estornada === true)) {
      throw new ErroVenda(409, 'Esta venda já tem lançamento estornado. Use Estorno ou Devolução em vez de alterar o pagamento.');
    }
    const dadosAntigos = antigos.map((s) => s.data());
    const bloqueio = bloqueioParaRefazerParcelas(dadosAntigos, 'venda')
      || cv.bloqueioParaAlterarPagamento(dadosAntigos)
      || cv.bloqueioDoCreditoNaAlteracao(venda.pagamentos, novos);
    if (bloqueio) throw new ErroVenda(409, bloqueio);

    const creditosAntigos = fin.computeBankCreditsMap(venda.pagamentos || []);
    const creditosNovos = fin.computeBankCreditsMap(novos);
    const saldos = new Map();
    for (const bancoId of new Set([...creditosAntigos.keys(), ...creditosNovos.keys()])) {
      const s = await tx.get(db.collection('bancos').doc(bancoId));
      if (!s.exists || s.data().tenantId !== tenantId) {
        if (creditosNovos.has(bancoId)) throw new ErroVenda(400, 'O banco de destino selecionado não foi encontrado.');
        continue;
      }
      saldos.set(bancoId, Number(s.data().saldoCentavos || 0));
    }

    // ---------------- ESCRITAS ----------------
    saldos.forEach((saldoAtual, bancoId) => {
      const delta = (creditosNovos.get(bancoId) || 0) - (creditosAntigos.get(bancoId) || 0);
      if (delta === 0) return;
      tx.update(db.collection('bancos').doc(bancoId), {
        saldoCentavos: saldoAtual + delta,
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), `Ajuste de forma de pagamento da venda #${numeroPedido}`),
      });
    });

    const idsNovos = new Set(novos.map((p) => p.transactionId));
    novos.forEach((p) => {
      const parcela = p.cartao && p.cartao.numero ? ` (Parcela ${p.cartao.numero}/${p.cartao.totalParcelas})` : '';
      tx.set(db.collection('transacoes').doc(p.transactionId), {
        descricao: `Venda Direta #${numeroPedido} - ${p.formaPagamento}${parcela}`,
        categoria: 'Venda de Peças',
        valor: p.valor,
        valorCentavos: p.valorCentavos,
        valorBruto: p.valor,
        valorBrutoCentavos: p.valorCentavos,
        valorTaxa: (p.cartao && p.cartao.valorTaxa) || 0,
        valorTaxaCentavos: (p.cartao && p.cartao.valorTaxaCentavos) || 0,
        valorLiquido: p.cartao && p.cartao.valorLiquido != null ? p.cartao.valorLiquido : p.valor,
        valorLiquidoCentavos: p.cartao && p.cartao.valorLiquidoCentavos != null ? p.cartao.valorLiquidoCentavos : p.valorCentavos,
        tipo: 'entrada',
        formaPagamento: p.formaPagamento,
        condicaoPagamento: p.condicaoPagamento,
        status: p.status === 'confirmado' ? 'Paga' : 'Pendente',
        naturezaFinanceira: p.naturezaFinanceira,
        movimentaCaixaFisico: p.movimentaCaixaFisico,
        bancoId: p.bancoId || null,
        bancoNome: p.bancoNome || null,
        prazoDias: p.prazoDias || null,
        data: p.dataVencimento || venda.dataVenda,
        dataVencimento: p.dataVencimento || null,
        dataPrevistaRecebimento: p.dataPrevistaRecebimento || null,
        cartao: p.cartao || null,
        pedidoId,
        sourceType: 'pedido_venda',
        sourceId: pedidoId,
        paymentIndex: p.indice,
        idempotencyKey: `pedido:${pedidoId}:pagamento:${p.indice}`,
        clienteId: venda.clienteId ?? null,
        clienteNome: venda.clienteNome ?? null,
        usuarioResponsavelId: venda.usuarioResponsavelId ?? user.uid,
        vendedorId: venda.vendedorId ?? null,
        tenantId,
        createdAt: venda.createdAt ?? agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Forma de pagamento corrigida'),
      });
    });
    antigos.forEach((s) => {
      if (idsNovos.has(s.id)) return;
      tx.update(s.ref, {
        status: 'Cancelada',
        updatedAt: agora(),
        ...buildDocumentUpdateMetadata(user.uid, agora(), 'Substituída por correção de forma de pagamento'),
      });
    });
    tx.update(pedidoRef, {
      formaPagamento: resumo.paymentMethodLabel,
      condicaoPagamento: resumo.paymentCondition,
      pagamentos: novos,
      totalRecebido: resumo.received,
      totalRecebidoCentavos: resumo.receivedCents,
      totalPendente: resumo.pending,
      totalPendenteCentavos: resumo.pendingCents,
      totalTaxasPagamento: resumo.cardFee,
      totalTaxasPagamentoCentavos: resumo.cardFeeCents,
      totalLiquidoFinanceiro: resumo.financialNet,
      totalLiquidoFinanceiroCentavos: resumo.financialNetCents,
      pagamentoAlteradoEm: agora(),
      ...buildDocumentUpdateMetadata(user.uid, agora(), 'Forma de pagamento alterada em venda finalizada'),
    });
    return {
      pedidoId,
      numeroPedido,
      formaAnterior: String(venda.formaPagamento || ''),
      formaNova: resumo.paymentMethodLabel,
      totalCentavos,
      vendedorId: venda.vendedorId || '',
      vendedorNome: venda.vendedorNome || '',
    };
  });
};

module.exports = { cancelarVenda, cancelarPreVenda, alterarPagamento, temPermissao };
