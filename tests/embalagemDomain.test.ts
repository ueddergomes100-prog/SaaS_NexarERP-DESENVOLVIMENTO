import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpcoesUnidadeVenda,
  findOpcaoUnidadeVenda,
  formatFatorConversao,
  normalizeEmbalagens,
  toBaseQuantity,
  toStockAdjustmentItems,
} from '../src/utils/embalagemDomain';

const produtoKg = {
  precoVenda: 10,
  unidadeMedidaSigla: 'KG',
  unidadeMedidaCasasDecimais: 3,
  unidadeMedidaFracionado: true,
  embalagens: [
    {
      id: 'emb-saco',
      unidadeMedidaId: 'un',
      unidadeMedidaSigla: 'SC',
      unidadeMedidaCasasDecimais: 0,
      unidadeMedidaFracionado: false,
      descricao: 'Saco de 20kg',
      fatorConversao: 20,
      precoVenda: 195.5,
      codigoBarras: '789000000001',
      ativo: true,
    },
  ],
};

test('produto sem embalagem devolve so a unidade base', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    precoVenda: 10,
    unidadeMedidaSigla: 'KG',
    unidadeMedidaCasasDecimais: 3,
    unidadeMedidaFracionado: true,
  });

  assert.equal(opcoes.length, 1);
  assert.equal(opcoes[0].embalagemId, '');
  assert.equal(opcoes[0].label, 'KG');
  assert.equal(opcoes[0].fatorConversao, 1);
  assert.equal(opcoes[0].precoVenda, 10);
});

test('embalagem entra depois da base, com rotulo e preco proprio', () => {
  const opcoes = buildOpcoesUnidadeVenda(produtoKg);

  assert.equal(opcoes.length, 2);
  assert.equal(opcoes[1].label, 'SC(20,000)');
  assert.equal(opcoes[1].precoVenda, 195.5);
  assert.equal(opcoes[1].fatorConversao, 20);
  // O saco herda as casas decimais da PROPRIA unidade, nao as do produto base:
  // um produto fracionavel em KG nao torna o saco fracionavel.
  assert.equal(opcoes[1].permiteFracionado, false);
  assert.equal(opcoes[1].casasDecimais, 0);
});

test('embalagem sem preco proprio deriva do preco base x fator', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    ...produtoKg,
    embalagens: [{ ...produtoKg.embalagens[0], precoVenda: 0 }],
  });

  assert.equal(opcoes[1].precoVenda, 200);
});

test('embalagem inativa fica fora do seletor', () => {
  const opcoes = buildOpcoesUnidadeVenda({
    ...produtoKg,
    embalagens: [{ ...produtoKg.embalagens[0], ativo: false }],
  });

  assert.equal(opcoes.length, 1);
});

test('normalizeEmbalagens descarta entrada sem id ou com fator invalido', () => {
  const embalagens = normalizeEmbalagens([
    { ...produtoKg.embalagens[0], id: '' },
    { ...produtoKg.embalagens[0], id: 'sem-fator', fatorConversao: 0 },
    { ...produtoKg.embalagens[0], id: 'fator-negativo', fatorConversao: -5 },
    produtoKg.embalagens[0],
    'lixo',
    null,
  ]);

  assert.equal(embalagens.length, 1);
  assert.equal(embalagens[0].id, 'emb-saco');
});

test('normalizeEmbalagens trata campo ausente ou nao-array como lista vazia', () => {
  assert.deepEqual(normalizeEmbalagens(undefined), []);
  assert.deepEqual(normalizeEmbalagens(null), []);
  assert.deepEqual(normalizeEmbalagens({ id: 'x' }), []);
});

test('embalagem sem o campo ativo e considerada ativa', () => {
  const embalagens = normalizeEmbalagens([
    { id: 'emb-1', fatorConversao: 5 },
  ]);

  assert.equal(embalagens[0].ativo, true);
  assert.equal(embalagens[0].unidadeMedidaSigla, 'UN');
});

test('findOpcaoUnidadeVenda cai na base quando o id nao existe mais', () => {
  const opcoes = buildOpcoesUnidadeVenda(produtoKg);

  assert.equal(findOpcaoUnidadeVenda(opcoes, 'emb-saco').embalagemId, 'emb-saco');
  assert.equal(findOpcaoUnidadeVenda(opcoes, 'emb-apagada').embalagemId, '');
  assert.equal(findOpcaoUnidadeVenda(opcoes, '').embalagemId, '');
  assert.equal(findOpcaoUnidadeVenda(opcoes, undefined).embalagemId, '');
});

test('toBaseQuantity converte pela embalagem', () => {
  assert.equal(toBaseQuantity(1, 20), 20);
  assert.equal(toBaseQuantity(2.5, 20), 50);
});

test('toBaseQuantity sem fator preserva a quantidade (retrocompatibilidade)', () => {
  assert.equal(toBaseQuantity(1.5), 1.5);
  assert.equal(toBaseQuantity(1.5, undefined), 1.5);
  assert.equal(toBaseQuantity(1.5, 0), 1.5);
});

test('toBaseQuantity absorve erro de ponto flutuante', () => {
  // 0.1 * 3 = 0.30000000000000004 em ponto flutuante puro.
  assert.equal(toBaseQuantity(0.1, 3), 0.3);
});

test('toStockAdjustmentItems converte cada item e preserva id/nome', () => {
  const ajustes = toStockAdjustmentItems([
    { id: 'p1', nome: 'RACAO', quantidade: 1, fatorConversao: 20 },
    { id: 'p2', nome: 'MILHO', quantidade: 1.5 },
  ]);

  assert.deepEqual(ajustes, [
    { id: 'p1', nome: 'RACAO', quantidade: 20 },
    { id: 'p2', nome: 'MILHO', quantidade: 1.5 },
  ]);
});

test('formatFatorConversao usa 3 casas com virgula, igual ao seletor', () => {
  assert.equal(formatFatorConversao(20), '20,000');
  assert.equal(formatFatorConversao(0.5), '0,500');
});
