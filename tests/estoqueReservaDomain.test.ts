import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAvailableStock,
  computeReservationCommit,
  computeReservationDelta,
  computeReservationRelease,
  computeReservationReturn,
  DEFAULT_MOMENTO_BAIXA_ESTOQUE,
  MOMENTO_BAIXA_ESTOQUE_OPTIONS,
  type StockLineItem,
} from '../src/utils/estoqueReservaDomain';

const item = (id: string, quantidade: number, nome?: string): StockLineItem => ({ id, nome, quantidade });

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

test('computeReservationDelta: item novo (previous vazio) reserva a quantidade inteira', () => {
  const deltas = computeReservationDelta([], [item('p1', 10)]);
  assert.deepEqual(deltas, [{ id: 'p1', nome: undefined, quantidadeDelta: 0, quantidadeReservadaDelta: 10 }]);
});

test('computeReservationDelta: item removido (next vazio) libera a reserva inteira', () => {
  const deltas = computeReservationDelta([item('p1', 10, 'Peca 1')], []);
  assert.deepEqual(deltas, [{ id: 'p1', nome: 'Peca 1', quantidadeDelta: 0, quantidadeReservadaDelta: -10 }]);
});

test('computeReservationDelta: quantidade aumentada reserva so a diferenca', () => {
  const deltas = computeReservationDelta([item('p1', 4)], [item('p1', 10)]);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].quantidadeReservadaDelta, 6);
});

test('computeReservationDelta: quantidade diminuida libera so a diferenca', () => {
  const deltas = computeReservationDelta([item('p1', 10)], [item('p1', 4)]);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].quantidadeReservadaDelta, -6);
});

test('computeReservationDelta: sem mudanca nao gera nenhum delta', () => {
  const deltas = computeReservationDelta([item('p1', 10)], [item('p1', 10)]);
  assert.deepEqual(deltas, []);
});

test('computeReservationDelta: soma ids duplicados dentro de previous e de next', () => {
  const deltas = computeReservationDelta(
    [item('p1', 2), item('p1', 3)],
    [item('p1', 4), item('p1', 4)]
  );
  // previous: 2+3=5; next: 4+4=8; delta = 3
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].quantidadeReservadaDelta, 3);
});

test('computeReservationDelta: ignora id "avulso" e quantidade zero/negativa', () => {
  const deltas = computeReservationDelta([], [item('avulso', 5), item('p1', 0), item('p2', -3)]);
  assert.deepEqual(deltas, []);
});

test('computeReservationDelta: quantidadeDelta e sempre 0 no resultado', () => {
  const deltas = computeReservationDelta([item('p1', 2)], [item('p1', 9), item('p2', 5)]);
  assert.ok(deltas.every(delta => delta.quantidadeDelta === 0));
});

test('computeReservationCommit: libera a reserva anterior e debita exatamente o commit', () => {
  const deltas = computeReservationCommit([item('p1', 10)], [item('p1', 10)]);
  assert.deepEqual(deltas, [{ id: 'p1', nome: undefined, quantidadeDelta: -10, quantidadeReservadaDelta: -10 }]);
});

test('computeReservationCommit: peca removida antes de finalizar ainda libera, sem debitar', () => {
  const deltas = computeReservationCommit([item('p1', 10, 'Peca 1')], []);
  assert.deepEqual(deltas, [{ id: 'p1', nome: 'Peca 1', quantidadeDelta: 0, quantidadeReservadaDelta: -10 }]);
});

test('computeReservationCommit: peca nova adicionada so na finalizacao debita sem liberar nada', () => {
  const deltas = computeReservationCommit([], [item('p1', 5, 'Peca 1')]);
  assert.deepEqual(deltas, [{ id: 'p1', nome: 'Peca 1', quantidadeDelta: -5, quantidadeReservadaDelta: 0 }]);
});

test('computeReservationReturn: devolve a quantidade real e libera reserva remanescente', () => {
  const deltas = computeReservationReturn([item('p1', 2)], [item('p1', 10, 'Peca 1')]);
  assert.deepEqual(deltas, [{ id: 'p1', nome: 'Peca 1', quantidadeDelta: 10, quantidadeReservadaDelta: -2 }]);
});

test('computeReservationRelease e exatamente computeReservationCommit(previous, [])', () => {
  const previous = [item('p1', 7, 'Peca 1'), item('p2', 3, 'Peca 2')];
  assert.deepEqual(computeReservationRelease(previous), computeReservationCommit(previous, []));
});
