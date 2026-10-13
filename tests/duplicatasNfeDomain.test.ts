import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicatasDaNota } from '../src/utils/duplicatasNfeDomain';

const boleto = (dataVencimento: string, numero: number, valor: number) => ({ formaPagamento: 'Boleto', dataVencimento, numeroParcelaAPrazo: numero, valor, valorCentavos: Math.round(valor * 100) });

test('parcela que venceu antes da emissao fica fora da nota, com aviso (rejeicao 900 do #0119)', () => {
  const r = duplicatasDaNota([boleto('2026-10-08', 1, 400), boleto('2026-11-08', 2, 481.17)], '2026-10-13');
  assert.deepEqual(r.duplicatas, [{ number: '002', dueDate: '2026-11-08T00:00:00', amount: 481.17 }]);
  assert.deepEqual(r.vencidas, ['08/10/2026']);
  assert.match(r.aviso ?? '', /A parcela do boleto que venceu em 08\/10\/2026 não foi na nota/);
});

test('vencimento no proprio dia da emissao vai na nota', () => {
  const r = duplicatasDaNota([boleto('2026-10-13', 1, 100)], '2026-10-13');
  assert.equal(r.duplicatas.length, 1);
  assert.equal(r.aviso, null);
});

test('todas vencidas: nota sai sem duplicata; so\' boleto com vencimento entra', () => {
  const r = duplicatasDaNota([
    boleto('2026-10-01', 1, 10), boleto('2026-10-05', 2, 10),
    { formaPagamento: 'Pix', dataVencimento: '2026-01-01', valorCentavos: 500 },
    { formaPagamento: 'Boleto', dataVencimento: '', valorCentavos: 500 },
  ], '2026-10-13');
  assert.deepEqual(r.duplicatas, []);
  assert.match(r.aviso ?? '', /As parcelas do boleto que venceram em 01\/10\/2026, 05\/10\/2026 não foram na nota/);
});

test('sem numero da parcela vira 001; sem valor usa centavos', () => {
  const r = duplicatasDaNota([{ formaPagamento: 'Boleto', dataVencimento: '2026-12-01', valorCentavos: 12345 }], '2026-10-13');
  assert.deepEqual(r.duplicatas, [{ number: '001', dueDate: '2026-12-01T00:00:00', amount: 123.45 }]);
});
