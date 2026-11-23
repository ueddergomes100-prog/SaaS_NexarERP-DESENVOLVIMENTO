import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pagamentoImpresso,
  rotuloDaForma,
  textoDosVencimentos,
} from '../src/utils/pagamentoImpressoDomain.js';

test('pagamento impresso: debito + a prazo separados (caso Jomarly 0339, 23/11/2026)', () => {
  const r = pagamentoImpresso([
    { formaPagamento: 'Cartão de Débito', valor: 412, valorCentavos: 41200, condicaoPagamento: 'avista', status: 'confirmado', dataPrevistaRecebimento: '2026-11-24' },
    { formaPagamento: 'Pagamento a Prazo', valor: 30, valorCentavos: 3000, condicaoPagamento: 'aprazo', status: 'pendente', dataVencimento: '2026-12-23', prazoDias: 30 },
  ]);
  assert.equal(r.pagoNaCompraCentavos, 41200);
  assert.equal(r.aPrazoCentavos, 3000);
  assert.equal(r.temAPrazo, true);
  assert.deepEqual(r.formas.map((f) => [f.forma, f.valorCentavos, f.aPrazo]), [
    ['Cartão de Débito', 41200, false],
    ['Pagamento a Prazo', 3000, true],
  ]);
  assert.equal(textoDosVencimentos(r.formas[1]), 'venc. 23/12/2026');
  // Cartao de debito nao ganha "vencimento" (a data prevista e' do banco, nao do cliente).
  assert.equal(textoDosVencimentos(r.formas[0]), '');
});

test('pagamento impresso: a prazo parcelado soma numa linha com todos os vencimentos em ordem', () => {
  const r = pagamentoImpresso([
    { formaPagamento: 'Pagamento a Prazo', valorCentavos: 5000, dataVencimento: '2027-01-22' },
    { formaPagamento: 'Pagamento a Prazo', valorCentavos: 5000, dataVencimento: '2026-12-23' },
  ]);
  assert.equal(r.formas.length, 1);
  assert.equal(r.formas[0].valorCentavos, 10000);
  assert.equal(r.formas[0].vezes, 2);
  assert.equal(textoDosVencimentos(r.formas[0]), '2x: 23/12/2026, 22/01/2027');
  assert.equal(r.pagoNaCompraCentavos, 0);
});

test('pagamento impresso: boleto conta como a prazo, mesmo sem condicao gravada', () => {
  const r = pagamentoImpresso([{ formaPagamento: 'Boleto', valor: 100, dataPrevistaRecebimento: '2026-12-10' }]);
  assert.equal(r.aPrazoCentavos, 10000);
  assert.equal(textoDosVencimentos(r.formas[0]), 'venc. 10/12/2026');
});

test('pagamento impresso: cartao parcelado e pix sao pagos na compra; cartao mostra as vezes', () => {
  const r = pagamentoImpresso([
    { formaPagamento: 'Cartão de Crédito', valorCentavos: 3334, cartao: { numero: 1, totalParcelas: 3 } },
    { formaPagamento: 'Cartão de Crédito', valorCentavos: 3333, cartao: { numero: 2, totalParcelas: 3 } },
    { formaPagamento: 'Cartão de Crédito', valorCentavos: 3333, cartao: { numero: 3, totalParcelas: 3 } },
    { formaPagamento: 'Pix', valor: 20 },
  ]);
  assert.equal(r.temAPrazo, false);
  assert.equal(r.pagoNaCompraCentavos, 12000);
  assert.equal(rotuloDaForma(r.formas[0]), 'Cartão de Crédito 3x');
  assert.equal(r.formas[0].valorCentavos, 10000);
  assert.equal(rotuloDaForma(r.formas[1]), 'Pix');
});

test('pagamento impresso: cartao simplificado com parcelas so de exibicao mostra as vezes', () => {
  const r = pagamentoImpresso([{ formaPagamento: 'Cartão de Crédito', valorCentavos: 10000, parcelasExibicao: 4 }]);
  assert.equal(rotuloDaForma(r.formas[0]), 'Cartão de Crédito 4x');
});

test('pagamento impresso: sem pagamentos, lixo ou valor zero -> nada a imprimir', () => {
  assert.deepEqual(pagamentoImpresso(undefined).formas, []);
  assert.deepEqual(pagamentoImpresso([null, 'x', { formaPagamento: 'Pix', valor: 0 }]).formas, []);
  assert.equal(pagamentoImpresso([]).temAPrazo, false);
});

test('pagamento impresso: pre-venda guarda so forma e valor -- a prazo sem data sai sem vencimento', () => {
  const r = pagamentoImpresso([{ forma: 'Pagamento a Prazo', valor: 30 }, { forma: 'Dinheiro', valor: 10 }]);
  assert.equal(r.aPrazoCentavos, 3000);
  assert.equal(r.pagoNaCompraCentavos, 1000);
  assert.equal(textoDosVencimentos(r.formas[0]), '');
});
