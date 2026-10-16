import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILTRO_MATERIAS_PRIMAS_VAZIO,
  abaixoDoMinimoMp,
  montarDocumentoMateriasPrimas,
  opcoesDosFiltrosMp,
  passaNoFiltroMp,
  quantosFiltrosMp,
  valorEmEstoqueMpCentavos,
  type MateriaPrimaDoRelatorio,
} from '../src/utils/relatorioMateriasPrimasDomain';

const MPS: MateriaPrimaDoRelatorio[] = [
  { id: 'a', codigo: '1', nome: 'Farinha', categoria: 'Grãos', unidade: 'KG', quantidade: 10, estoqueMinimo: 20, precoCusto: 2.5, fornecedor: 'Moinho Sul' },
  { id: 'b', codigo: '2', nome: 'Açúcar', categoria: 'Grãos', unidade: 'KG', quantidade: 0, estoqueMinimo: 0, precoCusto: 4, fornecedor: 'Usina' },
  { id: 'c', codigo: '3', nome: 'Embalagem', categoria: '', quantidade: 100, precoCusto: 0.1, reservado: 30 },
  { id: 'd', codigo: '4', nome: 'Óleo', categoria: 'Óleos', quantidade: -2, precoCusto: 9 },
];

test('abaixo do minimo so com minimo informado; valor nao conta saldo negativo', () => {
  assert.equal(abaixoDoMinimoMp(MPS[0]), true);
  assert.equal(abaixoDoMinimoMp(MPS[1]), false);
  assert.equal(valorEmEstoqueMpCentavos(MPS[0]), 2500);
  assert.equal(valorEmEstoqueMpCentavos(MPS[3]), 0);
});

test('filtros de categoria, fornecedor e estoque', () => {
  const ids = (f: Partial<typeof FILTRO_MATERIAS_PRIMAS_VAZIO>) => MPS.filter((m) => passaNoFiltroMp(m, { ...FILTRO_MATERIAS_PRIMAS_VAZIO, ...f })).map((m) => m.id);
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids({ categoria: 'Grãos' }), ['a', 'b']);
  assert.deepEqual(ids({ fornecedor: 'Usina' }), ['b']);
  assert.deepEqual(ids({ estoque: 'abaixo_minimo' }), ['a']);
  assert.deepEqual(ids({ estoque: 'sem_estoque' }), ['b', 'd']);
  assert.deepEqual(ids({ estoque: 'com_estoque' }), ['a', 'c']);
  assert.equal(quantosFiltrosMp({ categoria: 'x', fornecedor: '', estoque: 'sem_estoque' }), 2);
});

test('opcoes dos selects: so o que existe, sem repetir, em ordem', () => {
  assert.deepEqual(opcoesDosFiltrosMp(MPS), { categorias: ['Grãos', 'Óleos'], fornecedores: ['Moinho Sul', 'Usina'] });
});

test('relatorio: indicadores, previsto e resumo por categoria', () => {
  const doc = montarDocumentoMateriasPrimas(MPS, { filtrosAplicados: [], dataHoje: '2026-10-16' });
  assert.equal(doc.periodo, 'Posição em 16/10/2026');
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind['Matérias-primas'], '4');
  assert.match(ind['Valor em estoque'], /35,00/);
  assert.equal(ind['Abaixo do mínimo'], '1');
  assert.equal(ind['Em produção'], '1');

  const secao = doc.secoes.find((s) => s.id === 'materias')!;
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('previsto').valor(MPS[2]), '70');
  assert.equal(coluna('situacao').valor(MPS[0]), 'Abaixo do mínimo');
  assert.equal(coluna('unidade').valor(MPS[2]), 'UN');
  MPS.forEach((m) => secao.colunas.forEach((col) => assert.notEqual(col.valor(m), undefined, col.id)));

  const categorias = doc.secoes.find((s) => s.id === 'categorias')!;
  assert.equal(categorias.linhas[0].categoria, 'Grãos');
  assert.equal(categorias.linhas.find((c: { categoria: string }) => c.categoria === 'Sem categoria').itens, 1);
});
