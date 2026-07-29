import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPaymentReceipt,
  buildCardFeeSchedulesByBrand,
  buildCommissionSnapshot,
  cancelCommissionSnapshot,
  createEmptyPaymentDraft,
  explodeInstallmentPaymentRecords,
  normalizeCreditCardFeeSchedule,
  normalizePayments,
  recalculateCommissionAfterReturn,
  summarizePayments,
  transactionFeeCents,
  transactionGrossCents,
  transactionNetCents,
  transactionMovesPhysicalCash,
  type PaymentDraft,
  type PaymentRecord,
} from '../src/utils/financeDomain';
import { addBusinessDaysToDateInput, getDashboardPeriodRange } from '../src/utils/dateTime';

const payment = (updates: Partial<PaymentDraft> = {}): PaymentDraft => ({
  ...createEmptyPaymentDraft('pagamento-1', 10_000),
  ...updates,
});

const assertNoUndefined = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertNoUndefined);
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, nestedValue]) => {
    assert.notEqual(nestedValue, undefined, `Campo ${key} não pode ser undefined`);
    assertNoUndefined(nestedValue);
  });
};

test('venda a prazo calcula 30 dias sem depender do fuso do computador', () => {
  const [record] = normalizePayments(10_000, [
    payment({ forma: 'Pagamento a Prazo', prazoDias: '30' }),
  ], { saleDate: '2026-07-18' });

  assert.equal(record.dataVencimento, '2026-08-17');
  assert.equal(record.prazoDias, 30);
  assert.equal(record.status, 'pendente');
  assert.equal(record.movimentaCaixaFisico, false);
});

test('venda a prazo aceita data direta e deriva a quantidade de dias', () => {
  const [record] = normalizePayments(10_000, [
    payment({
      forma: 'Pagamento a Prazo',
      prazoDias: '',
      dataVencimento: '2026-08-17',
    }),
  ], { saleDate: '2026-07-18' });

  assert.equal(record.prazoDias, 30);
  assert.equal(record.dataVencimento, '2026-08-17');
});

test('venda a prazo bloqueia ausência de vencimento e data não futura', () => {
  assert.throws(
    () => normalizePayments(10_000, [
      payment({ forma: 'Pagamento a Prazo', prazoDias: '', dataVencimento: '' }),
    ], { saleDate: '2026-07-18' }),
    /vencimento válida/,
  );
  assert.throws(
    () => normalizePayments(10_000, [
      payment({ forma: 'Pagamento a Prazo', prazoDias: '', dataVencimento: '2026-07-18' }),
    ], { saleDate: '2026-07-18' }),
    /vencimento válida/,
  );
});

test('cartão de crédito divide centavos, taxa e datas sem perder valor', () => {
  const [record] = normalizePayments(10_000, [
    payment({
      forma: 'Cartão de Crédito',
      parcelas: '3',
      bandeira: 'Visa',
      dataPrevistaRecebimento: '2026-08-17',
    }),
  ], {
    saleDate: '2026-07-18',
    creditFeePercent: 2.5,
    maxCreditInstallments: 12,
  });

  assert.equal(record.status, 'pendente');
  assert.equal(record.movimentaCaixaFisico, false);
  assert.equal(record.cartao?.valorTaxaCentavos, 250);
  assert.equal(record.cartao?.valorLiquidoCentavos, 9_750);
  assert.deepEqual(
    record.cartao?.detalhamentoParcelas.map((installment) => installment.valorCentavos),
    [3_334, 3_333, 3_333],
  );
  assert.deepEqual(
    record.cartao?.detalhamentoParcelas.map((installment) => installment.dataPrevistaRecebimento),
    ['2026-08-17', '2026-09-17', '2026-10-17'],
  );
  assert.equal(
    record.cartao?.detalhamentoParcelas.reduce((sum, installment) => sum + installment.valorLiquidoCentavos, 0),
    9_750,
  );
  assertNoUndefined(record);
});

