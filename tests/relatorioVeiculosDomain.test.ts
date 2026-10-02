import assert from 'node:assert/strict';
import { test } from 'node:test';
import { montarDocumentoVeiculos, veiculosDoRelatorio, type VeiculoDoRelatorio } from '../src/utils/relatorioVeiculosDomain';
import { linhaTotalSecao } from '../src/utils/relatorioPdfDomain';

const base: VeiculoDoRelatorio[] = [
  { id: '1', placa: 'XYZ9A99', modelo: 'Gol', marca: 'VW', ano: '2015', cor: 'Prata', kmAtual: 120500, clienteNome: 'Maria Souza' },
  { id: '2', placa: 'ABC1D23', modelo: 'Strada', ano: '2020', cor: '', clienteNome: 'João Lima' },
  { id: '3', placa: 'DEF4G56', modelo: 'Hilux', marca: 'Toyota' },
];

test('ordena pela placa e busca por placa, modelo ou cliente sem diferenciar maiúscula', () => {
  assert.deepEqual(veiculosDoRelatorio(base, '').map((v) => v.id), ['2', '3', '1']);
  assert.deepEqual(veiculosDoRelatorio(base, 'abc').map((v) => v.id), ['2']);
  assert.deepEqual(veiculosDoRelatorio(base, 'HILUX').map((v) => v.id), ['3']);
  assert.deepEqual(veiculosDoRelatorio(base, 'maria').map((v) => v.id), ['1']);
  assert.deepEqual(veiculosDoRelatorio(base, 'nada').length, 0);
});

test('documento: colunas da página antiga, padrões de vazio e total de veículos', () => {
  const doc = montarDocumentoVeiculos(base, '');
  assert.equal(doc.titulo, 'Relatório de Frota e Veículos');
  assert.deepEqual(doc.filtros, []);
  assert.deepEqual(doc.indicadores, [{ rotulo: 'Veículos listados', valor: '3' }]);
  const secao = doc.secoes[0];
  assert.deepEqual(secao.colunas.map((c) => c.titulo), ['Placa', 'Veículo (Marca/Modelo)', 'Ano/Cor', 'KM Atual', 'Dono (Cliente)']);
  const valores = (linha: VeiculoDoRelatorio) => secao.colunas.map((c) => c.valor(linha));
  assert.deepEqual(valores(secao.linhas[0]), ['ABC1D23', 'Strada', '2020 / -', null, 'João Lima']);
  assert.deepEqual(valores(secao.linhas[1]), ['DEF4G56', 'Toyota Hilux', '- / -', null, 'Não informado']);
  assert.deepEqual(valores(secao.linhas[2]), ['XYZ9A99', 'VW Gol', '2015 / Prata', 120500, 'Maria Souza']);
  // KM nao soma: a linha de total so' leva o rotulo.
  const total = linhaTotalSecao(secao.colunas, secao.linhas, 'Total');
  assert.deepEqual(total, ['TOTAL', '', '', '', '']);
});

test('filtro aparece no cabeçalho e lista vazia não quebra', () => {
  const doc = montarDocumentoVeiculos(base, 'zzz');
  assert.deepEqual(doc.filtros, ['Filtro aplicado: "zzz"']);
  assert.equal(doc.secoes[0].linhas.length, 0);
  assert.equal(doc.indicadores[0].valor, '0');
});
