import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MENSAGEM_SO_PAGA,
  dataBrasileira,
  montarBaixaManual,
  planejarEstornoPagar,
  planejarEstornoReceber,
  validarDataBaixa,
  validarMotivoEstorno,
} from '../src/utils/baixaFinanceiraDomain';
import {
  applyPaymentReceipt,
  reversePaymentReceipt,
  summarizePayments,
  type PaymentRecord,
} from '../src/utils/financeDomain';

const HOJE = '2026-09-24';

test('data da baixa: hoje e dias passados valem', () => {
  assert.equal(validarDataBaixa('2026-09-24', HOJE), '');
  assert.equal(validarDataBaixa('2026-09-23', HOJE), '');
  assert.equal(validarDataBaixa('2026-01-01', HOJE), '');
});

test('data da baixa: futuro, vazio, inexistente e muito antiga são recusadas em português', () => {
  assert.match(validarDataBaixa('2026-09-25', HOJE), /futuro/);
  assert.match(validarDataBaixa('', HOJE), /Informe a data/);
  assert.match(validarDataBaixa('24/09/2026', HOJE), /Informe a data/);
  assert.match(validarDataBaixa('2026-02-31', HOJE), /não existe/);
  assert.match(validarDataBaixa('2026-13-01', HOJE), /não existe/);
  assert.match(validarDataBaixa('2019-05-10', HOJE), /muito antiga/);
});

test('data da baixa: 29/02 só existe em ano bissexto', () => {
  assert.equal(validarDataBaixa('2024-02-29', HOJE), '');
  assert.match(validarDataBaixa('2025-02-29', HOJE), /não existe/);
});

test('motivo do estorno: exige o mínimo, ignora espaços', () => {
  assert.match(validarMotivoEstorno(''), /Explique o motivo/);
  assert.match(validarMotivoEstorno('   ok   '), /Explique o motivo/);
  assert.equal(validarMotivoEstorno('baixa na data errada'), '');
});

test('marca da baixa: só grava banco quando houve, sem chave undefined', () => {
  const semBanco = montarBaixaManual({ origem: 'contas_pagar', formaPagamento: 'Dinheiro', dataPagamento: '2026-09-23', valorCentavos: 5000 });
  assert.equal('bancoId' in semBanco, false);
  assert.equal('movimentoBancoCentavos' in semBanco, false);
  const comBanco = montarBaixaManual({ origem: 'contas_pagar', formaPagamento: 'Pix', dataPagamento: '2026-09-23', valorCentavos: 5000, bancoId: 'b1', movimentoBancoCentavos: -5000 });
  assert.equal(comBanco.bancoId, 'b1');
  assert.equal(comBanco.movimentoBancoCentavos, -5000);
});

// ---------- Contas a Pagar ----------

test('pagar: conta pendente não estorna e não mostra botão', () => {
  const plano = planejarEstornoPagar({ status: 'Pendente' });
  assert.equal(plano.permitido, false);
  assert.equal(plano.mostrarBotao, false);
  assert.equal(plano.bloqueio, MENSAGEM_SO_PAGA);
});

test('pagar: baixa com a marca nova devolve ao banco exatamente o que debitou', () => {
  const plano = planejarEstornoPagar({
    status: 'Paga',
    baixaManual: { origem: 'contas_pagar', bancoId: 'b1', movimentoBancoCentavos: -12345 },
  });
  assert.equal(plano.permitido, true);
  assert.equal(plano.bancoId, 'b1');
  assert.equal(plano.ajusteBancoCentavos, 12345);
});

test('pagar: baixa antiga com banco (sem a marca) devolve o valor do título ao banco', () => {
  const plano = planejarEstornoPagar({
    status: 'Paga',
    bancoId: 'b1',
    valorCentavos: 8000,
    ultimaAlteracao: 'Pagamento confirmado',
  });
  assert.equal(plano.permitido, true);
  assert.equal(plano.bancoId, 'b1');
  assert.equal(plano.ajusteBancoCentavos, 8000);
});

