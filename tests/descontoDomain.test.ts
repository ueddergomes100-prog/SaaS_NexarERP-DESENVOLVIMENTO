import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODO_LIMITE_DESCONTO,
  calcularDescontoCents,
  checarLimiteTotal,
  excedeLimiteItem,
  parseLimiteDescontoConfig,
  parseModoLimiteDesconto,
  resolveLimiteItem,
} from '../src/utils/descontoDomain';

test('calcularDescontoCents em percentual', () => {
  assert.equal(calcularDescontoCents('percentual', 10, 10000), 1000);
});

test('calcularDescontoCents em valor (reais para centavos)', () => {
  assert.equal(calcularDescontoCents('valor', 25.5, 10000), 2550);
});

test('calcularDescontoCents nunca passa da base (nem em valor, nem em percentual)', () => {
  assert.equal(calcularDescontoCents('valor', 999, 10000), 10000);
  assert.equal(calcularDescontoCents('percentual', 500, 10000), 10000);
});

test('calcularDescontoCents com valor zero/negativo ou base zero devolve 0', () => {
  assert.equal(calcularDescontoCents('percentual', 0, 10000), 0);
  assert.equal(calcularDescontoCents('percentual', -5, 10000), 0);
  assert.equal(calcularDescontoCents('valor', 10, 0), 0);
});

test('resolveLimiteItem le o percentual do produto quando presente', () => {
  assert.equal(resolveLimiteItem({ descontoMaximoPercentual: 5 }), 5);
});

test('resolveLimiteItem devolve null quando o produto nao define limite', () => {
  assert.equal(resolveLimiteItem({ descontoMaximoPercentual: 0 }), null);
  assert.equal(resolveLimiteItem({}), null);
  assert.equal(resolveLimiteItem(null), null);
  assert.equal(resolveLimiteItem(undefined), null);
});

test('excedeLimiteItem bloqueia desconto de item acima do limite do produto', () => {
  const produto = { descontoMaximoPercentual: 5 };
  // 10% de desconto num produto que so permite 5%.
  assert.equal(excedeLimiteItem(produto, 1000, 10000), true);
});

test('excedeLimiteItem aceita desconto dentro do limite do produto', () => {
  const produto = { descontoMaximoPercentual: 5 };
  assert.equal(excedeLimiteItem(produto, 500, 10000), false);
});

test('excedeLimiteItem nunca bloqueia quando o produto nao define limite', () => {
  assert.equal(excedeLimiteItem({}, 9999, 10000), false);
  assert.equal(excedeLimiteItem(null, 9999, 10000), false);
});

test('checarLimiteTotal: sem limite configurado nunca excede', () => {
  assert.deepEqual(checarLimiteTotal(null, 10000, 9999), { percentualAplicado: 99.99, excedeu: false });
  assert.deepEqual(checarLimiteTotal({ tipo: 'percentual', valor: 0 }, 10000, 9999).excedeu, false);
});

test('checarLimiteTotal em percentual: dentro e fora do limite', () => {
  const limite = { tipo: 'percentual' as const, valor: 10 };
  assert.equal(checarLimiteTotal(limite, 10000, 900).excedeu, false);
  assert.equal(checarLimiteTotal(limite, 10000, 1500).excedeu, true);
});

test('checarLimiteTotal em valor (R$): dentro e fora do limite', () => {
  const limite = { tipo: 'valor' as const, valor: 50 };
  assert.equal(checarLimiteTotal(limite, 100000, 4000).excedeu, false);
  assert.equal(checarLimiteTotal(limite, 100000, 6000).excedeu, true);
});

test('checarLimiteTotal no limite exato nao excede (tolerancia de arredondamento)', () => {
  const limite = { tipo: 'percentual' as const, valor: 10 };
  assert.equal(checarLimiteTotal(limite, 10000, 1000).excedeu, false);
});

test('parseLimiteDescontoConfig le formato valido', () => {
  assert.deepEqual(parseLimiteDescontoConfig({ tipo: 'valor', valor: 50 }), { tipo: 'valor', valor: 50 });
});

test('parseLimiteDescontoConfig cai em percentual/0 pra entrada invalida', () => {
  assert.deepEqual(parseLimiteDescontoConfig(undefined), { tipo: 'percentual', valor: 0 });
  assert.deepEqual(parseLimiteDescontoConfig({ tipo: 'xyz', valor: -5 }), { tipo: 'percentual', valor: 0 });
});

test('parseModoLimiteDesconto aceita so os 3 modos validos', () => {
  assert.equal(parseModoLimiteDesconto('bloquear'), 'bloquear');
  assert.equal(parseModoLimiteDesconto('senha'), 'senha');
  assert.equal(parseModoLimiteDesconto('avisar'), 'avisar');
  assert.equal(parseModoLimiteDesconto('lixo'), DEFAULT_MODO_LIMITE_DESCONTO);
  assert.equal(parseModoLimiteDesconto(undefined), DEFAULT_MODO_LIMITE_DESCONTO);
});
