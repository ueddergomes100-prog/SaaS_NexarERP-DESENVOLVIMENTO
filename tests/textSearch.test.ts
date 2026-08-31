import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesAllSearchTerms, normalizeSearchText, splitSearchTerms } from '../src/utils/textSearch';

test('normalizeSearchText remove acento, espacos e caixa', () => {
  assert.equal(normalizeSearchText('  João da SILVA  '), 'joao da silva');
});

test('normalizeSearchText trata valor nulo/indefinido como string vazia', () => {
  assert.equal(normalizeSearchText(null), '');
  assert.equal(normalizeSearchText(undefined), '');
});

// --- Busca com "+" (todos os termos obrigatorios) --------------------------

test('splitSearchTerms quebra no "+" e ignora espaco e pedaco vazio', () => {
  assert.deepEqual(splitSearchTerms('Racao+Quatree+20KG'), ['Racao', 'Quatree', '20KG']);
  assert.deepEqual(splitSearchTerms(' racao + 20kg '), ['racao', '20kg']);
  assert.deepEqual(splitSearchTerms('racao++20kg'), ['racao', '20kg']);
  assert.deepEqual(splitSearchTerms('racao'), ['racao']);
  assert.deepEqual(splitSearchTerms('  '), []);
  assert.deepEqual(splitSearchTerms(null), []);
});

test('matchesAllSearchTerms exige TODAS as palavras, em qualquer ordem', () => {
  const nome = ['Ração Quatree Gourmet Cães Adultos 20KG'];

  assert.equal(matchesAllSearchTerms(nome, 'Ração+Quatree+20KG'), true);
  // Ordem nao importa -- e' esse o ponto do "+".
  assert.equal(matchesAllSearchTerms(nome, '20KG+gourmet+racao'), true);
  // Uma palavra que nao esta no nome derruba a busca inteira.
  assert.equal(matchesAllSearchTerms(nome, 'Ração+Quatree+10KG'), false);
});

test('matchesAllSearchTerms ignora acento nos dois sentidos', () => {
  // O cadastro tem acento e quem digita nao usa -- e o contrario tambem.
  assert.equal(matchesAllSearchTerms(['Ração Quatree'], 'racao'), true);
  assert.equal(matchesAllSearchTerms(['Racao Quatree'], 'ração'), true);
  assert.equal(matchesAllSearchTerms(['Manutenção Preventiva'], 'MANUTENCAO+preventiva'), true);
});

test('matchesAllSearchTerms aceita termos em campos diferentes', () => {
  // "racao" no nome e "premium" na marca: pra quem busca, os dois sao o produto.
  assert.equal(matchesAllSearchTerms(['Ração Cães', 'Premium Pet'], 'racao+premium'), true);
});

test('matchesAllSearchTerms com termo vazio nao filtra nada', () => {
  assert.equal(matchesAllSearchTerms(['Ração'], ''), true);
  assert.equal(matchesAllSearchTerms(['Ração'], '   '), true);
  assert.equal(matchesAllSearchTerms(['Ração'], '+'), true);
});

test('matchesAllSearchTerms ignora campo vazio sem quebrar', () => {
  assert.equal(matchesAllSearchTerms([null, undefined, 'Ração 20KG'], 'racao+20kg'), true);
  assert.equal(matchesAllSearchTerms([null, undefined], 'racao'), false);
});
