import test from 'node:test';
import assert from 'node:assert/strict';
import { usesCsosn, ICMS_CST_OPTIONS } from '../src/utils/fiscalDomain';

test('Simples Nacional usa CSOSN', () => {
  assert.equal(usesCsosn('simples_nacional'), true);
});

test('Lucro Presumido nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_presumido'), false);
});

test('Lucro Real nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_real'), false);
});

test('ICMS_CST_OPTIONS tem os 11 codigos reais de CST de ICMS, sem duplicar CSOSN', () => {
  const values = ICMS_CST_OPTIONS.map((opt) => opt.value);
  assert.equal(values.length, 11);
  assert.deepEqual(values, ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90']);
  assert.equal(new Set(values).size, values.length);
});
