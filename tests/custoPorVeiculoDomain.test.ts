import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  montarDocumentoCustoPorVeiculo,
  resumirPorCategoria,
  resumirPorVeiculo,
  titulosDoRelatorio,
  type TituloDeVeiculo,
} from '../src/utils/custoPorVeiculoDomain';

const t = (extra: Partial<TituloDeVeiculo>): TituloDeVeiculo => ({
  id: Math.random().toString(36).slice(2), data: '2026-09-10', descricao: 'DIESEL', categoria: 'Combustível', valor: 100, status: 'Pendente',
  veiculoId: 'v1', veiculoNome: 'VW DELIVERY — ABC-1D23', veiculoPlaca: 'ABC1D23', ...extra,
});

const base: TituloDeVeiculo[] = [
  t({ id: 'a', valor: 100, status: 'Paga', dataPagamento: '2026-09-11' }),
  t({ id: 'b', valor: 250.5, categoria: 'Manutenção', data: '2026-09-20' }),
  t({ id: 'c', valor: 80, veiculoId: 'v2', veiculoNome: 'FIAT FIORINO — DEF-4G56', veiculoPlaca: 'DEF4G56', status: 'Paga' }),
  t({ id: 'd', valor: 999, status: 'Cancelada' }),
  t({ id: 'e', valor: 50, veiculoId: undefined }),
  t({ id: 'f', valor: 70, data: '2026-08-31' }),
];
const filtro = { de: '2026-09-01', ate: '2026-09-30' };

test('entram só despesas com veículo, no período, e nunca as canceladas', () => {
  assert.deepEqual(titulosDoRelatorio(base, filtro).map((x) => x.id), ['a', 'c', 'b']);
  assert.deepEqual(titulosDoRelatorio(base, { ...filtro, veiculoId: 'v2' }).map((x) => x.id), ['c']);
  assert.deepEqual(titulosDoRelatorio(base, { ...filtro, situacao: 'pagas' }).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(titulosDoRelatorio(base, { ...filtro, situacao: 'a_pagar' }).map((x) => x.id), ['b']);
  assert.equal(titulosDoRelatorio(base, { de: '', ate: '' }).length, 4, 'sem período pega tudo que tem veículo (menos cancelada)');
});

test('total por veículo separa pago e a pagar, em centavos, do maior para o menor', () => {
  const resumo = resumirPorVeiculo(titulosDoRelatorio(base, filtro));
  assert.deepEqual(resumo.map((r) => [r.veiculoId, r.despesas, r.totalCentavos, r.pagoCentavos, r.aPagarCentavos]), [
    ['v1', 2, 35050, 10000, 25050],
    ['v2', 1, 8000, 8000, 0],
  ]);
});

test('por categoria soma e ordena', () => {
  const porCategoria = resumirPorCategoria(titulosDoRelatorio(base, filtro));
  assert.deepEqual(porCategoria.map((c) => [c.categoria, c.totalCentavos]), [['MANUTENÇÃO', 25050], ['COMBUSTÍVEL', 18000]]);
});

test('documento: indicadores, 3 seções, lançamentos agrupados por veículo e período no cabeçalho', () => {
  const doc = montarDocumentoCustoPorVeiculo(base, filtro);
  assert.equal(doc.titulo, 'Custo por Veículo');
  assert.equal(doc.periodo, 'Vencimento de 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.indicadores.map((i) => i.rotulo), ['Total das despesas', 'Pago', 'A pagar', 'Veículos', 'Despesas']);
  assert.match(doc.indicadores[0].valor, /430,50/);
  assert.equal(doc.indicadores[3].valor, '2');
  assert.deepEqual(doc.secoes.map((s) => s.id), ['resumo', 'categorias', 'lancamentos']);
  const lanc = doc.secoes[2];
  assert.equal(lanc.linhas.length, 3);
  assert.equal(lanc.agruparPor?.chave(lanc.linhas[0]), 'v1');
  assert.match(String(lanc.agruparPor?.rotulo(lanc.linhas[0])), /ABC-1D23/);
  const colunaValor = lanc.colunas.find((c) => c.id === 'valor');
  assert.equal(colunaValor?.valor(lanc.linhas[2]), 25050);
});

test('sem despesas: documento vazio não quebra', () => {
  const doc = montarDocumentoCustoPorVeiculo([], filtro, 'VW');
  assert.equal(doc.indicadores[0].valor.replace(/\s/g, ''), 'R$0,00');
  assert.deepEqual(doc.filtros, ['Veículo: VW']);
  assert.equal(doc.secoes[0].linhas.length, 0);
});
