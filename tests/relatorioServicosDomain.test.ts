import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categoriasDosServicos,
  montarDocumentoServicos,
  passaNaCategoria,
  resumoPorCategoriaServicos,
  type ServicoDoRelatorio,
} from '../src/utils/relatorioServicosDomain';
import { montarDocumentoVeiculosDaTela, type VeiculoDaTela } from '../src/utils/relatorioVeiculosDomain';

const SERVICOS: ServicoDoRelatorio[] = [
  { id: 'a', codigo: '1', nome: 'Troca de óleo', categoria: 'Motor', preco: 80, comissaoPercentual: 10 },
  { id: 'b', codigo: '2', nome: 'Retífica', categoria: 'Motor', preco: 1200.5 },
  { id: 'c', codigo: '3', nome: 'Alinhamento', categoria: '', preco: 60, ativo: false },
];

test('servicos: categorias do filtro e filtro por categoria', () => {
  assert.deepEqual(categoriasDosServicos(SERVICOS), ['Motor']);
  assert.deepEqual(SERVICOS.filter((s) => passaNaCategoria(s, 'Motor')).map((s) => s.id), ['a', 'b']);
  assert.equal(SERVICOS.filter((s) => passaNaCategoria(s, '')).length, 3);
});

test('servicos: resumo por categoria com menor e maior valor', () => {
  const resumo = resumoPorCategoriaServicos(SERVICOS);
  const motor = resumo.find((c) => c.categoria === 'Motor')!;
  assert.equal(motor.servicos, 2);
  assert.equal(motor.menorCentavos, 8000);
  assert.equal(motor.maiorCentavos, 120050);
  assert.ok(resumo.some((c) => c.categoria === 'Sem categoria'));
});

test('servicos: tabela de precos sem total e comissao so quando tem', () => {
  const doc = montarDocumentoServicos(SERVICOS, { filtrosAplicados: [], dataHoje: '2026-10-16' });
  assert.equal(doc.titulo, 'Tabela de Serviços');
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind['Serviços'], '3');
  assert.equal(ind.Inativos, '1');
  assert.equal(ind.Categorias, '1');
  const secao = doc.secoes.find((s) => s.id === 'servicos')!;
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('preco').total, 'nenhum');
  assert.equal(coluna('comissao').valor(SERVICOS[0]), '10%');
  assert.equal(coluna('comissao').valor(SERVICOS[1]), '');
  SERVICOS.forEach((s) => secao.colunas.forEach((col) => assert.notEqual(col.valor(s), undefined, col.id)));
});

const VEICULOS: VeiculoDaTela[] = [
  { id: 'v1', placa: 'abc1d23', modelo: 'Gol', marca: 'VW', ano: '2015', cor: 'Prata', kmAtual: 120000, clienteNome: 'Maria' },
  { id: 'v2', frota: '12', serie: '9XK', modelo: '6110J', marca: 'John Deere', horimetro: 3400, clienteNome: 'maria', ativo: false },
];

test('veiculos da tela: modo oficina usa placa e km', () => {
  const doc = montarDocumentoVeiculosDaTela(VEICULOS, { modo: 'veiculos', filtrosAplicados: [] });
  assert.equal(doc.titulo, 'Relatório de Veículos');
  const secao = doc.secoes[0];
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('identificacao').valor(VEICULOS[0]), 'ABC1D23');
  assert.equal(coluna('medidor').valor(VEICULOS[0]), 120000);
  assert.equal(coluna('medidor').valor(VEICULOS[1]), null);
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind['Clientes donos'], '1');
  assert.equal(ind.Inativos, '1');
});

test('veiculos da tela: maquinas pesadas usa frota e horimetro', () => {
  const doc = montarDocumentoVeiculosDaTela(VEICULOS, { modo: 'maquinas_pesadas', filtrosAplicados: ['Busca: "12"'] });
  assert.equal(doc.titulo, 'Relatório de Equipamentos');
  const coluna = (id: string) => doc.secoes[0].colunas.find((c) => c.id === id)!;
  assert.equal(coluna('identificacao').valor(VEICULOS[1]), 'Frota 12');
  assert.equal(coluna('medidor').titulo, 'Horímetro (h)');
  assert.equal(coluna('medidor').valor(VEICULOS[1]), 3400);
  assert.equal(coluna('cor').padrao, false);
});
