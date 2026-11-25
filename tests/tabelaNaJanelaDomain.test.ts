import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALTURA_MINIMA_DA_TABELA,
  FOLGA_NO_RODAPE,
  alturaDaTabelaNaJanela,
  usaTabelaNaJanela,
} from '../src/utils/tabelaNaJanelaDomain';

test('tabela termina no rodape da parte visivel (1366x768: sobra o que esta abaixo dos filtros)', () => {
  // area que rola com 680 px, tabela comecando a 220 px do topo, 28 px de respiro embaixo
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 680, topoDaTabela: 220, respiroInferior: 28 }), 680 - 220 - 28 - FOLGA_NO_RODAPE);
});

test('muita coisa em cima: a tabela fica com a altura da janela inteira (a pagina rola ate a tabela encostar no alto)', () => {
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 680, topoDaTabela: 560, respiroInferior: 28 }), 680 - 28 - FOLGA_NO_RODAPE);
  // janela minuscula: nunca menos que a altura minima
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 200, topoDaTabela: 150 }), ALTURA_MINIMA_DA_TABELA);
});

test('nao da para medir (aba escondida ou numero invalido): nao mexe', () => {
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 0, topoDaTabela: 100 }), null);
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: Number.NaN, topoDaTabela: 100 }), null);
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 700, topoDaTabela: Number.NaN }), null);
});

test('topo negativo ou respiro invalido nao aumentam a tabela alem da area', () => {
  assert.equal(alturaDaTabelaNaJanela({ alturaVisivel: 700, topoDaTabela: -50, respiroInferior: Number.NaN }), 700 - FOLGA_NO_RODAPE);
});

test('so no computador: celular (largura < 768) continua com a pagina rolando inteira', () => {
  assert.equal(usaTabelaNaJanela(1366), true);
  assert.equal(usaTabelaNaJanela(768), true);
  assert.equal(usaTabelaNaJanela(767), false);
  assert.equal(usaTabelaNaJanela(Number.NaN), false);
});
