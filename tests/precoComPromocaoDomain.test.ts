import assert from 'node:assert/strict';
import { test } from 'node:test';
import { camposDePrecoDoItem, precoSugeridoDoItem, reprecificarPelaQuantidade, tabelaComPromocao } from '../src/utils/precoComPromocaoDomain';
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

// ---------------------------------------------------------------------------
// ATACADO (22/11/2026, migracao Embala Minas): a faixa da aba "Atacado" do
// produto vale quando a quantidade do item chega nela e o preco e' menor.
// ---------------------------------------------------------------------------
const atacado = (faixas: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({ ativo: true, quantidadeMinima: 0, faixas, ...extra });
const comAtacado = { id: 'p2', precoVenda: 53.8, atacado: atacado([{ quantidadeInicial: 8, quantidadeFinal: null, preco: 49.99, ilimitado: true }]) };

test('atacado: abaixo da faixa vale o preco de venda; na faixa vale o atacado', () => {
  const tabela = tabelaComPromocao(comAtacado, [], HOJE);
  assert.deepEqual(tabela.atacado, [{ aPartirDe: 8, ate: null, preco: 49.99 }]);
  assert.deepEqual(camposDePrecoDoItem(tabela, 'prazo', undefined, 7).preco, 53.8);
  const na = camposDePrecoDoItem(tabela, 'prazo', undefined, 8);
  assert.equal(na.preco, 49.99);
  assert.equal(na.campos.origemPreco, 'atacado');
  // Sem quantidade (campo "Preco" da busca) continua sugerindo o varejo.
  assert.equal(precoSugeridoDoItem(tabela, 'prazo'), 53.8);
});

test('atacado: desligado, faixa sem preco ou o padrao da tela (1-9 / 10-49 / 50+ em branco) nao valem', () => {
  const desligado = { ...comAtacado, atacado: { ...comAtacado.atacado, ativo: false } };
  assert.equal(tabelaComPromocao(desligado, [], HOJE).atacado, undefined);
  const padraoDaTela = { id: 'p3', precoVenda: 10, atacado: atacado([
    { quantidadeInicial: 1, quantidadeFinal: 9, preco: 0 },
    { quantidadeInicial: 10, quantidadeFinal: 49, preco: 0 },
    { quantidadeInicial: 50, quantidadeFinal: null, preco: 0, ilimitado: true },
  ]) };
  const tabela = tabelaComPromocao(padraoDaTela, [], HOJE);
  assert.equal(tabela.atacado, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(tabela, 'atacado'), false, 'sem chave undefined (a tabela vai gravada no item)');
  assert.equal(camposDePrecoDoItem(tabela, 'prazo', undefined, 100).preco, 10);
});

test('atacado: varias faixas -- vale a de maior "a partir de"; quantidade minima sobe o inicio', () => {
  const p = { id: 'p4', precoVenda: 10, atacado: atacado([
    { quantidadeInicial: 10, quantidadeFinal: 49, preco: 9 },
    { quantidadeInicial: 50, quantidadeFinal: null, preco: 8, ilimitado: true },
  ], { quantidadeMinima: 12 }) };
  const tabela = tabelaComPromocao(p, [], HOJE);
  assert.equal(camposDePrecoDoItem(tabela, 'prazo', undefined, 10).preco, 10, 'abaixo da quantidade minima');
  assert.equal(camposDePrecoDoItem(tabela, 'prazo', undefined, 12).preco, 9);
  assert.equal(camposDePrecoDoItem(tabela, 'prazo', undefined, 60).preco, 8);
});

test('atacado: so vale se for mais barato que promocao/a vista; preco digitado continua manual', () => {
  const p = { id: 'p1', precoVenda: 25, precoAVista: 23, atacado: atacado([{ quantidadeInicial: 5, quantidadeFinal: null, preco: 22, ilimitado: true }]) };
  const comPromo = tabelaComPromocao(p, [promocao()], HOJE);
  assert.equal(camposDePrecoDoItem(comPromo, 'prazo', undefined, 10).campos.origemPreco, 'promocao', 'promocao a R$ 20 e mais barata');
  const semPromo = tabelaComPromocao(p, [], HOJE);
  assert.equal(camposDePrecoDoItem(semPromo, 'vista', undefined, 10).preco, 22);
  const digitado = camposDePrecoDoItem(semPromo, 'prazo', 24, 10);
  assert.equal(digitado.preco, 24);
  assert.equal(digitado.campos.origemPreco, 'manual');
});

test('atacado na embalagem: faixa e preco convertidos; embalagem com preco proprio nao entra', () => {
  const p = { id: 'p5', precoVenda: 2, atacado: atacado([{ quantidadeInicial: 100, quantidadeFinal: null, preco: 1.5, ilimitado: true }]) };
  const caixa = tabelaComPromocao(p, [], HOJE, { fatorConversao: 50 });
  assert.deepEqual(caixa.atacado, [{ aPartirDe: 2, ate: null, preco: 75 }]);
  assert.equal(camposDePrecoDoItem(caixa, 'prazo', undefined, 2).preco, 75);
  assert.equal(tabelaComPromocao(p, [], HOJE, { fatorConversao: 50, precoProprio: 90 }).atacado, undefined);
});

test('reprecificarPelaQuantidade: acompanha a quantidade; manual e bonificado ficam', () => {
  const tabela = tabelaComPromocao(comAtacado, [], HOJE);
  assert.equal(reprecificarPelaQuantidade({ tabelaPreco: tabela, origemPreco: 'venda' }, 'prazo', 10)?.preco, 49.99);
  assert.equal(reprecificarPelaQuantidade({ tabelaPreco: tabela, origemPreco: 'atacado' }, 'prazo', 2)?.preco, 53.8);
  assert.equal(reprecificarPelaQuantidade({ tabelaPreco: tabela, origemPreco: 'manual' }, 'prazo', 10), null);
  assert.equal(reprecificarPelaQuantidade({ tabelaPreco: tabela, origemPreco: 'venda', bonificado: true }, 'prazo', 10), null);
});
