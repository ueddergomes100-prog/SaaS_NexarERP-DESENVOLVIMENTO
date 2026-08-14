import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAvailableStock,
  DEFAULT_MOMENTO_BAIXA_ESTOQUE,
  MOMENTO_BAIXA_ESTOQUE_OPTIONS,
} from '../src/utils/estoqueReservaDomain';

test('disponivel = quantidade quando nao ha nada reservado', () => {
  assert.equal(computeAvailableStock(100, 0), 100);
});

test('disponivel = quantidade quando quantidadeReservada e undefined (documento legado sem o campo)', () => {
  assert.equal(computeAvailableStock(100, undefined), 100);
});

test('disponivel subtrai a quantidade reservada da quantidade total', () => {
  assert.equal(computeAvailableStock(100, 30), 70);
});

test('disponivel nunca fica negativo quando reservado excede a quantidade', () => {
  assert.equal(computeAvailableStock(10, 30), 0);
});

test('disponivel e zero quando toda a quantidade esta reservada', () => {
  assert.equal(computeAvailableStock(50, 50), 0);
});

test('quantidade undefined e tratada como zero', () => {
  assert.equal(computeAvailableStock(undefined, 5), 0);
});

test('valores negativos de entrada sao normalizados antes do calculo', () => {
  assert.equal(computeAvailableStock(-5, -10), 0);
});

test('funciona com quantidades fracionarias (produto com unidade fracionada)', () => {
  assert.equal(computeAvailableStock(10.5, 3.25), 7.25);
});

test('MOMENTO_BAIXA_ESTOQUE_OPTIONS tem as 4 opcoes do plano, sem valores duplicados', () => {
  const values = MOMENTO_BAIXA_ESTOQUE_OPTIONS.map(option => option.value);
  assert.equal(values.length, 4);
  assert.deepEqual(values, ['imediato', 'pedido', 'caixa', 'nf']);
  assert.equal(new Set(values).size, values.length);
});

test('DEFAULT_MOMENTO_BAIXA_ESTOQUE e imediato (baixa imediata, comportamento atual obrigatorio)', () => {
  assert.equal(DEFAULT_MOMENTO_BAIXA_ESTOQUE, 'imediato');
});
