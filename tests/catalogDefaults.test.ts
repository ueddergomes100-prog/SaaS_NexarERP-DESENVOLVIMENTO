import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickMissingDefaults } from '../src/utils/catalogDefaults';

test('pickMissingDefaults ignora itens ja existentes pela chave de dedupe', () => {
  const defaults = [
    { sigla: 'UN', nome: 'UNIDADE' },
    { sigla: 'KG', nome: 'QUILOGRAMA' },
    { sigla: 'LTS', nome: 'LITRO' },
  ];
  const existing = [{ sigla: 'un' }];

  const result = pickMissingDefaults(defaults, existing, 'sigla');

  assert.deepEqual(result.map((item) => item.sigla), ['KG', 'LTS']);
});

test('pickMissingDefaults retorna tudo quando nao ha itens existentes', () => {
  const defaults = [{ nome: 'Visa' }, { nome: 'Mastercard' }];
  const result = pickMissingDefaults(defaults, [], 'nome');

  assert.equal(result.length, 2);
});

test('pickMissingDefaults nao retorna nada quando tudo ja existe', () => {
  const defaults = [{ nome: 'Visa' }, { nome: 'Mastercard' }];
  const existing = [{ nome: 'VISA' }, { nome: ' mastercard ' }];

  const result = pickMissingDefaults(defaults, existing, 'nome');

  assert.equal(result.length, 0);
});

test('pickMissingDefaults ignora espacos nas pontas e caixa na comparacao', () => {
  const defaults = [{ nome: '  Elo  ' }];
  const existing = [{ nome: 'elo' }];

  const result = pickMissingDefaults(defaults, existing, 'nome');

  assert.equal(result.length, 0);
});
