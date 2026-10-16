import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reversePartialReceipt, applyPaymentReceipt, type PaymentRecord } from '../src/utils/financeDomain';
import {
  bloqueioDoParcial,
  erroDoValorRecebido,
  principalDaBaixa,
  separarValorRecebido,
  textoDoParcial,
  totalParaQuitar,
} from '../src/utils/baixaParcialDomain';

const SEM = { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0 };

test('principal = recebido - juros - multa + desconto; total para quitar', () => {
  assert.equal(principalDaBaixa(10300, { jurosCentavos: 200, multaCentavos: 100, descontoCentavos: 0 }), 10000);
  assert.equal(principalDaBaixa(9500, { ...SEM, descontoCentavos: 500 }), 10000);
  assert.equal(totalParaQuitar(100000, { jurosCentavos: 2000, multaCentavos: 1000, descontoCentavos: 500 }), 102500);
});

test('valor recebido: parcial aceito; acima do que falta, zero ou so\' juros recusados', () => {
  assert.equal(erroDoValorRecebido(100000, 10000, SEM), null);
  assert.equal(erroDoValorRecebido(100000, 100000, SEM), null);
  assert.match(erroDoValorRecebido(100000, 100001, SEM) || '', /passa do que falta/);
  assert.match(erroDoValorRecebido(100000, 0, SEM) || '', /Informe o valor recebido/);
  assert.match(erroDoValorRecebido(100000, 0, SEM, { pagar: true }) || '', /Informe o valor pago/);
  assert.match(erroDoValorRecebido(100000, 300, { jurosCentavos: 300, multaCentavos: 0, descontoCentavos: 0 }) || '', /não cobre os juros/);
  // Bloqueio da conta so' pesa quando nao quita.
  assert.match(erroDoValorRecebido(100000, 10000, SEM, { bloqueioParcial: 'tem boleto' }) || '', /tem boleto/);
  assert.equal(erroDoValorRecebido(100000, 100000, SEM, { bloqueioParcial: 'tem boleto' }), null);
});

test('juros e multa proporcionais a parte paga (decisao do dono)', () => {
  // Conta de 1.000 vencida: juros 20 + multa 10 sobre a conta inteira.
  const sugestao = { jurosCentavos: 2000, multaCentavos: 1000 };
  // Pagando 103,00: 100 da conta + 2 de juros + 1 de multa.
  assert.deepEqual(separarValorRecebido(100000, 10300, sugestao), { principalCentavos: 10000, jurosCentavos: 200, multaCentavos: 100 });
  // Pagando o total, tudo bate com a sugestao.
  assert.deepEqual(separarValorRecebido(100000, 103000, sugestao), { principalCentavos: 100000, jurosCentavos: 2000, multaCentavos: 1000 });
  // Arredondamento fica no principal: recebido = principal + juros + multa - desconto.
  const r = separarValorRecebido(100000, 3333, sugestao, 100);
  assert.equal(r.principalCentavos + r.jurosCentavos + r.multaCentavos - 100, 3333);
  // Sem juros: tudo e' principal.
  assert.deepEqual(separarValorRecebido(100000, 5000, { jurosCentavos: 0, multaCentavos: 0 }), { principalCentavos: 5000, jurosCentavos: 0, multaCentavos: 0 });
});

test('bloqueios: cartao, boleto emitido e parcela de renegociacao; texto "Recebido R$ x de R$ y"', () => {
  assert.match(bloqueioDoParcial({ formaPagamento: 'Cartão de Crédito' }), /cartão/);
  assert.match(bloqueioDoParcial({ boleto: { status: 'emitido' } }), /boleto emitido/);
  assert.equal(bloqueioDoParcial({ boleto: { status: 'cancelado' } }), '');
  assert.match(bloqueioDoParcial({ renegociacao: { id: 'r' } }), /renegociação/);
  assert.equal(bloqueioDoParcial({ formaPagamento: 'Pagamento a Prazo' }), '');
  assert.equal(textoDoParcial({ pagoParcialCentavos: 10000, valorAntesDoParcialCentavos: 100000 }).replace(/\s/g, ' '), 'Recebido R$ 100,00 de R$ 1.000,00');
  assert.equal(textoDoParcial({ pagoParcialCentavos: 10000, valorAntesDoParcialCentavos: 100000 }, true).replace(/\s/g, ' '), 'Pago R$ 100,00 de R$ 1.000,00');
  assert.equal(textoDoParcial({}), '');
});

test('venda: recebimento parcial divide o pagamento e o estorno junta de volta', () => {
  const pagamentos: PaymentRecord[] = [{ id: 'pg1', indice: 0, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', valorCentavos: 100000, valor: 1000, status: 'pendente', transactionId: 'r1' } as PaymentRecord];
  const comParcial = applyPaymentReceipt(pagamentos, { transactionId: 'r1', paymentIndex: 0, amountCents: 10000, method: 'Pix', receiptId: 'p1', receivedAt: '2026-10-16' });
  assert.equal(comParcial.length, 2);
  const devolvido = reversePartialReceipt(comParcial, { receiptId: 'p1', sourceTransactionId: 'r1' });
  assert.equal(devolvido.length, 1);
  assert.equal(devolvido[0].valorCentavos, 100000);
  assert.equal(devolvido[0].status, 'pendente');
  // Conta quitada depois do parcial: nao junta (estorna-se antes a quitacao).
  const quitada = applyPaymentReceipt(comParcial, { transactionId: 'r1', paymentIndex: 0, amountCents: 90000, method: 'Pix', receiptId: 'r1', receivedAt: '2026-10-16' });
  assert.throws(() => reversePartialReceipt(quitada, { receiptId: 'p1', sourceTransactionId: 'r1' }), /estorne antes o recebimento que quitou/);
  assert.throws(() => reversePartialReceipt(pagamentos, { receiptId: 'xx', sourceTransactionId: 'r1' }), /não foi encontrado/);
});
