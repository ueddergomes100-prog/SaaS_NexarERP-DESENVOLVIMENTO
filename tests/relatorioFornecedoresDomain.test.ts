import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILTRO_EXTRA_CLIENTES_VAZIO } from '../src/utils/relatorioClientesDomain';
import {
  montarDocumentoFornecedores,
  passaNosFiltrosDoFornecedor,
  tipoDoFornecedor,
  type FornecedorDoRelatorio,
} from '../src/utils/relatorioFornecedoresDomain';

const FORNECEDORES: FornecedorDoRelatorio[] = [
  { id: 'a', codigo: '1', nome: 'Distribuidora Alfa', tipo: 'Fornecedor', cnpj: '12345678000190', cidade: 'Vitória', estado: 'ES', bairro: 'Centro', cadastradoEm: '2026-03-01' },
  { id: 'b', codigo: '2', nome: 'Rodo Log', tipo: 'Transportadora', cnpj: '98765432000110', cidade: 'Serra', estado: 'ES', ativo: false },
  { id: 'c', codigo: '3', nome: 'José Fretes', cnpj: '12345678901', cidade: 'Vitória', estado: 'ES' },
];

test('cadastro antigo sem tipo conta como Fornecedor', () => {
  assert.equal(tipoDoFornecedor({}), 'Fornecedor');
  assert.equal(tipoDoFornecedor({ tipo: ' Transportadora ' }), 'Transportadora');
});

test('filtra por tipo do cadastro e pelos filtros comuns (pessoa, bairro, cadastro)', () => {
  const ids = (tipo: string, extra = {}) => FORNECEDORES
    .filter((f) => passaNosFiltrosDoFornecedor(f, tipo, { ...FILTRO_EXTRA_CLIENTES_VAZIO, ...extra }))
    .map((f) => f.id);
  assert.deepEqual(ids(''), ['a', 'b', 'c']);
  assert.deepEqual(ids('Transportadora'), ['b']);
  assert.deepEqual(ids('Fornecedor'), ['a', 'c']);
  assert.deepEqual(ids('', { tipoPessoa: 'pf' }), ['c']);
  assert.deepEqual(ids('', { bairro: 'centro' }), ['a']);
  assert.deepEqual(ids('', { cadastradoDe: '2026-01-01' }), ['a']);
});

test('o relatorio traz indicadores, CNPJ com mascara e cidades', () => {
  const doc = montarDocumentoFornecedores(FORNECEDORES, { filtrosAplicados: ['Local: ES'] });
  assert.equal(doc.titulo, 'Relatório de Fornecedores');
  assert.equal(doc.periodo, 'Todos os cadastros');
  const ind = Object.fromEntries(doc.indicadores.map((i) => [i.rotulo, i.valor]));
  assert.equal(ind.Fornecedores, '3');
  assert.equal(ind.Inativos, '1');
  assert.equal(ind['Pessoa jurídica'], '2');
  assert.equal(ind['Pessoa física'], '1');
  assert.equal(ind.Transportadoras, '1');

  const secao = doc.secoes.find((s) => s.id === 'fornecedores')!;
  const coluna = (id: string) => secao.colunas.find((c) => c.id === id)!;
  assert.equal(coluna('documento').valor(FORNECEDORES[0]), '12.345.678/0001-90');
  assert.equal(coluna('tipo').valor(FORNECEDORES[2]), 'Fornecedor');
  FORNECEDORES.forEach((f) => secao.colunas.forEach((col) => assert.notEqual(col.valor(f), undefined, col.id)));

  const cidades = doc.secoes.find((s) => s.id === 'cidades')!;
  assert.equal(cidades.linhas[0].cidade, 'VITÓRIA');
  assert.equal(cidades.linhas[0].clientes, 2);
});
