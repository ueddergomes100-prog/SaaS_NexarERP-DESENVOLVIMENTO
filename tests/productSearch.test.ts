import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findEmbalagemIdByExactCode,
  isListarTudoTerm,
  ordenarProdutosDaBusca,
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

test('principal de uma grade (temGrade) fica fora da busca de venda, como o inativo', () => {
  const products = [
    product({ id: 'pai', nome: 'Camiseta basica', codigo: '123', temGrade: true }),
    product({ id: 'filho', nome: 'Camiseta basica P azul', codigo: '123.01' }),
  ];
  assert.equal(productMatchesSearch(products[0], 'camiseta'), false);
  assert.equal(productMatchesSearch(products[1], 'camiseta'), true);
  assert.deepEqual(searchProducts(products, '123').items.map((p) => p.id), ['filho']);
  assert.deepEqual(searchProducts(products, '#').items.map((p) => p.id), ['filho']);
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

// --- Curinga "#" (listar catalogo inteiro) ---------------------------------

const catalogo = [
  product({ id: 'a', nome: 'CAFE VERDE', codigo: '1' }),
  product({ id: 'b', nome: 'ACUCAR', codigo: '2' }),
  product({ id: 'c', nome: 'FILTRO DE OLEO', codigo: '3' }),
];

test('# devolve o catalogo inteiro em vez de filtrar', () => {
  const resultado = searchProducts(catalogo, '#', { limit: 10 });

  assert.equal(resultado.total, 3);
  assert.equal(resultado.truncated, false);
  // Em ordem alfabetica: ACUCAR, CAFE VERDE, FILTRO DE OLEO.
  assert.deepEqual(resultado.items.map((item) => item.id), ['b', 'a', 'c']);
});

test('# respeita o limite mas informa o total real, pro "Ver mais" aparecer', () => {
  const resultado = searchProducts(catalogo, '#', { limit: 2 });

  assert.equal(resultado.items.length, 2);
  assert.equal(resultado.total, 3);
  assert.equal(resultado.truncated, true);
});

test('# com espaco em volta continua valendo (usuario digitando)', () => {
  assert.equal(searchProducts(catalogo, '  #  ', { limit: 10 }).total, 3);
});

test('# no meio ou no fim nao vira curinga; "#termo" filtra a lista do # pelo termo (2026-09-30)', () => {
  // "cafe#" e' busca de texto comum: nao lista tudo, e nao acha nada.
  assert.equal(searchProducts(catalogo, 'cafe#', { limit: 10 }).total, 0);
  // "#cafe" = o mesmo que buscar "cafe" (pedido do dono: # e depois o nome).
  const comCuringa = searchProducts(catalogo, '#cafe', { limit: 10 });
  const semCuringa = searchProducts(catalogo, 'cafe', { limit: 10 });
  assert.ok(semCuringa.total > 0);
  assert.equal(comCuringa.total, semCuringa.total);
  assert.deepEqual(comCuringa.items.map((p) => p.id), semCuringa.items.map((p) => p.id));
});

test('# em catalogo vazio nao quebra', () => {
  const resultado = searchProducts([], '#', { limit: 10 });

  assert.equal(resultado.total, 0);
  assert.equal(resultado.items.length, 0);
  assert.equal(resultado.truncated, false);
});

test('termo vazio continua nao listando nada (comportamento antigo preservado)', () => {
  assert.equal(searchProducts(catalogo, '', { limit: 10 }).total, 0);
  assert.equal(searchProducts(catalogo, '   ', { limit: 10 }).total, 0);
});

test('isListarTudoTerm reconhece so o termo exato', () => {
  assert.equal(isListarTudoTerm('#'), true);
  assert.equal(isListarTudoTerm(' # '), true);
  assert.equal(isListarTudoTerm('#1'), false);
  assert.equal(isListarTudoTerm(''), false);
  assert.equal(isListarTudoTerm(undefined), false);
});

// --- Busca com "+" nos produtos -------------------------------------------

const catalogoRacao = [
  product({ id: 'a', nome: 'Ração Quatree Gourmet Cães Adultos 20KG', codigo: '101' }),
  product({ id: 'b', nome: 'Ração Quatree Gourmet Cães Adultos 10,1KG', codigo: '102' }),
  product({ id: 'c', nome: 'Ração Golden Life Gatos 20KG', codigo: '103' }),
  product({ id: 'd', nome: 'Areia Sanitária Gatos 4KG', codigo: '104' }),
];

test('"+" exige todas as palavras e devolve so quem tem as tres', () => {
  const result = searchProducts(catalogoRacao, 'Ração+Quatree+20KG', { limit: 10 });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'a');
});

test('"+" nao depende da ordem nem do acento digitado', () => {
  const semAcento = searchProducts(catalogoRacao, 'racao+quatree+20kg', { limit: 10 });
  assert.equal(semAcento.total, 1);
  assert.equal(semAcento.items[0].id, 'a');

  const foraDeOrdem = searchProducts(catalogoRacao, '20KG+gourmet+racao', { limit: 10 });
  assert.equal(foraDeOrdem.total, 1);
  assert.equal(foraDeOrdem.items[0].id, 'a');
});

test('"+" com dois termos lista todos que batem nos dois', () => {
  const result = searchProducts(catalogoRacao, 'quatree+gourmet', { limit: 10 });

  assert.equal(result.total, 2);
  // Ordem alfabetica: "...10,1KG" vem antes de "...20KG".
  assert.deepEqual(result.items.map((item) => item.id), ['b', 'a']);
});

test('busca de uma palavra so continua funcionando como antes', () => {
  const result = searchProducts(catalogoRacao, 'gatos', { limit: 10 });

  assert.equal(result.total, 2);
  // Ordem alfabetica: "Areia..." antes de "Racao...".
  assert.deepEqual(result.items.map((item) => item.id), ['d', 'c']);
});

test('modo exata: "+" casa por conter, senao palavra do meio nunca acharia', () => {
  // No modo 'exata' um termo unico casa por prefixo -- "20KG" sozinho nao acha
  // nada, e e' assim que a empresa configurou. Com "+", cada pedaco casa por
  // conter: quem digita "+" esta pedindo justamente o meio e o fim do nome.
  const umTermo = searchProducts(catalogoRacao, '20KG', { mode: 'exata', limit: 10 });
  assert.equal(umTermo.total, 0);

  const comMais = searchProducts(catalogoRacao, 'racao+20kg', { mode: 'exata', limit: 10 });
  assert.equal(comMais.total, 2);
  assert.deepEqual(comMais.items.map((item) => item.id), ['c', 'a']);
});

test('"+" tambem casa termo em campo diferente (nome + marca)', () => {
  const produtos = [
    product({ id: 'x', nome: 'Ração Cães Adultos', marca: 'Quatree' }),
    product({ id: 'y', nome: 'Ração Cães Filhotes', marca: 'Outra' }),
  ];

  const result = searchProducts(produtos, 'racao+quatree', { limit: 10 });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'x');
});