test('cartão aplica a taxa exata configurada para cada quantidade de parcelas', () => {
  const schedule = normalizeCreditCardFeeSchedule({
    1: 1.5,
    6: 4.25,
    12: 7.9,
  });
  const [oneInstallment] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '1' }),
  ], {
    creditFeePercentByInstallment: schedule,
    maxCreditInstallments: 12,
  });
  const [sixInstallments] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '6' }),
  ], {
    creditFeePercentByInstallment: schedule,
    maxCreditInstallments: 12,
  });

  assert.equal(oneInstallment.cartao?.taxaPercentual, 1.5);
  assert.equal(oneInstallment.cartao?.valorTaxaCentavos, 900);
  assert.equal(sixInstallments.cartao?.taxaPercentual, 4.25);
  assert.equal(sixInstallments.cartao?.valorTaxaCentavos, 2_550);
  assert.equal(sixInstallments.cartao?.valorLiquidoCentavos, 57_450);
  assert.equal(summarizePayments([sixInstallments]).financialNetCents, 57_450);
});

test('taxa por bandeira vence o fallback global quando a bandeira tem schedule próprio', () => {
  const [visa] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '1', bandeira: 'Visa' }),
  ], {
    creditFeePercent: 9.9,
    cardFeeSchedulesByBrand: {
      Visa: { creditFeePercentByInstallment: normalizeCreditCardFeeSchedule({ 1: 1.5 }) },
    },
  });

  assert.equal(visa.cartao?.taxaPercentual, 1.5);
});

test('bandeira sem schedule proprio (ou nao selecionada) cai no fallback global', () => {
  const [semSchedule] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '1', bandeira: 'Elo' }),
  ], {
    creditFeePercent: 3.2,
    cardFeeSchedulesByBrand: { Visa: { creditFeePercent: 1.5 } },
  });
  const [semBandeira] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '1', bandeira: '' }),
  ], {
    creditFeePercent: 3.2,
    cardFeeSchedulesByBrand: { Visa: { creditFeePercent: 1.5 } },
  });

  assert.equal(semSchedule.cartao?.taxaPercentual, 3.2);
  assert.equal(semBandeira.cartao?.taxaPercentual, 3.2);
});

test('buildCardFeeSchedulesByBrand indexa por nome e ignora bandeiras sem taxa configurada', () => {
  const schedules = buildCardFeeSchedulesByBrand([
    { nome: 'Visa', taxaDebitoPercentual: 1.2, prazoRecebimentoCreditoDias: 15 },
    { nome: 'Elo' },
    { nome: '  ' },
  ]);

  assert.equal(schedules.Visa.debitFeePercent, 1.2);
  assert.equal(schedules.Visa.creditSettlementDays, 15);
  assert.deepEqual(schedules.Elo, {});
  assert.equal(Object.keys(schedules).length, 2);
});

test('addBusinessDaysToDateInput pula sabado e domingo', () => {
  assert.equal(addBusinessDaysToDateInput('2026-01-05', 1), '2026-01-06');
  assert.equal(addBusinessDaysToDateInput('2026-01-05', 5), '2026-01-12');
  assert.equal(addBusinessDaysToDateInput('2026-01-05', 0), '2026-01-05');
});

test('parcelas de credito sao espacadas em dias uteis quando installmentIntervalDays e informado', () => {
  const [record] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '3', bandeira: 'Visa' }),
  ], {
    saleDate: '2026-01-05',
    creditFeePercent: 0,
    cardFeeSchedulesByBrand: {
      Visa: { creditSettlementDays: 2 },
    },
  });

  assert.deepEqual(
    record.cartao?.detalhamentoParcelas.map((installment) => installment.dataPrevistaRecebimento),
    ['2026-01-07', '2026-01-09', '2026-01-13'],
  );
});

test('sem installmentIntervalDays, parcelas continuam espacadas por mes corrido (retrocompativel)', () => {
  const [record] = normalizePayments(60_000, [
    payment({
      forma: 'Cartão de Crédito',
      valor: '600.00',
      parcelas: '3',
      dataPrevistaRecebimento: '2026-08-17',
    }),
  ], { saleDate: '2026-07-18', creditFeePercent: 2.5, maxCreditInstallments: 12 });

  assert.deepEqual(
    record.cartao?.detalhamentoParcelas.map((installment) => installment.dataPrevistaRecebimento),
    ['2026-08-17', '2026-09-17', '2026-10-17'],
  );
});

