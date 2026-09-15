import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveComponente, computeReservedRawMaterialMap, computeEstoquePrevisto } from '../src/utils/producaoDomain';

test('soma reservado de uma unica ordem ativa', () => {
  const reservado = computeReservedRawMaterialMap(
    [{ produtoId: 'produto-1', quantidadePlanejada: 10 }],
    { 'produto-1': [{ componenteId: 'mp-1', origem: 'materia_prima' as const, quantidade: 1.5 }] },
  );

  assert.equal(reservado.get(chaveComponente('materia_prima', 'mp-1')), 15);
});

test('soma reservado de multiplas ordens que usam a mesma materia-prima', () => {
  const reservado = computeReservedRawMaterialMap(
    [
      { produtoId: 'produto-1', quantidadePlanejada: 10 },
      { produtoId: 'produto-2', quantidadePlanejada: 5 },
    ],
    {
      'produto-1': [{ componenteId: 'mp-1', origem: 'materia_prima' as const, quantidade: 2 }],
      'produto-2': [{ componenteId: 'mp-1', origem: 'materia_prima' as const, quantidade: 3 }],
    },
  );

  // produto-1: 10 * 2 = 20; produto-2: 5 * 3 = 15; total = 35
  assert.equal(reservado.get(chaveComponente('materia_prima', 'mp-1')), 35);
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
    { 'produto-1': [{ componenteId: 'mp-1', origem: 'materia_prima' as const, quantidade: 1 }] },
  );

  assert.equal(reservado.get(chaveComponente('materia_prima', 'mp-2')), undefined);
});

test('lista vazia de ordens ativas devolve mapa vazio', () => {
  const reservado = computeReservedRawMaterialMap([], { 'produto-1': [{ componenteId: 'mp-1', origem: 'materia_prima' as const, quantidade: 1 }] });
  assert.equal(reservado.size, 0);
});

test('estoque previsto subtrai o reservado do estoque atual', () => {
  assert.equal(computeEstoquePrevisto(100, 30), 70);
});

test('estoque previsto nunca fica negativo mesmo com reserva maior que o estoque', () => {
  assert.equal(computeEstoquePrevisto(10, 30), 0);
});

test('componente de estoque e materia-prima com o MESMO id nao se somam', () => {
  // Ids vem de colecoes diferentes (`estoque` e `materias_primas`) e podem
  // colidir. Antes da chave por origem, um consumia a reserva do outro.
  const reservado = computeReservedRawMaterialMap(
    [
      { produtoId: 'produto-1', quantidadePlanejada: 10 },
      { produtoId: 'produto-2', quantidadePlanejada: 10 },
    ],
    {
      'produto-1': [{ componenteId: 'id-igual', origem: 'materia_prima' as const, quantidade: 2 }],
      'produto-2': [{ componenteId: 'id-igual', origem: 'estoque' as const, quantidade: 3 }],
    },
  );

  assert.equal(reservado.get(chaveComponente('materia_prima', 'id-igual')), 20);
  assert.equal(reservado.get(chaveComponente('estoque', 'id-igual')), 30);
  assert.equal(reservado.size, 2);
});

test('semiacabado vindo de `estoque` entra na reserva igual a materia-prima', () => {
  const reservado = computeReservedRawMaterialMap(
    [{ produtoId: 'granola-embalada', quantidadePlanejada: 40 }],
    { 'granola-embalada': [{ componenteId: 'base-granola', origem: 'estoque' as const, quantidade: 0.5 }] },
  );

  assert.equal(reservado.get(chaveComponente('estoque', 'base-granola')), 20);
});
