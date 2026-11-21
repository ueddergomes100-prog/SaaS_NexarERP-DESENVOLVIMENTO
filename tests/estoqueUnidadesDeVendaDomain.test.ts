import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  embalagensDaLista,
  equivalenciaDaEmbalagem,
  precosDoProdutoDaLista,
  resumoDasEmbalagens,
  saldoNaEmbalagem,
  temEmbalagemAtiva,
  unidadesDeVendaDaLista,
} from '../src/utils/estoqueUnidadesDeVendaDomain.js';

const tubo = {
  precoCusto: 4,
  precoVenda: 5,
  precoAVista: 4.8,
  unidadeMedidaSigla: 'mt',
  unidadeMedidaCasasDecimais: 2,
  codigoBarras: '789',
  embalagens: [
    { id: 'tb', unidadeMedidaSigla: 'TB', fatorConversao: 6, precoVenda: 27, precoAVista: 25, precoCusto: 20, descricao: 'TUBO 6 METROS', codigoBarras: '7891', ativo: true },
    { id: 'rl', unidadeMedidaSigla: 'RL', fatorConversao: 50, ativo: true },
    { id: 'cx', unidadeMedidaSigla: 'CX', fatorConversao: 10, precoVenda: 45, ativo: true },
    { id: 'velha', unidadeMedidaSigla: 'SC', fatorConversao: 3, precoVenda: 14, ativo: false },
  ],
};

test('produto: custo, venda, a vista e margem na unidade do estoque (cadastro novo e antigo)', () => {
  assert.deepEqual(precosDoProdutoDaLista(tubo), { custo: 4, venda: 5, vista: 4.8, margem: 25 });
  assert.deepEqual(precosDoProdutoDaLista({ precos: { custo: 10, venda: 15, aVista: 14 } }), { custo: 10, venda: 15, vista: 14, margem: 50 });
  // Sem custo nao ha' margem; sem a vista fica zero (vale o de venda).
  assert.deepEqual(precosDoProdutoDaLista({ precoVenda: 9 }), { custo: 0, venda: 9, vista: 0, margem: null });
});

test('embalagem com valores proprios: nada e calculado', () => {
  const [tb] = embalagensDaLista(tubo);
  assert.equal(tb.sigla, 'TB');
  assert.equal(tb.descricao, 'TUBO 6 METROS');
  assert.deepEqual([tb.custo, tb.venda, tb.vista], [20, 27, 25]);
  assert.deepEqual([tb.custoCalculado, tb.vendaCalculada, tb.vistaCalculada], [false, false, false]);
  assert.equal(tb.margem, 35);
  assert.equal(tb.codigoBarras, '7891');
});

test('embalagem sem valores: produto x fator, marcado como calculado', () => {
  const rl = embalagensDaLista(tubo)[1];
  assert.deepEqual([rl.custo, rl.venda, rl.vista], [200, 250, 240]);
  assert.deepEqual([rl.custoCalculado, rl.vendaCalculada, rl.vistaCalculada], [true, true, true]);
  assert.equal(rl.margem, 25);
});

test('embalagem com venda propria e sem a vista proprio: sem preco a vista (regra do Pedido de Venda)', () => {
  const cx = embalagensDaLista(tubo)[2];
  assert.equal(cx.venda, 45);
  assert.equal(cx.vista, 0);
  assert.equal(cx.vistaCalculada, false);
  // Custo sem proprio: 4 x 10.
  assert.equal(cx.custo, 40);
  assert.equal(cx.custoCalculado, true);
});

test('embalagem inativa fica de fora; a unidade do estoque vem primeiro', () => {
  assert.deepEqual(embalagensDaLista(tubo).map((e) => e.embalagemId), ['tb', 'rl', 'cx']);
  const unidades = unidadesDeVendaDaLista(tubo);
  assert.deepEqual(unidades.map((u) => u.sigla), ['MT', 'TB', 'RL', 'CX']);
  assert.equal(unidades[0].base, true);
  assert.equal(unidades[0].codigoBarras, '789');
  assert.equal(temEmbalagemAtiva(tubo), true);
  assert.equal(temEmbalagemAtiva({ embalagens: [{ id: 'x', fatorConversao: 2, ativo: false }] }), false);
  assert.equal(temEmbalagemAtiva({}), false);
  // Produto sem unidade cadastrada entra como UN (regra do sistema).
  assert.equal(unidadesDeVendaDaLista({ precoVenda: 3 })[0].sigla, 'UN');
});

test('produto sem custo: embalagem sem margem e sem custo calculado', () => {
  const [e] = embalagensDaLista({ precoVenda: 5, embalagens: [{ id: 'a', unidadeMedidaSigla: 'CX', fatorConversao: 12, ativo: true }] });
  assert.equal(e.custo, 0);
  assert.equal(e.custoCalculado, false);
  assert.equal(e.margem, null);
  assert.equal(e.venda, 60);
});

test('saldo na embalagem: inteira conta so as completas; fracionada usa as casas dela', () => {
  const inteira = { fatorConversao: 6, casasDecimais: 0, fracionado: false };
  assert.equal(saldoNaEmbalagem(313, inteira), 52);
  assert.equal(saldoNaEmbalagem(5, inteira), 0);
  assert.equal(saldoNaEmbalagem(-13, inteira), -2);
  assert.equal(saldoNaEmbalagem(0.3, { fatorConversao: 0.1, casasDecimais: 0, fracionado: false }), 3);
  assert.equal(saldoNaEmbalagem(86.4, { fatorConversao: 20, casasDecimais: 2, fracionado: true }), 4.32);
  assert.equal(saldoNaEmbalagem('abc', inteira), 0);
  assert.equal(saldoNaEmbalagem(10, { fatorConversao: 0, casasDecimais: 0, fracionado: false }), 0);
});

test('selo e equivalencia', () => {
  assert.equal(resumoDasEmbalagens([]), '');
  assert.equal(resumoDasEmbalagens([{ sigla: 'TB' }]), '1 embalagem: TB');
  assert.equal(resumoDasEmbalagens([{ sigla: 'RL' }, { sigla: 'RL' }, { sigla: 'CX' }]), '3 embalagens: RL, CX');
  assert.equal(resumoDasEmbalagens([{ sigla: 'A' }, { sigla: 'B' }, { sigla: 'C' }], 2), '3 embalagens: A, B +1');
  assert.equal(equivalenciaDaEmbalagem({ sigla: 'TB', fatorConversao: 6 }, 'MT'), '1 TB = 6 MT');
  assert.equal(equivalenciaDaEmbalagem({ sigla: 'G', fatorConversao: 0.1 }, 'KG'), '1 G = 0,1 KG');
});
