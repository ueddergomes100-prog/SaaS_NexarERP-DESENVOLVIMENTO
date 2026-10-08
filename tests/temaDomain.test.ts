import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAVE_TEMA,
  PREFERENCIAS_TEMA,
  ROTULO_TEMA,
  lerPreferenciaTema,
  proximaPreferenciaTema,
  temaEfetivo,
  tituloDoBotaoDeTema,
} from '../src/utils/temaDomain';

test('a chave guardada e a mesma de sempre (quem ja escolheu claro continua no claro)', () => {
  assert.equal(CHAVE_TEMA, 'nexus_theme');
  assert.equal(lerPreferenciaTema('light'), 'light');
  assert.equal(lerPreferenciaTema('auto'), 'auto');
  assert.equal(lerPreferenciaTema('dark'), 'dark');
  assert.equal(lerPreferenciaTema(null), 'dark');
  assert.equal(lerPreferenciaTema('xpto'), 'dark');
});

test('automatico segue o aparelho; os outros ignoram o aparelho', () => {
  assert.equal(temaEfetivo('auto', true), 'dark');
  assert.equal(temaEfetivo('auto', false), 'light');
  assert.equal(temaEfetivo('dark', false), 'dark');
  assert.equal(temaEfetivo('light', true), 'light');
});

test('o botao roda escuro -> claro -> automatico -> escuro', () => {
  assert.equal(proximaPreferenciaTema('dark'), 'light');
  assert.equal(proximaPreferenciaTema('light'), 'auto');
  assert.equal(proximaPreferenciaTema('auto'), 'dark');
  assert.deepEqual([...PREFERENCIAS_TEMA], ['dark', 'light', 'auto']);
  PREFERENCIAS_TEMA.forEach((p) => assert.ok(ROTULO_TEMA[p]));
});

test('dica do botao diz o que vale e o que o clique faz', () => {
  assert.equal(tituloDoBotaoDeTema('dark', true), 'Tema escuro — clique para claro');
  assert.equal(tituloDoBotaoDeTema('light', true), 'Tema claro — clique para automático');
  assert.equal(tituloDoBotaoDeTema('auto', false), 'Tema automático (agora claro, igual ao aparelho) — clique para escuro');
});
