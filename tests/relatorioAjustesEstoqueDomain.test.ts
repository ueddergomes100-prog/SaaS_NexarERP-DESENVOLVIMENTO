import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ajustesDoRelatorio,
  montarDocumentoRelatorioAjustes,
  resumirAjustes,
  type AjusteDoRelatorio,
  type FiltroRelatorioAjustes,
} from '../src/utils/relatorioAjustesEstoqueDomain';

const a = (extra: Partial<AjusteDoRelatorio>): AjusteDoRelatorio => ({
  id: 'x', produtoNome: 'RAÇÃO QUATREE GOURMET 20KG', produtoCodigo: '001', tipo: 'saida', quantidade: 1, motivo: 'perda',
  usuarioNome: 'LEO', data: new Date('2026-09-10T15:00:00Z'), ...extra,
});

const base: AjusteDoRelatorio[] = [
  a({ id: '1', data: new Date('2026-09-05T15:00:00Z'), tipo: 'entrada', motivo: 'sobra_inventario', quantidade: 0.1 }),
  a({ id: '2', data: new Date('2026-09-20T15:00:00Z'), quantidade: 0.2, lote: 'L10', validade: '2026-12-31', observacao: 'rasgou' }),
  a({ id: '3', data: new Date('2026-09-12T15:00:00Z'), tipo: 'entrada', motivo: 'outro', quantidade: 0.2, produtoNome: 'MILHO MOÍDO', produtoCodigo: undefined, origem: 'materia_prima', usuarioNome: 'ANA' }),
  a({ id: '4', data: new Date('2026-08-20T15:00:00Z') }),
  a({ id: '5', data: null, produtoNome: 'SACO', origem: 'insumo', quantidade: 2 }),
];

const filtro: FiltroRelatorioAjustes = {
  inicio: new Date('2026-09-01T03:00:00Z'),
  fim: new Date('2026-10-01T02:59:59Z'),
  tipo: 'todos', motivo: '', produto: '', usuario: '',
};

test('filtros: período (ajuste sem data não é cortado), tipo, motivo, produto com "+" e usuário; mais novo primeiro', () => {
  assert.deepEqual(ajustesDoRelatorio(base, filtro).map((x) => x.id), ['2', '3', '1', '5']);
  assert.deepEqual(ajustesDoRelatorio(base, { ...filtro, tipo: 'entrada' }).map((x) => x.id), ['3', '1']);
  assert.deepEqual(ajustesDoRelatorio(base, { ...filtro, motivo: 'perda' }).map((x) => x.id), ['2', '5']);
  assert.deepEqual(ajustesDoRelatorio(base, { ...filtro, produto: 'racao+20kg' }).map((x) => x.id), ['2', '1']);
  assert.deepEqual(ajustesDoRelatorio(base, { ...filtro, usuario: 'ANA' }).map((x) => x.id), ['3']);
});

test('indicadores somam entradas e saídas sem erro de vírgula flutuante', () => {
  const resumo = resumirAjustes(ajustesDoRelatorio(base, filtro));
  assert.deepEqual(resumo, { total: 4, totalEntradas: 0.3, totalSaidas: 2.2 });
});

test('documento: colunas, quantidade fracionada em texto, produto com código e marca de origem', () => {
  const filtrados = ajustesDoRelatorio(base, { ...filtro, tipo: 'entrada', motivo: 'outro', usuario: 'ANA', produto: ' milho ' });
  const doc = montarDocumentoRelatorioAjustes({ filtrados, filtro: { ...filtro, tipo: 'entrada', motivo: 'outro', usuario: 'ANA', produto: ' milho ' }, rotuloMotivo: 'Outro' });
  assert.equal(doc.titulo, 'Relatório de Ajustes de Estoque');
  assert.equal(doc.periodo, 'De 01/09/2026 a 30/09/2026');
  assert.deepEqual(doc.filtros, ['Tipo: Entrada', 'Motivo: Outro', 'Produto: milho', 'Usuário: ANA']);

  const todos = montarDocumentoRelatorioAjustes({ filtrados: ajustesDoRelatorio(base, filtro), filtro });
  assert.deepEqual(todos.indicadores.map((i) => [i.rotulo, i.valor]), [
    ['Total de ajustes', '4'], ['Total em entradas', '0,3'], ['Total em saídas', '2,2'],
  ]);
  assert.deepEqual(todos.filtros, []);
  const secao = todos.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.id), ['data', 'produto', 'codigo', 'origem', 'tipo', 'quantidade', 'motivo', 'lote', 'usuario', 'observacao']);
  const col = (id: string) => secao.colunas.find((c) => c.id === id)!;
  const [l2, l3, l1, l5] = secao.linhas as AjusteDoRelatorio[];
  assert.equal(col('produto').valor(l2), 'RAÇÃO QUATREE GOURMET 20KG (001)');
  assert.equal(col('produto').valor(l3), 'MILHO MOÍDO — MATÉRIA-PRIMA');
  assert.equal(col('produto').valor(l5), 'SACO (001) — INSUMO');
  assert.equal(col('origem').valor(l3), 'Matéria-prima');
  assert.equal(col('tipo').valor(l2), 'Saída');
  assert.equal(col('tipo').valor(l1), 'Entrada');
  assert.equal(col('quantidade').valor(l1), '0,1');
  assert.equal(col('quantidade').total, 'nenhum');
  assert.equal(col('motivo').valor(l2), 'Perda');
  assert.equal(col('motivo').valor(l1), 'Sobra de inventário');
  assert.equal(col('lote').valor(l2), 'L10 — 31/12/2026');
  assert.equal(col('lote').valor(l1), '');
  assert.equal(col('data').valor(l5), null);
  assert.equal(col('observacao').valor(l2), 'rasgou');
});

test('sem ajustes: documento vazio não quebra', () => {
  const doc = montarDocumentoRelatorioAjustes({ filtrados: [], filtro });
  assert.equal(doc.indicadores[0].valor, '0');
  assert.equal(doc.secoes[0].linhas.length, 0);
});