test('pagar: baixa antiga em dinheiro (sem banco) estorna sem mexer em banco nenhum', () => {
  const plano = planejarEstornoPagar({ status: 'Paga', formaPagamento: 'Dinheiro', dataPagamento: '2026-09-20', valor: 50 });
  assert.equal(plano.permitido, true);
  assert.equal(plano.ajusteBancoCentavos, 0);
  assert.equal(plano.bancoId, undefined);
});

test('pagar: lançamento que nasceu já pago (sem data e forma de baixa) não é baixa e não mostra botão', () => {
  const nasceuPago = planejarEstornoPagar({ status: 'Paga', valor: 50 });
  assert.equal(nasceuPago.permitido, false);
  assert.equal(nasceuPago.mostrarBotao, false);
  assert.match(nasceuPago.bloqueio, /nasceu pago/);
  // So' a data, sem forma: tambem nao e' baixa da tela.
  assert.equal(planejarEstornoPagar({ status: 'Paga', dataPagamento: '2026-09-20' }).mostrarBotao, false);
});

test('pagar: pagamento que nasceu com outra operação não é baixa e fica bloqueado', () => {
  for (const marca of [{ notaAvulsaId: 'n1' }, { devolucaoId: 'd1' }, { pedidoOrigemId: 'p1' }, { idempotencyKey: 'k' }]) {
    const plano = planejarEstornoPagar({ status: 'Paga', ...marca });
    assert.equal(plano.permitido, false);
    assert.equal(plano.mostrarBotao, false);
    assert.match(plano.bloqueio, /outra operação/);
  }
});

test('pagar: banco vinculado sem a marca de baixa é bloqueado para não errar o saldo', () => {
  const plano = planejarEstornoPagar({ status: 'Paga', bancoId: 'b1', valorCentavos: 100 });
  assert.equal(plano.permitido, false);
  assert.match(plano.bloqueio, /Financeiro > Bancos/);
});

// ---------- Contas a Receber ----------

test('receber: baixa com a marca nova tira do banco exatamente o que creditou', () => {
  const plano = planejarEstornoReceber({
    status: 'Paga',
    formaPagamento: 'Pix',
    formaPagamentoOriginal: 'Pagamento a Prazo',
    baixaManual: { origem: 'contas_receber', bancoId: 'b1', movimentoBancoCentavos: 30000 },
  });
  assert.equal(plano.permitido, true);
  assert.equal(plano.bancoId, 'b1');
  assert.equal(plano.ajusteBancoCentavos, -30000);
  assert.equal(plano.formaAnterior, 'Pagamento a Prazo');
  assert.equal(plano.naturezaAnterior, 'contas_receber');
});

test('receber: baixa antiga em Pix com banco tira o valor do título do banco', () => {
  const plano = planejarEstornoReceber({
    status: 'Paga',
    formaPagamento: 'Pix',
    formaPagamentoOriginal: 'Pagamento a Prazo',
    bancoId: 'b1',
    valorCentavos: 45000,
    ultimaAlteracao: 'Recebimento confirmado',
  });
  assert.equal(plano.permitido, true);
  assert.equal(plano.ajusteBancoCentavos, -45000);
});

test('receber: baixa antiga em dinheiro não mexe em banco, mesmo se o título tinha banco de antes', () => {
  const plano = planejarEstornoReceber({
    status: 'Paga',
    formaPagamento: 'Dinheiro',
    formaPagamentoOriginal: 'Pagamento a Prazo',
    bancoId: 'b-antigo',
    valorCentavos: 45000,
    ultimaAlteracao: 'Recebimento confirmado',
  });
  assert.equal(plano.permitido, true);
  assert.equal(plano.ajusteBancoCentavos, 0);
  assert.equal(plano.bancoId, undefined);
});

test('receber: boleto baixado pelo retorno do banco é bloqueado com aviso (decisão do dono)', () => {
  const porForma = planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Boleto' });
  const porStatus = planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Pix', boleto: { status: 'pago' } });
  for (const plano of [porForma, porStatus]) {
    assert.equal(plano.permitido, false);
    assert.equal(plano.mostrarBotao, true);
    assert.match(plano.bloqueio, /retorno do banco/);
  }
});