test('explodeInstallmentPaymentRecords separa cada parcela em um registro proprio', () => {
  const [record] = normalizePayments(60_000, [
    payment({ forma: 'Cartão de Crédito', valor: '600.00', parcelas: '3', bandeira: 'Visa' }),
  ], {
    saleDate: '2026-01-05',
    creditFeePercent: 10,
    cardFeeSchedulesByBrand: { Visa: { creditSettlementDays: 2 } },
  });

  const exploded = explodeInstallmentPaymentRecords([record]);

  assert.equal(exploded.length, 3);
  assert.deepEqual(exploded.map((r) => r.cartao?.numero), [1, 2, 3]);
  assert.deepEqual(exploded.map((r) => r.cartao?.totalParcelas), [3, 3, 3]);
  assert.deepEqual(exploded.map((r) => r.cartao?.parcelas), [1, 1, 1]);
  assert.deepEqual(exploded.map((r) => r.indice), [1, 2, 3]);
  assert.deepEqual(exploded.map((r) => r.id), [`${record.id}-parcela-1`, `${record.id}-parcela-2`, `${record.id}-parcela-3`]);

  const somaValorCentavos = exploded.reduce((sum, r) => sum + r.valorCentavos, 0);
  assert.equal(somaValorCentavos, record.valorCentavos);
  const somaLiquidoCentavos = exploded.reduce((sum, r) => sum + Number(r.cartao?.valorLiquidoCentavos || 0), 0);
  assert.equal(somaLiquidoCentavos, record.cartao?.valorLiquidoCentavos);
});

test('explodeInstallmentPaymentRecords nao altera debito nem credito a vista', () => {
  const records = normalizePayments(20_000, [
    payment({ id: 'debito', forma: 'Cartão de Débito', valor: '100.00' }),
    payment({ id: 'credito-avista', forma: 'Cartão de Crédito', valor: '100.00', parcelas: '1' }),
  ]);

  const exploded = explodeInstallmentPaymentRecords(records);

  assert.equal(exploded.length, 2);
  assert.equal(exploded[0].id, 'debito');
  assert.equal(exploded[1].id, 'credito-avista');
});

test('débito rejeita parcelamento e crédito respeita máximo configurado', () => {
  assert.throws(
    () => normalizePayments(10_000, [
      payment({ forma: 'Cartão de Débito', parcelas: '2' }),
    ]),
    /débito não permite parcelamento/,
  );
  assert.throws(
    () => normalizePayments(10_000, [
      payment({ forma: 'Cartão de Crédito', parcelas: '13' }),
    ], { maxCreditInstallments: 12 }),
    /no máximo 12 parcelas/,
  );
});

test('pagamento dividido movimenta no caixa apenas a parte em dinheiro', () => {
  const records = normalizePayments(30_000, [
    payment({ id: 'dinheiro', forma: 'Dinheiro', valor: '100.00' }),
    payment({ id: 'cartao', forma: 'Cartão de Crédito', valor: '200.00', parcelas: '2' }),
  ]);
  const summary = summarizePayments(records);

  assert.equal(records[0].movimentaCaixaFisico, true);
  assert.equal(records[1].movimentaCaixaFisico, false);
  assert.equal(summary.receivedCents, 10_000);
  assert.equal(summary.pendingCents, 20_000);
});

test('OS usa o mesmo domínio para pagamentos mistos, digitais e a prazo', () => {
  const records = normalizePayments(30_000, [
    payment({ id: 'dinheiro-os', forma: 'Dinheiro', valor: '100.00' }),
    payment({ id: 'pix-os', forma: 'Pix', valor: '50.00' }),
    payment({
      id: 'prazo-os',
      forma: 'Pagamento a Prazo',
      valor: '150.00',
      prazoDias: '30',
    }),
  ], {
    operationLabel: 'OS',
    saleDate: '2026-07-19',
  });
  const summary = summarizePayments(records);

  assert.equal(records[0].naturezaFinanceira, 'caixa_fisico');
  assert.equal(records[1].naturezaFinanceira, 'bancario_digital');
  assert.equal(records[2].naturezaFinanceira, 'contas_receber');
  assert.equal(records[2].dataVencimento, '2026-08-18');
  assert.equal(summary.receivedCents, 15_000);
  assert.equal(summary.pendingCents, 15_000);
  assert.equal(summary.paymentCondition, 'aprazo');
  assert.equal(summary.paymentMethodLabel, 'Múltiplas');
});

