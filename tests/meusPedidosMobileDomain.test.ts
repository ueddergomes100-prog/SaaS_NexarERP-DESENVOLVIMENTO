import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filtrarMeusPedidos, ordenarMaisNovosPrimeiro, PAGINA_MEUS_PEDIDOS, quantoBuscarDaFonte, temMaisMeusPedidos } from '../src/utils/meusPedidosMobileDomain';

test('6 em 6: cada colecao busca o que falta para o alvo; esgotada nao busca', () => {
  assert.equal(PAGINA_MEUS_PEDIDOS, 6);
  assert.equal(quantoBuscarDaFonte(0, 6, false), 6);
  assert.equal(quantoBuscarDaFonte(6, 12, false), 6);
  assert.equal(quantoBuscarDaFonte(9, 12, false), 3);
  assert.equal(quantoBuscarDaFonte(15, 12, false), 0);
  assert.equal(quantoBuscarDaFonte(2, 12, true), 0);
});

test('6 em 6: "Ver mais" some quando nao ha mais nada carregado nem por buscar', () => {
  assert.equal(temMaisMeusPedidos({ totalNaLista: 6, visiveis: 6, fontesEsgotadas: false }), true);
  assert.equal(temMaisMeusPedidos({ totalNaLista: 8, visiveis: 6, fontesEsgotadas: true }), true);
  assert.equal(temMaisMeusPedidos({ totalNaLista: 5, visiveis: 6, fontesEsgotadas: true }), false);
});

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.UTC(2026, 8, 21, 15);
const item = (id: string, diasAtras: number | null) => ({
  id, tipo: 'Pedido' as const, createdAtMillis: diasAtras === null ? 0 : AGORA - diasAtras * DIA,
});

test('ordena do mais novo pro mais antigo; sem data vai pro fim', () => {
  const r = ordenarMaisNovosPrimeiro([item('a', 5), item('b', 1), item('c', null), item('d', 40)]);
  assert.deepEqual(r.map((x) => x.id), ['b', 'a', 'd', 'c']);
});

test('com Minhas Vendas: tudo, inclusive antigo e sem data', () => {
  const r = filtrarMeusPedidos([item('a', 5), item('b', 400), item('c', null)], { temMinhasVendas: true, agoraMillis: AGORA });
  assert.deepEqual(r.map((x) => x.id), ['a', 'b', 'c']);
});

test('sem Minhas Vendas: so os ultimos 30 dias', () => {
  const r = filtrarMeusPedidos([item('a', 5), item('b', 29), item('c', 31), item('d', null)], { temMinhasVendas: false, agoraMillis: AGORA });
  assert.deepEqual(r.map((x) => x.id), ['a', 'b']);
});

test('o limite de 30 dias e inclusivo', () => {
  const r = filtrarMeusPedidos([item('a', 30)], { temMinhasVendas: false, agoraMillis: AGORA });
  assert.deepEqual(r.map((x) => x.id), ['a']);
});