test('leitor de codigo de barras nao e afetado: EAN inteiro continua exato', () => {
  const produtos = [
    product({ id: 'ean', nome: 'Ração Quatree 20KG', codigoBarras: '7891234567890' }),
    product({ id: 'outro', nome: 'Ração Quatree 10KG', codigoBarras: '7899999999999' }),
  ];

  const result = searchProducts(produtos, '7891234567890', { limit: 10 });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, 'ean');
});

test('productMatchesSearch com "+" derruba quem tem so parte das palavras', () => {
  const produto = product({ nome: 'Ração Quatree Gourmet 20KG' });

  assert.equal(productMatchesSearch(produto, 'racao+gourmet'), true);
  assert.equal(productMatchesSearch(produto, 'racao+premium'), false);
});

// --- Ordem da lista (21/11/2026) --------------------------------------------

const catalogoFerragem = [
  product({ id: 'p4', nome: 'PARAFUSO CAB.CHATA MADEIRA 4,2 X 55', codigo: '1533' }),
  product({ id: 'v1', nome: 'VALVULA P/POCO ROSC. 1"', codigo: '2868' }),
  product({ id: 'p2', nome: 'parafuso auto brocante 5,5 x 1', codigo: '1507' }),
  product({ id: 'o2', nome: 'OLEO 1L', codigo: '20' }),
  product({ id: 'p1', nome: 'PARAFUSO AUTO ATARRAX. CAB.PANEL. 6,3 X 45', codigo: '1502' }),
  product({ id: 'o1', nome: 'ÓLEO 1L', codigo: '3' }),
  product({ id: 'c1', nome: 'CAMARA DE AR 3,25 X 8', codigo: '150' }),
  product({ id: 'c2', nome: 'COLHER PEDREIRO 8"', codigo: '15' }),
];

test('lista sai em ordem alfabetica pelo nome: acento e maiuscula nao contam, nome igual sai pelo codigo como numero', () => {
  const tudo = searchProducts(catalogoFerragem, '#', { limit: 50 });
  assert.deepEqual(tudo.items.map((p) => p.id), ['c1', 'c2', 'o1', 'o2', 'p1', 'p2', 'p4', 'v1']);

  const parafusos = searchProducts(catalogoFerragem, 'paraf', { limit: 50 });
  assert.deepEqual(parafusos.items.map((p) => p.id), ['p1', 'p2', 'p4']);
  assert.deepEqual(searchProducts(catalogoFerragem, '#paraf', { limit: 50 }).items.map((p) => p.id), ['p1', 'p2', 'p4']);
});

test('o corte do limite vem depois da ordem: os primeiros da lista sao os primeiros do alfabeto', () => {
  const dois = searchProducts(catalogoFerragem, '#', { limit: 2 });
  assert.deepEqual(dois.items.map((p) => p.id), ['c1', 'c2']);
  assert.equal(dois.total, 8);
  assert.equal(dois.truncated, true);
});

test('quem digita so numero procura pelo codigo: codigos que comecam com ele vem primeiro, do menor para o maior', () => {
  // "15" e' o codigo EXATO da colher: o leitor/atalho de codigo exato continua valendo e so' ela volta.
  assert.deepEqual(searchProducts(catalogoFerragem, '15', { limit: 50 }).items.map((p) => p.id), ['c2']);
  // "150" exato tambem. "153" nao e' codigo de ninguem: lista quem comeca com 153.
  assert.deepEqual(searchProducts(catalogoFerragem, '153', { limit: 50 }).items.map((p) => p.id), ['p4']);
  // Prefixo de varios codigos, do menor para o maior, sem olhar o nome.
  assert.deepEqual(ordenarProdutosDaBusca(catalogoFerragem, '15').map((p) => p.id).slice(0, 5), ['c2', 'c1', 'p1', 'p2', 'p4']);
  // O que nao comeca com o numero segue pelo nome.
  assert.deepEqual(ordenarProdutosDaBusca(catalogoFerragem, '15').map((p) => p.id).slice(5), ['o1', 'o2', 'v1']);
});

test('ordenar nao mexe na lista recebida', () => {
  const antes = catalogoFerragem.map((p) => p.id);
  ordenarProdutosDaBusca(catalogoFerragem, 'paraf');
  assert.deepEqual(catalogoFerragem.map((p) => p.id), antes);
});
