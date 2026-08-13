import test from 'node:test';
import assert from 'node:assert/strict';
import { usesCsosn, ICMS_CST_OPTIONS, matchProdutoFromXmlItem, type EstoqueItemForMatch } from '../src/utils/fiscalDomain';

test('Simples Nacional usa CSOSN', () => {
  assert.equal(usesCsosn('simples_nacional'), true);
});

test('Lucro Presumido nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_presumido'), false);
});

test('Lucro Real nao usa CSOSN', () => {
  assert.equal(usesCsosn('lucro_real'), false);
});

test('ICMS_CST_OPTIONS tem os 11 codigos reais de CST de ICMS, sem duplicar CSOSN', () => {
  const values = ICMS_CST_OPTIONS.map((opt) => opt.value);
  assert.equal(values.length, 11);
  assert.deepEqual(values, ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90']);
  assert.equal(new Set(values).size, values.length);
});

const estoque: EstoqueItemForMatch[] = [
  { id: 'p-ean', codigo: 'X1', nome: 'PARAFUSO SEXTAVADO', codigoBarras: '7891234567890', ncm: '73181500' },
  { id: 'p-fornecedor', codigo: 'X2', nome: 'ARRUELA LISA', codigoBarras: '', ncm: '73182100', codigosFornecedor: { 'fornecedor-1': 'COD-FORN-99' } },
  { id: 'p-ncm-nome', codigo: 'X3', nome: 'PORCA SEXTAVADA M8', codigoBarras: '', ncm: '73181600' },
];

test('matchProdutoFromXmlItem casa por EAN primeiro, mesmo se outros dados nao batem', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'QUALQUER', descricao: 'DESCRICAO DIFERENTE', ncm: '00000000', ean: '7891234567890' },
    estoque,
    'fornecedor-1',
  );
  assert.equal(result.layer, 'ean');
  assert.equal(result.produto?.id, 'p-ean');
});

test('matchProdutoFromXmlItem casa por codigo do fornecedor quando nao ha EAN', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'COD-FORN-99', descricao: 'NOME DIFERENTE', ncm: '00000000' },
    estoque,
    'fornecedor-1',
  );
  assert.equal(result.layer, 'codigo_fornecedor');
  assert.equal(result.produto?.id, 'p-fornecedor');
});

test('matchProdutoFromXmlItem nao casa codigo do fornecedor de um fornecedor diferente', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'COD-FORN-99', descricao: 'NOME DIFERENTE', ncm: '00000000' },
    estoque,
    'fornecedor-2',
  );
  assert.equal(result.produto, null);
});

test('matchProdutoFromXmlItem cai pra NCM+nome como ultimo recurso', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'SEM-RELACAO', descricao: 'Porca Sextavada M8', ncm: '73181600' },
    estoque,
    'fornecedor-1',
  );
  assert.equal(result.layer, 'ncm_nome');
  assert.equal(result.produto?.id, 'p-ncm-nome');
});

test('matchProdutoFromXmlItem exige NCM E nome batendo, nao so um dos dois', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'SEM-RELACAO', descricao: 'Porca Sextavada M8', ncm: '00000000' },
    estoque,
    'fornecedor-1',
  );
  assert.equal(result.produto, null);
});

test('matchProdutoFromXmlItem retorna null quando nada bate em nenhuma camada', () => {
  const result = matchProdutoFromXmlItem(
    { codigo: 'INEXISTENTE', descricao: 'PRODUTO NOVO NUNCA VISTO', ncm: '99999999' },
    estoque,
    'fornecedor-1',
  );
  assert.equal(result.produto, null);
  assert.equal(result.layer, null);
});
