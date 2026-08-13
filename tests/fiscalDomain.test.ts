import test from 'node:test';
import assert from 'node:assert/strict';
import { usesCsosn, ICMS_CST_OPTIONS, matchProdutoFromXmlItem, buildTaxesPayload, type EstoqueItemForMatch } from '../src/utils/fiscalDomain';

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

test('buildTaxesPayload no Simples Nacional manda so csosn/origem no ICMS e cst 7 fixo em PIS/COFINS', () => {
  const payload = buildTaxesPayload({ origem: '0', csosn: '102' }, 'simples_nacional', 1000);
  assert.deepEqual(payload.icms, { origin: 0, csosn: 102 });
  assert.deepEqual(payload.pis, { cst: 7 });
  assert.deepEqual(payload.cofins, { cst: 7 });
  assert.equal(payload.ipi, undefined);
});

test('buildTaxesPayload no Lucro Presumido manda CST real de ICMS com base/aliquota/valor calculados', () => {
  const payload = buildTaxesPayload(
    { origem: '0', csosn: '00', aliquotaIcms: 18, reducaoBaseIcms: 0, cstPis: '01', aliquotaPis: 1.65, cstCofins: '01', aliquotaCofins: 7.6 },
    'lucro_presumido',
    1000,
  );
  assert.equal(payload.icms.cst, 0);
  assert.equal(payload.icms.csosn, undefined);
  assert.equal(payload.icms.baseTax, 1000);
  assert.equal(payload.icms.rate, 18);
  assert.equal(payload.icms.amount, 180);
  assert.deepEqual(payload.pis, { cst: 1, baseTax: 1000, rate: 1.65, amount: 16.5 });
  assert.deepEqual(payload.cofins, { cst: 1, baseTax: 1000, rate: 7.6, amount: 76 });
});

test('buildTaxesPayload aplica reducao de base do ICMS antes de calcular o valor', () => {
  const payload = buildTaxesPayload(
    { origem: '0', csosn: '20', aliquotaIcms: 18, reducaoBaseIcms: 50 },
    'lucro_real',
    1000,
  );
  assert.equal(payload.icms.baseTax, 500);
  assert.equal(payload.icms.amount, 90);
});

test('buildTaxesPayload so inclui IPI quando o produto tem CST de IPI configurado', () => {
  const semIpi = buildTaxesPayload({ origem: '0', csosn: '00' }, 'lucro_real', 1000);
  assert.equal(semIpi.ipi, undefined);

  const comIpi = buildTaxesPayload({ origem: '0', csosn: '00', cstIpi: '50', aliquotaIpi: 10 }, 'lucro_real', 1000);
  assert.deepEqual(comIpi.ipi, { cst: 50, baseTax: 1000, rate: 10, amount: 100 });
});

test('buildTaxesPayload so inclui IBS/CBS quando o produto tem CST configurado (MVP parcial, sem split estadual/municipal)', () => {
  const sem = buildTaxesPayload({ origem: '0', csosn: '00' }, 'lucro_real', 1000);
  assert.equal(sem.ibsCbs, undefined);

  const com = buildTaxesPayload({ origem: '0', csosn: '00', cstIbs: '01', cstCbs: '01', aliquotaCbs: 1 }, 'lucro_real', 1000);
  assert.deepEqual(com.ibsCbs, { cst: 1, baseTax: 1000, cbsRate: 1, cbsAmount: 10 });
});
