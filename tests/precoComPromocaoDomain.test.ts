import assert from 'node:assert/strict';
import { test } from 'node:test';
import { camposDePrecoDoItem, precoSugeridoDoItem, tabelaComPromocao } from '../src/utils/precoComPromocaoDomain';
import type { PromocaoComId } from '../src/utils/promocaoDomain';

const HOJE = '2026-10-06';

const promocao = (extra: Partial<PromocaoComId> = {}): PromocaoComId => ({
  id: 'promo1',
  nome: 'SEMANA DO PET',
  inativa: false,
  dataInicio: '2026-10-01',
  dataFim: '2026-10-31',
  continua: false,
  diasSemana: [0, 1, 2, 3, 4, 5, 6],
  formas: 'todas',
  limitePorVenda: null,
  itens: [{ produtoId: 'p1', tipo: 'valor', valor: 20, quota: null }],
  ...extra,
} as PromocaoComId);

const produto = { id: 'p1', precoVenda: 25, precoAVista: 23 };

test('sem promocao: tabela so\' com venda e a vista; a prazo sugere venda, a vista sugere a vista', () => {
  const tabela = tabelaComPromocao(produto, [], HOJE);
  assert.equal(tabela.venda, 25);
  assert.equal(tabela.vista, 23);
  assert.equal(tabela.promocao, null);
  assert.equal(precoSugeridoDoItem(tabela, 'prazo'), 25);
  assert.equal(precoSugeridoDoItem(tabela, 'vista'), 23);
});

test('promocao "todas as formas" entra na tabela e vale a prazo e a vista', () => {
  const tabela = tabelaComPromocao(produto, [promocao()], HOJE);
  assert.deepEqual(tabela.promocao, { id: 'promo1', nome: 'SEMANA DO PET', preco: 20, soAVista: false });
  assert.equal(precoSugeridoDoItem(tabela, 'prazo'), 20);
  const { preco, campos } = camposDePrecoDoItem(tabela, 'prazo');
  assert.equal(preco, 20);
  assert.equal(campos.origemPreco, 'promocao');
  assert.equal(campos.promocaoId, 'promo1');
  assert.equal(campos.promocaoNome, 'SEMANA DO PET');
});

test('promocao "so a vista" nao vale a prazo (sem promocaoId gravado) e vale a vista', () => {
  const tabela = tabelaComPromocao(produto, [promocao({ formas: 'vista' })], HOJE);
  assert.equal(tabela.promocao?.soAVista, true);
  const prazo = camposDePrecoDoItem(tabela, 'prazo');
  assert.equal(prazo.preco, 25);
  assert.equal(prazo.campos.origemPreco, 'venda');
  assert.equal('promocaoId' in prazo.campos, false);
  const vista = camposDePrecoDoItem(tabela, 'vista');
  assert.equal(vista.preco, 20);
  assert.equal(vista.campos.origemPreco, 'promocao');
});

test('fora do periodo nao ha promocao', () => {
  const tabela = tabelaComPromocao(produto, [promocao({ dataFim: '2026-10-05' })], HOJE);
  assert.equal(tabela.promocao, null);
});

test('embalagem: promocao do kg multiplica pelo fator; saco com preco proprio fica fora da promocao', () => {
  const porSaco = tabelaComPromocao(produto, [promocao()], HOJE, { fatorConversao: 20 });
  assert.equal(porSaco.venda, 500);
  assert.equal(porSaco.promocao?.preco, 400);
  const precoProprio = tabelaComPromocao(produto, [promocao()], HOJE, { fatorConversao: 20, precoProprio: 450 });
  assert.equal(precoProprio.venda, 450);
  assert.equal(precoProprio.promocao, null);
});

test('preco digitado diferente do automatico vira manual e nao leva promocao', () => {
  const tabela = tabelaComPromocao(produto, [promocao()], HOJE);
  const r = camposDePrecoDoItem(tabela, 'prazo', 22);
  assert.equal(r.preco, 22);
  assert.equal(r.campos.origemPreco, 'manual');
  assert.equal('promocaoId' in r.campos, false);
  const igual = camposDePrecoDoItem(tabela, 'prazo', 20);
  assert.equal(igual.campos.origemPreco, 'promocao');
});
