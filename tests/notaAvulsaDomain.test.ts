import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularValorTotalNotaAvulsa,
  itemNotaAvulsaValido,
  quantidadeEstoqueNotaAvulsaItem,
  ratearValorPorPesos,
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

test('ratearValorPorPesos divide proporcional ao peso, soma sempre exata ao total', () => {
  const partes = ratearValorPorPesos(1400, [12000, 6000, 2000]);
  assert.equal(partes.reduce((soma, valor) => soma + valor, 0), 1400);
  // pesos na proporcao 6:3:1 -- confirma que o maior peso leva a maior parte
  assert.ok(partes[0] > partes[1]);
  assert.ok(partes[1] > partes[2]);
});

test('ratearValorPorPesos nao perde nem sobra centavo em divisao que nao fecha exata', () => {
  const partes = ratearValorPorPesos(10, [1, 1, 1]); // 10/3 = 3,333... por parte
  const totalCentavos = Math.round(partes.reduce((soma, valor) => soma + valor, 0) * 100);
  assert.equal(totalCentavos, 1000);
  // cada parte fica em 3,33 ou 3,34 -- nunca mais que 1 centavo de diferenca entre elas
  const centavos = partes.map((valor) => Math.round(valor * 100));
  assert.ok(Math.max(...centavos) - Math.min(...centavos) <= 1);
});

test('ratearValorPorPesos com peso zero misturado nao gera NaN nem quebra a soma', () => {
  const partes = ratearValorPorPesos(100, [50, 0, 50]);
  assert.deepEqual(partes, [50, 0, 50]);
});

test('ratearValorPorPesos com soma de pesos zero ou lista vazia devolve tudo zero', () => {
  assert.deepEqual(ratearValorPorPesos(100, [0, 0]), [0, 0]);
  assert.deepEqual(ratearValorPorPesos(100, []), []);
});

test('ratearValorPorPesos com valor zero pra ratear devolve tudo zero, mesmo com pesos validos', () => {
  assert.deepEqual(ratearValorPorPesos(0, [10, 20, 30]), [0, 0, 0]);
});
