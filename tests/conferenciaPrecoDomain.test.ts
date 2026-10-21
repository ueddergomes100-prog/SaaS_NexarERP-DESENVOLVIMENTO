import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conferirPrecos, explicacaoDaDiferenca, type ItemParaPreco } from '../src/utils/conferenciaPrecoDomain';
import { lerPromocao, type PromocaoComId } from '../src/utils/promocaoDomain';

const HOJE = '2026-10-21';
const racao = { precoVenda: 10, precoAVista: 9 };
const item = (campos: Partial<ItemParaPreco> = {}): ItemParaPreco => ({ id: 'racao', nome: 'RACAO', precoUnitario: 10, quantidade: 2, desconto: 0, ...campos });
const promocao = (campos: Record<string, unknown> = {}): PromocaoComId => ({
  ...lerPromocao({ nome: 'SEMANA', dataInicio: '2026-10-01', continua: true, itens: [{ produtoId: 'racao', tipo: 'valor', valor: 8 }], ...campos }),
  id: 'p1',
});
const conferir = (itens: ItemParaPreco[], extra: Partial<Parameters<typeof conferirPrecos>[0]> = {}) => conferirPrecos({
  itens, produtos: { racao }, promocoes: [], hoje: HOJE, condicao: 'prazo', ...extra,
});

test('preco do sistema ou acima: nada muda', () => {
  const r = conferir([item(), item({ precoUnitario: 12 })]);
  assert.equal(r.diferencaTotalCentavos, 0);
  assert.deepEqual(r.itens[0], { precoSistema: 10, brutoCentavos: 2000, descontoCentavos: 0, diferencaCentavos: 0 });
  assert.equal(r.itens[1].brutoCentavos, 2400);
});

test('preco abaixo do sistema vira desconto do item (soma ao desconto que ja tinha)', () => {
  const r = conferir([item({ precoUnitario: 8, desconto: 1 })]);
  assert.deepEqual(r.itens[0], { precoSistema: 10, brutoCentavos: 2000, descontoCentavos: 500, diferencaCentavos: 400 });
  assert.equal(r.diferencaTotalCentavos, 400);
  assert.match(explicacaoDaDiferenca({ nome: 'RACAO', precoUnitario: 8 }, r.itens[0]), /R\$ 8,00, abaixo do preço do sistema \(R\$ 10,00\)/);
});

test('a vista usa o preco a vista; a prazo, o de venda', () => {
  assert.equal(conferir([item({ precoUnitario: 9 })], { condicao: 'vista' }).diferencaTotalCentavos, 0);
  assert.equal(conferir([item({ precoUnitario: 9 })], { condicao: 'prazo' }).diferencaTotalCentavos, 200);
});

test('item avulso, sem cadastro ou produto sem preco: valor livre', () => {
  const r = conferirPrecos({
    itens: [item({ id: 'avulso', precoUnitario: 1 }), item({ id: 'sumiu', precoUnitario: 1 }), item({ id: 'zero', precoUnitario: 1 })],
    produtos: { zero: { precoVenda: 0 } },
    promocoes: [], hoje: HOJE, condicao: 'prazo',
  });
  assert.equal(r.diferencaTotalCentavos, 0);
});

test('promocao que vale hoje e o preco do sistema; vencida nao vale', () => {
  assert.equal(conferir([item({ precoUnitario: 8 })], { promocoes: [promocao()] }).diferencaTotalCentavos, 0);
  assert.equal(conferir([item({ precoUnitario: 8 })], { promocoes: [promocao({ continua: false, dataFim: '2026-10-20' })] }).diferencaTotalCentavos, 400);
  assert.equal(conferir([item({ precoUnitario: 8 })], { promocoes: [promocao({ formas: 'vista' })], condicao: 'prazo' }).diferencaTotalCentavos, 400, 'so a vista');
});

test('quota da promocao: o que passa do que sobra e conferido pelo preco normal', () => {
  const promo = promocao({ itens: [{ produtoId: 'racao', tipo: 'valor', valor: 8, quota: 5 }] });
  const vendido = { p1: { racao: 2 } };
  // Sobram 3: a primeira linha (2) cabe, a segunda (2) ja nao cabe.
  const r = conferir([item({ precoUnitario: 8 }), item({ precoUnitario: 8 })], { promocoes: [promo], vendidoPorPromocao: vendido });
  assert.equal(r.itens[0].diferencaCentavos, 0);
  assert.equal(r.itens[1].diferencaCentavos, 400);
  // Linha no preco normal nao gasta a quota.
  const s = conferir([item({ precoUnitario: 10 }), item({ precoUnitario: 8 })], { promocoes: [promo], vendidoPorPromocao: vendido });
  assert.equal(s.diferencaTotalCentavos, 0);
});

test('limite por venda da promocao', () => {
  const promo = promocao({ limitePorVenda: 2 });
  const r = conferir([item({ precoUnitario: 8, quantidade: 3 })], { promocoes: [promo] });
  assert.equal(r.itens[0].diferencaCentavos, 600);
});

test('embalagem: preco proprio, ou base x fator; embalagem que sumiu usa o fator do item', () => {
  const produtos = {
    racao: { ...racao, embalagens: [{ id: 'sc', fatorConversao: 20, precoVenda: 180 }, { id: 'cx', fatorConversao: 5 }] },
  };
  const base = { produtos, promocoes: [promocao()], hoje: HOJE, condicao: 'prazo' as const };
  // Saco com preco proprio nao entra na promocao do kg.
  assert.equal(conferirPrecos({ ...base, itens: [item({ embalagemId: 'sc', fatorConversao: 20, precoUnitario: 180, quantidade: 1 })] }).diferencaTotalCentavos, 0);
  assert.equal(conferirPrecos({ ...base, itens: [item({ embalagemId: 'sc', fatorConversao: 20, precoUnitario: 170, quantidade: 1 })] }).diferencaTotalCentavos, 1000);
  // Caixa sem preco proprio: promocao do kg x 5 = 40.
  assert.equal(conferirPrecos({ ...base, itens: [item({ embalagemId: 'cx', fatorConversao: 5, precoUnitario: 40, quantidade: 1 })] }).diferencaTotalCentavos, 0);
  assert.equal(conferirPrecos({ ...base, promocoes: [], itens: [item({ embalagemId: 'fardo', fatorConversao: 3, precoUnitario: 25, quantidade: 1 })] }).diferencaTotalCentavos, 500);
});

test('quantidade fracionada: arredonda por linha', () => {
  const r = conferir([item({ precoUnitario: 9.99, quantidade: 0.333 })]);
  assert.equal(r.itens[0].diferencaCentavos, Math.round(1000 * 0.333) - Math.round(999 * 0.333));
});
