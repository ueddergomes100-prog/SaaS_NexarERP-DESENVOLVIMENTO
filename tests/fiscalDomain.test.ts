import test from 'node:test';
import assert from 'node:assert/strict';
import { usesCsosn } from '../src/utils/fiscalDomain';

test('Simples Nacional usa CSOSN', () => {
  assert.equal(usesCsosn('simples_nacional'), true);
});

test('Lucro Presumido nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_presumido'), false);
});

test('Lucro Real nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_real'), false);
});
