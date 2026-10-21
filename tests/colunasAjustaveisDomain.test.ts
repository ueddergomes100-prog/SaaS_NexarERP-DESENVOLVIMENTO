import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chaveDaColuna,
  colunaAjustavel,
  LARGURA_MAXIMA_COLUNA,
  LARGURA_MINIMA_COLUNA,
  lerLarguraGuardada,
  limitarLargura,
  textoDoCabecalho,
} from '../src/utils/colunasAjustaveisDomain';

test('cabecalho: sem setas de ordenacao e espacos sobrando, em maiusculas', () => {
  assert.equal(textoDoCabecalho('  Nº Pedido ▲ '), 'Nº PEDIDO');
  assert.equal(textoDoCabecalho('Data\n  ▼'), 'DATA');
  assert.equal(textoDoCabecalho(null), '');
});

test('chave: muda com a tela, com a tabela e com a coluna; estavel para a mesma coluna', () => {
  const cab = ['Nº Pedido ▲', 'Data', 'Cliente', 'Ações'];
  const a = chaveDaColuna('Pedidos de Venda', cab, 2);
  assert.equal(a, chaveDaColuna('Pedidos de Venda', ['Nº Pedido ▼', 'DATA', 'cliente', 'Ações'], 2), 'a seta de ordenacao nao muda a chave');
  assert.match(a, /^colunas:[0-9a-z]+:CLIENTE$/);
  assert.notEqual(a, chaveDaColuna('Orçamentos', cab, 2), 'outra tela');
  assert.notEqual(a, chaveDaColuna('Pedidos de Venda', ['Data', 'Cliente', 'Valor'], 1), 'outra tabela da mesma tela');
  assert.notEqual(a, chaveDaColuna('Pedidos de Venda', cab, 1), 'outra coluna');
  assert.match(chaveDaColuna('X', ['', 'B'], 0), /:#0$/, 'coluna sem texto usa a posicao');
});

test('largura: limites e valor guardado invalido', () => {
  assert.equal(limitarLargura(10), LARGURA_MINIMA_COLUNA);
  assert.equal(limitarLargura(5000), LARGURA_MAXIMA_COLUNA);
  assert.equal(limitarLargura(240.6), 241);
  assert.equal(lerLarguraGuardada('300'), 300);
  assert.equal(lerLarguraGuardada(null), null);
  assert.equal(lerLarguraGuardada('abc'), null);
  assert.equal(lerLarguraGuardada('5'), null);
});

test('quem ganha a alca: nao a ultima, nao a caixinha de selecao, nao celula larga', () => {
  const base = { indice: 1, total: 5, colSpan: 1, texto: 'Data', soCaixinha: false };
  assert.equal(colunaAjustavel(base), true);
  assert.equal(colunaAjustavel({ ...base, indice: 4 }), false, 'ultima (Acoes)');
  assert.equal(colunaAjustavel({ ...base, soCaixinha: true }), false);
  assert.equal(colunaAjustavel({ ...base, colSpan: 2 }), false);
  assert.equal(colunaAjustavel({ ...base, indice: 0, total: 1 }), false, 'tabela de uma coluna so');
});
