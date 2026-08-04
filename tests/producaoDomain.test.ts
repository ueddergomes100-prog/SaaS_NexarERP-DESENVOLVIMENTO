import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReservedRawMaterialMap, computeEstoquePrevisto } from '../src/utils/producaoDomain';

test('soma reservado de uma unica ordem ativa', () => {
  const reservado = computeReservedRawMaterialMap(
    [{ produtoId: 'produto-1', quantidadePlanejada: 10 }],
    { 'produto-1': [{ materiaPrimaId: 'mp-1', quantidade: 1.5 }] },
  );

  assert.equal(reservado.get('mp-1'), 15);
});

test('soma reservado de multiplas ordens que usam a mesma materia-prima', () => {
  const reservado = computeReservedRawMaterialMap(
    [
      { produtoId: 'produto-1', quantidadePlanejada: 10 },
      { produtoId: 'produto-2', quantidadePlanejada: 5 },
    ],
    {
      'produto-1': [{ materiaPrimaId: 'mp-1', quantidade: 2 }],
      'produto-2': [{ materiaPrimaId: 'mp-1', quantidade: 3 }],
    },
  );

  // produto-1: 10 * 2 = 20; produto-2: 5 * 3 = 15; total = 35
  assert.equal(reservado.get('mp-1'), 35);
});

test('ordem cujo produto nao tem composicao cadastrada e ignorada, sem lancar erro', () => {
  const reservado = computeReservedRawMaterialMap(
    [{ produtoId: 'produto-sem-composicao', quantidadePlanejada: 10 }],
    {},
  );

  assert.equal(reservado.size, 0);
});

test('materia-prima nao referenciada por nenhuma ordem ativa fica de fora do mapa', () => {
  const reservado = computeReservedRawMaterialMap(
    [{ produtoId: 'produto-1', quantidadePlanejada: 10 }],
    { 'produto-1': [{ materiaPrimaId: 'mp-1', quantidade: 1 }] },
  );

  assert.equal(reservado.get('mp-2'), undefined);
});

test('lista vazia de ordens ativas devolve mapa vazio', () => {
  const reservado = computeReservedRawMaterialMap([], { 'produto-1': [{ materiaPrimaId: 'mp-1', quantidade: 1 }] });
  assert.equal(reservado.size, 0);
});

test('estoque previsto subtrai o reservado do estoque atual', () => {
  assert.equal(computeEstoquePrevisto(100, 30), 70);
});

test('estoque previsto nunca fica negativo mesmo com reserva maior que o estoque', () => {
  assert.equal(computeEstoquePrevisto(10, 30), 0);
});