test('receber: crédito de cliente e cheque compensado são bloqueados', () => {
  assert.match(planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Crédito de Devolução' }).bloqueio, /crédito do cliente/);
  assert.match(planejarEstornoReceber({ status: 'Paga', naturezaFinanceira: 'credito_cliente' }).bloqueio, /crédito do cliente/);
  assert.match(planejarEstornoReceber({ status: 'Paga', sourcePaymentTransactionId: 't1' }).bloqueio, /crédito do cliente/);
  assert.match(planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Cheque', cheque: { numero: '1' } }).bloqueio, /cheque/);
});

test('receber: recebido no balcão (sem "Dar Baixa") não mostra botão de estorno', () => {
  const plano = planejarEstornoReceber({ status: 'Paga', formaPagamento: 'Dinheiro' });
  assert.equal(plano.permitido, false);
  assert.equal(plano.mostrarBotao, false);
});

// ---------- Desfazer o pagamento dentro da venda ----------

const pagamentoAPrazo = (): PaymentRecord => ({
  id: 'p1',
  indice: 1,
  formaPagamento: 'Pagamento a Prazo',
  condicaoPagamento: 'aprazo',
  valorCentavos: 50000,
  valor: 500,
  status: 'pendente',
  naturezaFinanceira: 'contas_receber',
  movimentaCaixaFisico: false,
  transactionId: 't1',
});

test('estorno na venda: receber e estornar devolve o pagamento ao estado de antes', () => {
  const original = [pagamentoAPrazo()];
  const recebido = applyPaymentReceipt(original, {
    transactionId: 't1', paymentIndex: 1, amountCents: 50000, method: 'Pix', receiptId: 't1', receivedAt: '2026-09-23',
  });
  assert.equal(recebido[0].status, 'confirmado');
  assert.equal(summarizePayments(recebido).pendingCents, 0);

  const desfeito = reversePaymentReceipt(recebido, { transactionId: 't1', paymentIndex: 1 });
  assert.deepEqual(desfeito, original);
  const resumo = summarizePayments(desfeito);
  assert.equal(resumo.pendingCents, 50000);
  assert.equal(resumo.receivedCents, 0);
});

test('estorno na venda: a chave dos dados do recebimento some (Firestore recusa undefined)', () => {
  const recebido = applyPaymentReceipt([pagamentoAPrazo()], {
    transactionId: 't1', paymentIndex: 1, amountCents: 50000, method: 'Dinheiro', receiptId: 't1', receivedAt: '2026-09-23',
  });
  const [desfeito] = reversePaymentReceipt(recebido, { transactionId: 't1' });
  for (const chave of ['recebidoEm', 'formaRecebimento', 'naturezaRecebimento']) {
    assert.equal(chave in desfeito, false, `${chave} deveria ter saído`);
  }
});

test('estorno na venda: só mexe no pagamento certo quando há vários', () => {
  const dois: PaymentRecord[] = [
    { ...pagamentoAPrazo(), id: 'a', indice: 1, transactionId: 't1', status: 'confirmado', recebidoEm: '2026-09-20' },
    { ...pagamentoAPrazo(), id: 'b', indice: 2, transactionId: 't2', status: 'confirmado', recebidoEm: '2026-09-21' },
  ];
  const desfeito = reversePaymentReceipt(dois, { transactionId: 't2' });
  assert.equal(desfeito[0].status, 'confirmado');
  assert.equal(desfeito[1].status, 'pendente');
});

test('estorno na venda: pagamento sem id de transação é achado pelo índice', () => {
  const semId: PaymentRecord = { ...pagamentoAPrazo(), status: 'confirmado', recebidoEm: '2026-09-20' };
  delete semId.transactionId;
  const [desfeito] = reversePaymentReceipt([semId], { transactionId: 'qualquer', paymentIndex: 1 });
  assert.equal(desfeito.status, 'pendente');
});

test('estorno na venda: pagamento que já está pendente não é achado, com aviso em português', () => {
  assert.throws(
    () => reversePaymentReceipt([pagamentoAPrazo()], { transactionId: 't1', paymentIndex: 1 }),
    /não foi encontrado como recebido/,
  );
});

test('data em texto brasileiro', () => {
  assert.equal(dataBrasileira('2026-09-24'), '24/09/2026');
  assert.equal(dataBrasileira(undefined), '');
  assert.equal(dataBrasileira('lixo'), '');
});
