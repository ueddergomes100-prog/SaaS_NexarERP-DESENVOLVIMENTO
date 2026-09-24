import assert from 'node:assert/strict';
import { test } from 'node:test';
import { opcoesDeCategoria, separarCategoriasPorSituacao } from '../src/utils/categoriaDomain';

const produtoOuPeca = (tipo: string) => tipo === 'Peça' || tipo === 'Produto' || tipo === '';

const cadastradas = [
  { nome: 'SEMIACABADOS', ativo: true, tipo: 'Produto' },
  { nome: 'OLEOS', tipo: 'Produto' }, // registro antigo, sem o campo ativo
  { nome: 'ANTIPULGAS', ativo: false, tipo: 'Produto' },
  { nome: 'SERVICO DE SOLDA', ativo: true, tipo: 'Serviço' },
  { nome: 'SEM TIPO', ativo: true },
  { nome: '  ', ativo: true, tipo: 'Produto' },
];

test('categoria inativa sai da lista; sem campo "ativo" conta como ativa; tipo errado e nome vazio ficam de fora', () => {
  const { ativas, inativas } = separarCategoriasPorSituacao(cadastradas, produtoOuPeca);
  assert.deepEqual(ativas, ['SEMIACABADOS', 'OLEOS', 'SEM TIPO']);
  assert.deepEqual(inativas, ['ANTIPULGAS']);
});

test('opções do select: só as ativas quando o produto está numa ativa', () => {
  const categorias = separarCategoriasPorSituacao(cadastradas, produtoOuPeca);
  assert.deepEqual(opcoesDeCategoria(categorias, 'OLEOS').map((o) => o.valor), ['SEMIACABADOS', 'OLEOS', 'SEM TIPO']);
  assert.deepEqual(opcoesDeCategoria(categorias, '').map((o) => o.valor), ['SEMIACABADOS', 'OLEOS', 'SEM TIPO']);
});

test('produto já numa categoria inativa continua vendo a dele, marcada, e não cai na primeira da lista', () => {
  const categorias = separarCategoriasPorSituacao(cadastradas, produtoOuPeca);
  const opcoes = opcoesDeCategoria(categorias, 'ANTIPULGAS');
  assert.deepEqual(opcoes[opcoes.length - 1], { valor: 'ANTIPULGAS', rotulo: 'ANTIPULGAS (inativa)' });
  assert.equal(opcoes.length, 4);
});

test('categoria do produto que nem existe no cadastro também não some (sem marca de inativa)', () => {
  const categorias = separarCategoriasPorSituacao(cadastradas, produtoOuPeca);
  const opcoes = opcoesDeCategoria(categorias, 'CATEGORIA ANTIGA');
  assert.deepEqual(opcoes[opcoes.length - 1], { valor: 'CATEGORIA ANTIGA', rotulo: 'CATEGORIA ANTIGA' });
});
