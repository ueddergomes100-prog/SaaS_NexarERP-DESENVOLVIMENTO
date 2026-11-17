import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compararPelaOrdem, parseColunasOcultasEstoque } from '../src/utils/estoqueColunasDomain.js';

test('colunas ocultas: so chaves conhecidas, sem repetir', () => {
  assert.deepEqual(parseColunasOcultasEstoque(['categoria', 'categoria', 'xyz', 3]), ['categoria']);
  assert.deepEqual(parseColunasOcultasEstoque(undefined), []);
});

test('ordem pelo codigo e numerica e pelo nome ignora acento', () => {
  const itens = [{ nome: 'TUBO', codigo: '10' }, { nome: 'ÁGUA', codigo: '2' }, { nome: 'abraçadeira', codigo: '1' }];
  assert.deepEqual([...itens].sort((a, b) => compararPelaOrdem(a, b, 'codigo', false)).map((i) => i.codigo), ['1', '2', '10']);
  assert.deepEqual([...itens].sort((a, b) => compararPelaOrdem(a, b, 'nome', false)).map((i) => i.codigo), ['1', '2', '10']);
  assert.deepEqual([...itens].sort((a, b) => compararPelaOrdem(a, b, 'codigo', true)).map((i) => i.codigo), ['10', '2', '1']);
});