test('baixa parcial por crédito e recebimento posterior preservam o total', () => {
  const original: PaymentRecord = {
    id: 'pagamento-1',
    indice: 1,
    formaPagamento: 'Pagamento a Prazo',
    condicaoPagamento: 'aprazo',
    valorCentavos: 10_000,
    valor: 100,
    status: 'pendente',
    naturezaFinanceira: 'contas_receber',
    movimentaCaixaFisico: false,
    transactionId: 'venda-1',
  };
  const partiallyPaid = applyPaymentReceipt([original], {
    transactionId: 'venda-1',
    paymentIndex: 1,
    amountCents: 3_000,
    method: 'Crédito de Devolução',
    receiptId: 'credito-1',
    receivedAt: '2026-07-19',
  });

  assert.equal(partiallyPaid.length, 2);
  assert.equal(partiallyPaid[0].valorCentavos, 7_000);
  assert.equal(partiallyPaid[0].status, 'pendente');
  assert.equal(partiallyPaid[1].naturezaFinanceira, 'credito_cliente');
  assert.equal(summarizePayments(partiallyPaid).pendingCents, 7_000);

  const fullyPaid = applyPaymentReceipt(partiallyPaid, {
    transactionId: 'venda-1',
    paymentIndex: 1,
    amountCents: 7_000,
    method: 'Dinheiro',
    receiptId: 'venda-1',
    receivedAt: '2026-07-20',
  });
  const summary = summarizePayments(fullyPaid);
  assert.equal(summary.receivedCents, 10_000);
  assert.equal(summary.pendingCents, 0);
  assert.equal(fullyPaid[0].movimentaCaixaFisico, true);
});

test('snapshot de comissão não muda com percentual futuro e reage a devolução/cancelamento', () => {
  const snapshot = buildCommissionSnapshot({
    sellerId: 'vendedor-1',
    sellerName: 'Vendedor',
    baseCents: 10_000,
    profile: { recebeComissaoPecas: true, comissaoPercentualPecas: 5 },
    generatedAt: '2026-07-18T12:00:00.000Z',
  });
  assert.equal(snapshot.valorAtualCentavos, 500);

  const afterReturn = recalculateCommissionAfterReturn(snapshot, 2_000);
  assert.equal(afterReturn.baseAtualCentavos, 8_000);
  assert.equal(afterReturn.valorAtualCentavos, 400);

  const cancelled = cancelCommissionSnapshot(afterReturn, '2026-07-19T12:00:00.000Z');
  assert.equal(cancelled.status, 'cancelada');
  assert.equal(cancelled.valorAtualCentavos, 0);
});

test('períodos da dashboard usam São Paulo e semana iniciada na segunda-feira', () => {
  const now = new Date('2026-07-19T15:30:00.000Z');
  const today = getDashboardPeriodRange('hoje', now);
  const week = getDashboardPeriodRange('semana', now);
  const month = getDashboardPeriodRange('mes', now);

  assert.equal(today.start.toISOString(), '2026-07-19T03:00:00.000Z');
  assert.equal(week.start.toISOString(), '2026-07-13T03:00:00.000Z');
  assert.equal(month.start.toISOString(), '2026-07-01T03:00:00.000Z');
  assert.equal(today.end.toISOString(), now.toISOString());
});

test('flag explícita prevalece na classificação do caixa físico', () => {
  assert.equal(transactionMovesPhysicalCash({ formaPagamento: 'Dinheiro' }), true);
  assert.equal(transactionMovesPhysicalCash({ formaPagamento: 'Dinheiro', movimentaCaixaFisico: false }), false);
  assert.equal(transactionMovesPhysicalCash({ formaPagamento: 'Pix', naturezaFinanceira: 'caixa_fisico' }), true);
  assert.equal(transactionMovesPhysicalCash({ formaPagamento: 'Cartão de Crédito' }), false);
});

test('valores financeiros usam bruto, taxa e líquido inclusive em saldo parcial', () => {
  const transaction = {
    valor: 100,
    valorCentavos: 10_000,
    valorBrutoCentavos: 10_000,
    valorTaxaCentavos: 250,
    valorLiquidoCentavos: 9_750,
  };

  assert.equal(transactionGrossCents(transaction), 10_000);
  assert.equal(transactionFeeCents(transaction), 250);
  assert.equal(transactionNetCents(transaction), 9_750);
  assert.equal(transactionNetCents({ ...transaction, valor: 70, valorCentavos: 7_000 }), 6_825);
});
