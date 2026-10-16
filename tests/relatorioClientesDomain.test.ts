import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILTRO_EXTRA_CLIENTES_VAZIO,
  montarDocumentoClientes,
  passaNosFiltrosExtras,
  quantosFiltrosExtras,
  resumoPorCidade,
  tipoPessoaDoCliente,
  type ClienteDoRelatorio,
} from '../src/utils/relatorioClientesDomain';

const CLIENTES: ClienteDoRelatorio[] = [
  { id: 'a', codigo: '1', nome: 'Maria', documento: '123.456.789-01', bairro: 'Centro', cidade: 'Uberaba', estado: 'mg', cadastradoEm: '2026-01-10', limiteDeCredito: 1500.5 },
  { id: 'b', codigo: '2', nome: 'Agro Ltda', documento: '12.345.678/0001-90', bairro: 'Jardim São José', cidade: 'uberaba ', estado: 'MG', cadastradoEm: '2026-05-20', ativo: true },
  { id: 'c', codigo: '3', nome: 'João', documento: '', cidade: 'Franca', estado: 'SP', ativo: false },
];

test('tipo de pessoa sai do tamanho do documento, com ou sem mascara', () => {
  assert.equal(tipoPessoaDoCliente('123.456.789-01'), 'pf');
  assert.equal(tipoPessoaDoCliente('12345678000190'), 'pj');
  assert.equal(tipoPessoaDoCliente(''), '');
  assert.equal(tipoPessoaDoCliente('123'), '');
  assert.equal(tipoPessoaDoCliente(undefined), '');
});

test('filtro vazio deixa todo mundo passar', () => {
  assert.equal(CLIENTES.filter((c) => passaNosFiltrosExtras(c, FILTRO_EXTRA_CLIENTES_VAZIO)).length, 3);
  assert.equal(quantosFiltrosExtras(FILTRO_EXTRA_CLIENTES_VAZIO), 0);
});

test('tipo de pessoa: fisica, juridica e "sem documento"', () => {
  const ids = (tipo: 'pf' | 'pj' | 'sem') => CLIENTES.filter((c) => passaNosFiltrosExtras(c, { ...FILTRO_EXTRA_CLIENTES_VAZIO, tipoPessoa: tipo })).map((c) => c.id);
  assert.deepEqual(ids('pf'), ['a']);
  assert.deepEqual(ids('pj'), ['b']);
  assert.deepEqual(ids('sem'), ['c']);
});

test('bairro acha por parte do nome, sem acento e sem maiuscula', () => {
  const achados = CLIENTES.filter((c) => passaNosFiltrosExtras(c, { ...FILTRO_EXTRA_CLIENTES_VAZIO, bairro: 'sao jose' }));
  assert.deepEqual(achados.map((c) => c.id), ['b']);
});

test('periodo de cadastro: inclui as pontas e deixa de fora quem nao tem data', () => {
  const filtro = { ...FILTRO_EXTRA_CLIENTES_VAZIO, cadastradoDe: '2026-01-10', cadastradoAte: '2026-05-20' };
  assert.deepEqual(CLIENTES.filter((c) => passaNosFiltrosExtras(c, filtro)).map((c) => c.id), ['a', 'b']);
  const soDepois = { ...FILTRO_EXTRA_CLIENTES_VAZIO, cadastradoDe: '2026-02-01' };
  assert.deepEqual(CLIENTES.filter((c) => passaNosFiltrosExtras(c, soDepois)).map((c) => c.id), ['b']);
  assert.equal(quantosFiltrosExtras({ ...filtro, bairro: 'x', tipoPessoa: 'pf' }), 3);
});

test('resumo por cidade junta a mesma cidade escrita de jeitos diferentes', () => {
  const resumo = resumoPorCidade(CLIENTES);
  assert.equal(resumo[0].cidade, 'UBERABA');
  assert.equal(resumo[0].clientes, 2);
  assert.equal(resumo.find((c) => c.cidade === 'FRANCA')?.ativos, 0);
  assert.equal(resumoPorCidade([{}])[0].cidade, 'SEM CIDADE NO CADASTRO');
});

test('o relatorio traz indicadores, colunas e o que esta filtrado', () => {
  const doc = montarDocumentoClientes(CLIENTES, { filtrosAplicados: ['Estado: MG'] });
  assert.equal(doc.titulo, 'Relatório de Clientes');
  assert.equal(doc.periodo, 'Todos os cadastros');
  assert.deepEqual(doc.filtros, ['Estado: MG']);
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind.Clientes, '3');
  assert.equal(ind.Ativos, '2');
  assert.equal(ind.Inativos, '1');
  assert.equal(ind['Pessoa física'], '1');
  assert.equal(ind['Pessoa jurídica'], '1');
  assert.equal(ind.Cidades, '2');

  const secao = doc.secoes.find((s) => s.id === 'clientes')!;
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('documento').valor(CLIENTES[1]), '12.345.678/0001-90');
  assert.equal(coluna('limite').valor(CLIENTES[0]), 150050);
  assert.equal(coluna('limite').valor(CLIENTES[2]), null);
  assert.equal(coluna('uf').valor(CLIENTES[0]), 'MG');
  assert.equal(coluna('situacao').valor(CLIENTES[2]), 'Inativo');
  assert.equal(coluna('cadastro').valor(CLIENTES[0]), '10/01/2026');
  // Nenhuma celula sai "undefined".
  CLIENTES.forEach((c) => secao.colunas.forEach((col) => assert.notEqual(col.valor(c), undefined, col.id)));
});

test('periodo do titulo segue o filtro de cadastro', () => {
  const doc = montarDocumentoClientes([], { filtrosAplicados: [], cadastradoDe: '2026-01-01', cadastradoAte: '2026-03-31' });
  assert.equal(doc.periodo, 'Cadastrados de 01/01/2026 a 31/03/2026');
});
