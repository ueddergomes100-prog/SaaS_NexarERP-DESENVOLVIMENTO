import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findEmbalagemIdByExactCode,
  productMatchesExactCode,
  productMatchesSearch,
  searchProducts,
  type SearchableProduct,
} from '../src/utils/productSearch';

interface FakeProduct extends SearchableProduct {
  id: string;
}

const product = (overrides: Partial<FakeProduct>): FakeProduct => ({
  id: overrides.id || 'p1',
  nome: '',
  codigo: '',
  codigoBarras: '',
  referencia: '',
  skuSistema: '',
  marca: '',
  categoria: '',
  fornecedor: '',
  ...overrides,
});

test('codigo exato vence nome: retorna somente o produto com codigo identico', () => {
  const products = [
    product({ id: 'a', nome: 'Parafuso ABA 10mm', codigo: '999' }),
    product({ id: 'b', nome: 'Suporte generico', codigo: 'ABA' }),
    product({ id: 'c', nome: 'Outro item com ABA no nome', codigo: '111' }),
  ];

  const result = searchProducts(products, 'ABA');

  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'b');
});

test('modo exata usa startsWith no nome e nao retorna match no meio da palavra', () => {
  const bateComeco = product({ id: 'a', nome: 'Amortecedor dianteiro' });
  const bateNoMeio = product({ id: 'b', nome: 'Kit amortecedor traseiro' });

  assert.equal(productMatchesSearch(bateComeco, 'amort', 'exata'), true);
  assert.equal(productMatchesSearch(bateNoMeio, 'amort', 'exata'), false);
});

test('modo completa retorna ocorrencia em qualquer posicao do nome', () => {
  const bateNoMeio = product({ id: 'b', nome: 'Kit amortecedor traseiro' });

  assert.equal(productMatchesSearch(bateNoMeio, 'amort', 'completa'), true);
});

test('total reflete a quantidade de matches antes do corte pelo limite', () => {
  const products = Array.from({ length: 9 }, (_, index) => (
    product({ id: `p${index}`, nome: `Produto teste ${index}` })
  ));

  const result = searchProducts(products, 'teste', { limit: 6 });

  assert.equal(result.total, 9);
  assert.equal(result.items.length, 6);
  assert.equal(result.truncated, true);
});

test('limite e respeitado e truncated fica falso quando os resultados cabem', () => {
  const products = Array.from({ length: 3 }, (_, index) => (
    product({ id: `p${index}`, nome: `Produto teste ${index}` })
  ));

  const result = searchProducts(products, 'teste', { limit: 6 });

  assert.equal(result.items.length, 3);
  assert.equal(result.truncated, false);
});

test('acento no termo de busca nao impede o match', () => {
  const comAcento = product({ id: 'a', nome: 'Válvula de admissão' });

  assert.equal(productMatchesSearch(comAcento, 'valvula admissao', 'completa'), false);
  assert.equal(productMatchesSearch(comAcento, 'valvula', 'completa'), true);
  assert.equal(productMatchesSearch(comAcento, 'admissao', 'completa'), true);
});

test('acento no cadastro nao impede o match de um termo de busca sem acento', () => {
  const semAcentoNoTermo = product({ id: 'a', nome: 'Óleo Lubrificante' });

  assert.equal(productMatchesSearch(semAcentoNoTermo, 'oleo', 'exata'), true);
});

test('codigo de barras casa por prefixo mesmo no modo exata', () => {
  const item = product({ id: 'a', codigoBarras: '7891234567890' });

  assert.equal(productMatchesSearch(item, '789123', 'exata'), true);
});

test('productMatchesExactCode nao aceita prefixo, so igualdade exata', () => {
  const item = product({ id: 'a', codigo: 'ABC123' });

  assert.equal(productMatchesExactCode(item, 'ABC12'), false);
  assert.equal(productMatchesExactCode(item, 'abc123'), true);
});

test('termo vazio nao retorna nenhum produto', () => {
  const products = [product({ id: 'a', nome: 'Qualquer coisa' })];

  const result = searchProducts(products, '   ');

  assert.equal(result.total, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.truncated, false);
});

test('busca por marca, categoria e fornecedor funciona no modo completa', () => {
  const item = product({
    id: 'a',
    nome: 'Item generico',
    marca: 'Bosch',
    categoria: 'Eletrica',
    fornecedor: 'Distribuidora Sul',
  });

  assert.equal(productMatchesSearch(item, 'bosch', 'completa'), true);
  assert.equal(productMatchesSearch(item, 'eletrica', 'completa'), true);
  assert.equal(productMatchesSearch(item, 'distribuidora', 'completa'), true);
});

const produtoComEmbalagem = (overrides: Partial<FakeProduct> = {}): FakeProduct => product({
  id: 'racao',
  nome: 'RACAO GATOS',
  codigo: '7375',
  codigoBarras: '7890000000001',
  embalagens: [{
    id: 'emb-saco',
    unidadeMedidaSigla: 'SC',
    fatorConversao: 20,
    precoVenda: 195.5,
    codigoBarras: '7890000000018',
    ativo: true,
  }],
  ...overrides,
});

test('EAN da embalagem encontra o produto (bipar o saco)', () => {
  const result = searchProducts([produtoComEmbalagem()], '7890000000018');

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'racao');
});

test('findEmbalagemIdByExactCode devolve a embalagem bipada', () => {
  assert.equal(findEmbalagemIdByExactCode(produtoComEmbalagem(), '7890000000018'), 'emb-saco');
});

test('EAN da unidade base nao devolve embalagem nenhuma', () => {
  assert.equal(findEmbalagemIdByExactCode(produtoComEmbalagem(), '7890000000001'), null);
});

test('embalagem inativa nao e encontrada pelo EAN dela', () => {
  const inativa = produtoComEmbalagem({
    embalagens: [{
      id: 'emb-saco',
      unidadeMedidaSigla: 'SC',
      fatorConversao: 20,
      codigoBarras: '7890000000018',
      ativo: false,
    }],
  });

  assert.equal(findEmbalagemIdByExactCode(inativa, '7890000000018'), null);
  assert.equal(productMatchesExactCode(inativa, '7890000000018'), false);
});

test('so casa EAN de embalagem exato, nunca por prefixo', () => {
  assert.equal(findEmbalagemIdByExactCode(produtoComEmbalagem(), '789000000001'), null);
});

test('produto sem embalagem nao muda de comportamento', () => {
  const semEmbalagem = product({ id: 'x', nome: 'ITEM', codigo: '55', codigoBarras: '111' });

  assert.equal(findEmbalagemIdByExactCode(semEmbalagem, '111'), null);
  assert.equal(productMatchesExactCode(semEmbalagem, '111'), true);
  assert.equal(productMatchesExactCode(semEmbalagem, '999'), false);
});
