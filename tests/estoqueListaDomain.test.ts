import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordenarPorSaldo, proximaOrdemSaldo, saldoPassaNoFiltro } from '../src/utils/estoqueListaDomain';

test('botao da coluna Qtd.: padrao -> maior -> menor -> padrao', () => {
  assert.equal(proximaOrdemSaldo('padrao'), 'maior');
  assert.equal(proximaOrdemSaldo('maior'), 'menor');
  assert.equal(proximaOrdemSaldo('menor'), 'padrao');
});

test('filtro de saldo: zerados, negativos, os dois e com estoque (fracionado e sem numero)', () => {
  assert.equal(saldoPassaNoFiltro(0, 'zerados'), true);
  assert.equal(saldoPassaNoFiltro(0.0000000001, 'zerados'), true, 'resto de arredondamento conta como zero');
  assert.equal(saldoPassaNoFiltro(-2, 'zerados'), false);
  assert.equal(saldoPassaNoFiltro(-0.5, 'negativos'), true);
  assert.equal(saldoPassaNoFiltro(0, 'negativos'), false);
  assert.equal(saldoPassaNoFiltro(-1, 'zerados_negativos'), true);
  assert.equal(saldoPassaNoFiltro(0, 'zerados_negativos'), true);
  assert.equal(saldoPassaNoFiltro(3, 'zerados_negativos'), false);
  assert.equal(saldoPassaNoFiltro(0.25, 'com_estoque'), true);
  assert.equal(saldoPassaNoFiltro(0, 'com_estoque'), false);
  assert.equal(saldoPassaNoFiltro(undefined, 'zerados'), true, 'sem saldo gravado = zero');
  assert.equal(saldoPassaNoFiltro(-9, 'todos'), true);
});

test('ordenar pelo saldo: maior e menor primeiro; empate fica na ordem do codigo', () => {
  const linhas = [{ c: 1, q: 5 }, { c: 2, q: -3 }, { c: 3, q: 5 }, { c: 4, q: 0 }, { c: 5, q: 38 }];
  const de = (l: { q: number }) => l.q;
  assert.deepEqual(ordenarPorSaldo(linhas, 'maior', de).map((l) => l.c), [5, 1, 3, 4, 2]);
  assert.deepEqual(ordenarPorSaldo(linhas, 'menor', de).map((l) => l.c), [2, 4, 1, 3, 5]);
  assert.equal(ordenarPorSaldo(linhas, 'padrao', de), linhas);
});
