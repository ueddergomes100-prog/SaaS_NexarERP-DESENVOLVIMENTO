import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSearchText } from '../src/utils/textSearch';

test('normalizeSearchText remove acento, espacos e caixa', () => {
  assert.equal(normalizeSearchText('  João da SILVA  '), 'joao da silva');
});

test('normalizeSearchText trata valor nulo/indefinido como string vazia', () => {
  assert.equal(normalizeSearchText(null), '');
  assert.equal(normalizeSearchText(undefined), '');
});
