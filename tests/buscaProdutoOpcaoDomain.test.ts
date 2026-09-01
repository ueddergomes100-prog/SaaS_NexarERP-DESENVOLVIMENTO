import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  destacarTrechosDaBusca,
  ESTOQUE_BAIXO_ATE,
  nivelDeEstoque,
} from '../src/utils/buscaProdutoOpcaoDomain';

const juntar = (trechos: { texto: string }[]) => trechos.map((t) => t.texto).join('');
const destacados = (trechos: { texto: string; destaque: boolean }[]) =>
  trechos.filter((t) => t.destaque).map((t) => t.texto);

test('tres estados de estoque, nao dois', () => {
  assert.equal(nivelDeEstoque(0), 'zerado');
  assert.equal(nivelDeEstoque(1), 'baixo');
  assert.equal(nivelDeEstoque(ESTOQUE_BAIXO_ATE - 1), 'baixo');
  assert.equal(nivelDeEstoque(ESTOQUE_BAIXO_ATE), 'ok');
  assert.equal(nivelDeEstoque(100), 'ok');
});

test('quantidade invalida conta como zerada, nunca como verde', () => {
  // Produto sem estoque confiavel nao pode aparecer verde pra quem vende.
  assert.equal(nivelDeEstoque(undefined), 'zerado');
  assert.equal(nivelDeEstoque(null), 'zerado');
  assert.equal(nivelDeEstoque('abc'), 'zerado');
  assert.equal(nivelDeEstoque(-3), 'zerado');
});

test('o limite de estoque baixo e o mesmo que a tela de Estoque ja usava', () => {
  assert.equal(ESTOQUE_BAIXO_ATE, 5);
});

// --- Destaque do trecho buscado -------------------------------------------

test('marca o pedaco que casou, sem perder nenhuma letra do nome', () => {
  const nome = 'RAÇÃO QUATREE GOURMET 20KG';
  const trechos = destacarTrechosDaBusca(nome, 'quatree');

  assert.equal(juntar(trechos), nome);
  assert.deepEqual(destacados(trechos), ['QUATREE']);
});

test('acento nao atrapalha: digitou sem, marca o com', () => {
  const trechos = destacarTrechosDaBusca('RAÇÃO QUATREE', 'racao');
  assert.deepEqual(destacados(trechos), ['RAÇÃO']);
  assert.equal(juntar(trechos), 'RAÇÃO QUATREE');
});

test('busca com "+" marca os dois termos', () => {
  const nome = 'RAÇÃO QUATREE GOURMET 20KG';
  const trechos = destacarTrechosDaBusca(nome, 'racao+20kg');

  assert.deepEqual(destacados(trechos), ['RAÇÃO', '20KG']);
  assert.equal(juntar(trechos), nome);
});

test('termos que se sobrepoem nao duplicam o destaque', () => {
  const trechos = destacarTrechosDaBusca('RACAO PREMIUM', 'rac+racao');
  assert.deepEqual(destacados(trechos), ['RACAO']);
});

test('o mesmo termo em dois lugares marca os dois', () => {
  const trechos = destacarTrechosDaBusca('CABO ENXADA CABO CURTO', 'cabo');
  assert.deepEqual(destacados(trechos), ['CABO', 'CABO']);
});

test('sem busca, o nome sai inteiro e sem destaque', () => {
  const trechos = destacarTrechosDaBusca('FENO PACOTE', '');
  assert.deepEqual(trechos, [{ texto: 'FENO PACOTE', destaque: false }]);
  assert.deepEqual(destacarTrechosDaBusca('FENO PACOTE', '   '), [{ texto: 'FENO PACOTE', destaque: false }]);
});

test('nome vazio nao quebra', () => {
  assert.deepEqual(destacarTrechosDaBusca('', 'racao'), []);
  assert.deepEqual(destacarTrechosDaBusca(null, 'racao'), []);
});

test('termo que nao aparece no nome nao marca nada', () => {
  const trechos = destacarTrechosDaBusca('FENO PACOTE', 'racao');
  assert.deepEqual(destacados(trechos), []);
  assert.equal(juntar(trechos), 'FENO PACOTE');
});
