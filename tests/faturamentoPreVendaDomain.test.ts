import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEmptyPaymentDraft, normalizePayments, type PaymentDraft } from '../src/utils/financeDomain';
import { diasAteOFaturamento, reancorarVencimentosNoFaturamento } from '../src/utils/faturamentoPreVendaDomain';

const PRE_VENDA = '2026-10-10';
const FATURAMENTO = '2026-10-15';

const boleto = (extra: Partial<PaymentDraft> = {}): PaymentDraft => ({
  ...createEmptyPaymentDraft('b1', 100000, 30, 'Boleto'),
  dataPrevistaRecebimento: '2026-11-09', // 30 dias da pre-venda
  bancoId: 'banco-1',
  bancoNome: 'SICOOB',
  ...extra,
});

test('dias ate o faturamento: so conta quando o faturamento e depois', () => {
  assert.equal(diasAteOFaturamento(PRE_VENDA, FATURAMENTO), 5);
  assert.equal(diasAteOFaturamento(FATURAMENTO, FATURAMENTO), 0);
  assert.equal(diasAteOFaturamento(FATURAMENTO, PRE_VENDA), 0);
  assert.equal(diasAteOFaturamento('', FATURAMENTO), 0);
});

test('boleto de 30 dias passa a vencer 30 dias depois do FATURAMENTO (pedido do cliente, 15/10/2026)', () => {
  const [b] = reancorarVencimentosNoFaturamento([boleto()], PRE_VENDA, FATURAMENTO);
  assert.equal(b.dataPrevistaRecebimento, '2026-11-14');
  // E o fechamento do financeiro, com a data da venda = faturamento, aceita e usa essa data.
  const [registro] = normalizePayments(100000, [b], { saleDate: FATURAMENTO });
  assert.equal(registro.dataVencimento, '2026-11-14');
});

test('sem reancorar, o boleto antigo ficaria com 25 dias de prazo de verdade', () => {
  const [registro] = normalizePayments(100000, [boleto()], { saleDate: FATURAMENTO });
  assert.equal(registro.dataVencimento, '2026-11-09');
});

test('boleto com vencimentos escolhidos um a um: todos andam o mesmo tanto', () => {
  const [b] = reancorarVencimentosNoFaturamento([boleto({
    parcelasAPrazo: '3',
    parcelasPersonalizadas: [
      { dias: '10', vencimento: '2026-10-20' },
      { dias: '15', vencimento: '2026-10-25' },
      { dias: '30', vencimento: '2026-11-09' },
    ],
  })], PRE_VENDA, FATURAMENTO);
  assert.deepEqual(b.parcelasPersonalizadas?.map((p) => p.vencimento), ['2026-10-25', '2026-10-30', '2026-11-14']);
});

test('a prazo com data anda; cheque, cartao e dinheiro nao mudam', () => {
  const aPrazo = { ...createEmptyPaymentDraft('p1', 5000, 30, 'Pagamento a Prazo'), dataVencimento: '2026-11-09' };
  const cheque = { ...createEmptyPaymentDraft('c1', 5000, 30, 'Cheque'), dataPrevistaRecebimento: '2026-11-01' };
  const cartao = { ...createEmptyPaymentDraft('k1', 5000, 30, 'Cartão de Crédito'), dataPrevistaRecebimento: '2026-11-10' };
  const dinheiro = createEmptyPaymentDraft('d1', 5000, 30, 'Dinheiro');
  const [p, c, k, d] = reancorarVencimentosNoFaturamento([aPrazo, cheque, cartao, dinheiro], PRE_VENDA, FATURAMENTO);
  assert.equal(p.dataVencimento, '2026-11-14');
  assert.equal(c.dataPrevistaRecebimento, '2026-11-01', 'cheque: data escrita no cheque');
  assert.equal(k.dataPrevistaRecebimento, '2026-11-10');
  assert.deepEqual(d, dinheiro);
});

test('faturado no mesmo dia: nada muda; campo vazio continua vazio', () => {
  const pagamentos = [boleto()];
  assert.equal(reancorarVencimentosNoFaturamento(pagamentos, FATURAMENTO, FATURAMENTO), pagamentos);
  const [semData] = reancorarVencimentosNoFaturamento([boleto({ dataPrevistaRecebimento: '' })], PRE_VENDA, FATURAMENTO);
  assert.equal(semData.dataPrevistaRecebimento, '', 'sem data, o fechamento calcula do faturamento + prazo');
  const [registro] = normalizePayments(100000, [semData], { saleDate: FATURAMENTO });
  assert.equal(registro.dataVencimento, '2026-11-14');
});
