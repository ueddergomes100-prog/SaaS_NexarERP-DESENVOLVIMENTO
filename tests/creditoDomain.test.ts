import test from 'node:test';
import assert from 'node:assert/strict';
import { excedeLimiteCredito, parseTrabalhaComLimiteCredito } from '../src/utils/creditoDomain';

test('excedeLimiteCredito bloqueia por sem_limite quando o cliente nao tem limite cadastrado', () => {
  assert.deepEqual(excedeLimiteCredito(null, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
  assert.deepEqual(excedeLimiteCredito(0, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
  assert.deepEqual(excedeLimiteCredito(undefined, 0, 10000), { bloqueado: true, motivo: 'sem_limite' });
});

test('excedeLimiteCredito libera quando saldo em aberto + venda cabe no limite', () => {
  // Limite de R$500 (50000 centavos), sem saldo em aberto, venda de R$100.
  assert.deepEqual(excedeLimiteCredito(50000, 0, 10000), { bloqueado: false, motivo: null });
});

test('excedeLimiteCredito bloqueia por limite_excedido quando saldo + venda estoura o limite', () => {
  // Limite de R$500, ja com R$450 em aberto, venda de R$100 estoura.
  assert.deepEqual(excedeLimiteCredito(50000, 45000, 10000), { bloqueado: true, motivo: 'limite_excedido' });
});

test('excedeLimiteCredito no limite exato nao bloqueia', () => {
  assert.deepEqual(excedeLimiteCredito(50000, 40000, 10000), { bloqueado: false, motivo: null });
});

test('excedeLimiteCredito ignora saldo/venda negativos na soma', () => {
  assert.deepEqual(excedeLimiteCredito(50000, -1000, 10000), { bloqueado: false, motivo: null });
});

test('parseTrabalhaComLimiteCredito so aceita true literal', () => {
  assert.equal(parseTrabalhaComLimiteCredito(true), true);
  assert.equal(parseTrabalhaComLimiteCredito(false), false);
  assert.equal(parseTrabalhaComLimiteCredito(undefined), false);
  assert.equal(parseTrabalhaComLimiteCredito('true'), false);
});
