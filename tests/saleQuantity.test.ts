import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidSaleQuantity } from '../src/utils/saleQuantity';

test('quantidade inteira e valida independente da unidade ser fracionada', () => {
  assert.equal(isValidSaleQuantity(3, true), true);
  assert.equal(isValidSaleQuantity(3, false), true);
  assert.equal(isValidSaleQuantity(3, undefined), true);
});

test('quantidade fracionada so e valida quando a unidade permite', () => {
  assert.equal(isValidSaleQuantity(1.5, true), true);
});

test('quantidade fracionada e invalida quando a unidade nao permite', () => {
  assert.equal(isValidSaleQuantity(1.5, false), false);
  assert.equal(isValidSaleQuantity(1.5, undefined), false);
});

test('quantidade zero ou negativa e sempre invalida', () => {
  assert.equal(isValidSaleQuantity(0, true), false);
  assert.equal(isValidSaleQuantity(-1, true), false);
});

test('quantidade nao finita (NaN/Infinity) e invalida', () => {
  assert.equal(isValidSaleQuantity(NaN, true), false);
  assert.equal(isValidSaleQuantity(Infinity, true), false);
});
