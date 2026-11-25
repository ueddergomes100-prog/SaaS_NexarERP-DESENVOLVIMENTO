import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LARGURA_MINIMA_MENU_NO_TOPO,
  chavePosicaoDoMenu,
  gruposQueCabem,
  lerPosicaoDoMenu,
  menuFicaNoTopo,
} from '../src/utils/menuNoTopoDomain';

test('posicao guardada: so "topo" vale topo; vazio ou lixo continua na lateral (o de sempre)', () => {
  assert.equal(lerPosicaoDoMenu('topo'), 'topo');
  assert.equal(lerPosicaoDoMenu('lateral'), 'lateral');
  assert.equal(lerPosicaoDoMenu(null), 'lateral');
  assert.equal(lerPosicaoDoMenu('TOPO'), 'lateral');
});

test('chave do computador e por usuario', () => {
  assert.notEqual(chavePosicaoDoMenu('ana'), chavePosicaoDoMenu('bia'));
  assert.equal(chavePosicaoDoMenu(undefined), chavePosicaoDoMenu(null));
});

test('topo so com janela larga; estreita (ou celular) volta para a lateral', () => {
  assert.equal(menuFicaNoTopo('topo', 1366), true);
  assert.equal(menuFicaNoTopo('topo', LARGURA_MINIMA_MENU_NO_TOPO - 1), false);
  assert.equal(menuFicaNoTopo('lateral', 1920), false);
  assert.equal(menuFicaNoTopo('topo', Number.NaN), false);
});

test('grupos que cabem: todos quando sobra espaco, senao os da frente mais o "Mais"', () => {
  assert.equal(gruposQueCabem([100, 120, 90], 400, 80), 3);
  assert.equal(gruposQueCabem([100, 120, 90, 110], 400, 80), 3);
  assert.equal(gruposQueCabem([100, 120, 90, 110], 330, 80), 2);
  assert.equal(gruposQueCabem([300], 100, 80), 0);
  assert.equal(gruposQueCabem([100, 100], 0, 80), 0);
});
