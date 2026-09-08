import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularValorTotalNotaAvulsa,
  itemNotaAvulsaValido,
  quantidadeEstoqueNotaAvulsaItem,
  type NotaAvulsaItem,
} from '../src/utils/notaAvulsaDomain';

test('item sem embalagem usa a propria quantidade como estoque', () => {
  const item: NotaAvulsaItem = { produtoId: 'p1', produtoNome: 'ARROZ', quantidade: 10, precoCusto: 5, precoVenda: 8 };
  assert.equal(quantidadeEstoqueNotaAvulsaItem(item), 10);
});

test('item comprado em embalagem soma a quantidadeBase, nao a quantidade digitada', () => {
  const item: NotaAvulsaItem = {
    produtoId: 'p1', produtoNome: 'ARROZ', quantidade: 5, precoCusto: 90, precoVenda: 0,
    embalagemId: 'emb-saco', unidadeSigla: 'SC', fatorConversao: 20, quantidadeBase: 100,
  };
  assert.equal(quantidadeEstoqueNotaAvulsaItem(item), 100);
});

test('itemNotaAvulsaValido e calcularValorTotalNotaAvulsa ignoram a embalagem -- o dinheiro e sempre quantidade x custo, sem converter', () => {
  const itens: NotaAvulsaItem[] = [
    { produtoId: 'p1', produtoNome: 'ARROZ', quantidade: 5, precoCusto: 90, precoVenda: 0, embalagemId: 'emb-saco', unidadeSigla: 'SC', fatorConversao: 20, quantidadeBase: 100 },
    { produtoId: 'p2', produtoNome: 'FEIJAO', quantidade: 10, precoCusto: 4, precoVenda: 7 },
  ];
  assert.ok(itens.every(itemNotaAvulsaValido));
  assert.equal(calcularValorTotalNotaAvulsa(itens), 5 * 90 + 10 * 4);
});
