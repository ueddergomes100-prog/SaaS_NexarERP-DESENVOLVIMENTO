import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descricaoDaVersao, lerVersaoDoSistema, rotuloDaVersao } from '../src/utils/versaoDoSistemaDomain';

/* Versao do sistema no cabecalho (23/11/2026): o carimbo do build, na hora de Brasilia. */

test('rotulo do cabecalho: dia, mes e hora de Brasilia em que o sistema foi publicado', () => {
  // 17:32 UTC = 14:32 em Brasilia.
  const v = lerVersaoDoSistema({ construidaEm: '2026-11-23T17:32:10.000Z', commit: '6bb0571' });
  assert.equal(rotuloDaVersao(v), 'v 23/11 14:32');
  // Build feito depois da meia-noite em UTC ainda e' o dia anterior em Brasilia.
  assert.equal(rotuloDaVersao(lerVersaoDoSistema({ construidaEm: '2026-11-24T01:05:00.000Z' })), 'v 23/11 22:05');
});

test('descricao (ao passar o mouse): data completa, codigo da alteracao e o que fazer para ver a versao nova', () => {
  const texto = descricaoDaVersao(lerVersaoDoSistema({ construidaEm: '2026-11-23T17:32:10.000Z', commit: '6BB0571ABCDEF' }));
  assert.match(texto, /publicada em 23\/11\/2026 às 14:32 \(horário de Brasília\)/);
  assert.match(texto, /Código da alteração: 6bb0571\./);
  assert.match(texto, /recarregue a página \(F5\)/);
});

test('build sem git: mostra so\' a data; sem a data, o codigo; sem nada, nao aparece', () => {
  const semGit = lerVersaoDoSistema({ construidaEm: '2026-11-23T17:32:10.000Z', commit: '' });
  assert.equal(semGit.commit, '');
  assert.equal(rotuloDaVersao(semGit), 'v 23/11 14:32');
  assert.doesNotMatch(descricaoDaVersao(semGit), /Código da alteração/);

  const semData = lerVersaoDoSistema({ construidaEm: 'ontem', commit: '6bb0571' });
  assert.equal(semData.construidaEm, '');
  assert.equal(rotuloDaVersao(semData), 'v 6bb0571');
  assert.match(descricaoDaVersao(semData), /Código da alteração: 6bb0571/);

  const semNada = lerVersaoDoSistema({});
  assert.equal(rotuloDaVersao(semNada), '');
  assert.equal(descricaoDaVersao(semNada), '');
});

test('codigo da alteracao: so\' aceita hash do git, cortado em 7', () => {
  assert.equal(lerVersaoDoSistema({ commit: '6bb0571' }).commit, '6bb0571');
  assert.equal(lerVersaoDoSistema({ commit: '  6BB0571C9F21AA  ' }).commit, '6bb0571');
  assert.equal(lerVersaoDoSistema({ commit: 'main' }).commit, '');
  assert.equal(lerVersaoDoSistema({ commit: 'fatal: not a git repository' }).commit, '');
  assert.equal(lerVersaoDoSistema({ commit: 123 }).commit, '');
});

test('maquina de desenvolvimento: aparece como dev, com o codigo quando tem', () => {
  const dev = lerVersaoDoSistema({ construidaEm: '2026-11-23T15:00:00.000Z', commit: '547f4a2', desenvolvimento: true });
  assert.equal(rotuloDaVersao(dev), 'dev 547f4a2');
  assert.match(descricaoDaVersao(dev), /máquina de desenvolvimento, iniciado em 23\/11\/2026 às 12:00\. Código da alteração: 547f4a2\./);
  assert.equal(rotuloDaVersao(lerVersaoDoSistema({ desenvolvimento: true })), 'dev');
});
