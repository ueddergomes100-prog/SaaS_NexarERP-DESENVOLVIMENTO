import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTROLA_FISCAL,
  parseControlaFiscal,
  usesCsosn, ICMS_CST_OPTIONS, matchProdutoFromXmlItem, matchMateriaPrimaFromXmlItem, buildTaxesPayload,
  buildServiceInvoiceDescription, sumServiceInvoiceAmount, buildServiceInvoicePayload,
  isExportCfop, resolveInvoiceDestination, resolveInvoiceUnitFields,
  type EstoqueItemForMatch, type MateriaPrimaItemForMatch, type OsServicoParaFatura, type NfseConfig,
} from '../src/utils/fiscalDomain';

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

const materiasPrimas: MateriaPrimaItemForMatch[] = [
  { id: 'mp-codigo', codigo: 'MP-001', nome: 'CHAPA DE ACO 2MM' },
  { id: 'mp-nome', codigo: '', nome: 'RESINA EPOXI' },
];

test('matchMateriaPrimaFromXmlItem casa por codigo exato primeiro', () => {
  const result = matchMateriaPrimaFromXmlItem(
    { codigo: 'MP-001', descricao: 'DESCRICAO DIFERENTE DO XML', ncm: '00000000' },
    materiasPrimas,
  );
  assert.equal(result?.id, 'mp-codigo');
});

test('matchMateriaPrimaFromXmlItem cai pra nome exato quando o codigo nao bate', () => {
  const result = matchMateriaPrimaFromXmlItem(
    { codigo: 'COD-XML-QUALQUER', descricao: 'Resina Epoxi', ncm: '00000000' },
    materiasPrimas,
  );
  assert.equal(result?.id, 'mp-nome');
});

test('matchMateriaPrimaFromXmlItem nao deixa codigo/nome vazio darem match falso positivo', () => {
  const result = matchMateriaPrimaFromXmlItem(
    { codigo: '', descricao: '', ncm: '00000000' },
    materiasPrimas,
  );
  assert.equal(result, null);
});

test('matchMateriaPrimaFromXmlItem retorna null quando nada bate', () => {
  const result = matchMateriaPrimaFromXmlItem(
    { codigo: 'INEXISTENTE', descricao: 'MATERIAL NUNCA VISTO', ncm: '99999999' },
    materiasPrimas,
  );
  assert.equal(result, null);
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

const servicosOS: OsServicoParaFatura[] = [
  { nome: 'Troca de óleo', preco: 50, tempoHoras: 1 },
  { nome: 'Alinhamento', preco: 80, tempoHoras: 0.5, detalhamento: 'Dianteiro e traseiro' },
];

test('buildServiceInvoiceDescription junta nome e detalhamento de cada servico', () => {
  assert.equal(
    buildServiceInvoiceDescription(servicosOS),
    'Troca de óleo; Alinhamento - Dianteiro e traseiro',
  );
});

test('buildServiceInvoiceDescription ignora servico sem nome', () => {
  assert.equal(buildServiceInvoiceDescription([{ nome: '', preco: 10 }]), '');
});

test('sumServiceInvoiceAmount soma preco x horas de cada servico (mesma regra de OSForm)', () => {
  assert.equal(sumServiceInvoiceAmount(servicosOS), 50 * 1 + 80 * 0.5);
});

test('sumServiceInvoiceAmount cai pra quantidade quando tempoHoras nao esta definido', () => {
  assert.equal(sumServiceInvoiceAmount([{ nome: 'Diagnóstico', preco: 100, quantidade: 2 }]), 200);
});

const clienteFatura = {
  nome: 'CLIENTE TESTE',
  documento: '123.456.789-00',
  email: 'cliente@teste.com',
  endereco: 'Rua Principal',
  numero: '100',
  bairro: 'Centro',
  cep: '36970-000',
  cidade: 'Manhuaçu',
  estado: 'MG',
  codigoIbge: '3138906',
};

const nfseConfig: NfseConfig = {
  habilitada: true,
  cidadeCodigo: '3138906',
  cidadeNome: 'Manhuaçu',
  cidadeEstado: 'MG',
  inscricaoMunicipal: '12345',
  codigoServicoMunicipal: '101',
  codigoServicoFederal: '14.01',
  aliquotaIssPadrao: 5,
};

test('buildServiceInvoicePayload monta o total, ISS e descricao a partir dos servicos', () => {
  const payload = buildServiceInvoicePayload(servicosOS, clienteFatura, nfseConfig, 'integration-123');
  assert.equal(payload.integrationId, 'integration-123');
  assert.equal(payload.description, 'Troca de óleo; Alinhamento - Dianteiro e traseiro');
  assert.equal(payload.taxationType, 'taxationInMunicipality');
  assert.equal(payload.federalServiceCode, '14.01');
  assert.equal(payload.cityServiceCode, '101');
  assert.deepEqual(payload.location, { code: '3138906', name: 'Manhuaçu', state: 'MG' });
  assert.equal(payload.total.invoiceAmount, 90);
  assert.equal(payload.total.issRate, 0.05);
  assert.equal(payload.total.issAmount, 4.5);
  assert.equal(payload.total.issWithheld, false);
  assert.equal(payload.receiver.federalTaxNumber, '12345678900');
  assert.equal(payload.receiver.address.city.code, '3138906');
});

test('buildServiceInvoicePayload nao inclui location quando o tenant nao configurou cidade', () => {
  const payload = buildServiceInvoicePayload(servicosOS, clienteFatura, { habilitada: false }, 'id-2');
  assert.equal(payload.location, undefined);
  assert.equal(payload.total.issRate, 0);
});

test('isExportCfop reconhece 7101/7102 (string ou number) e rejeita CFOPs domesticos', () => {
  assert.equal(isExportCfop(7101), true);
  assert.equal(isExportCfop('7102'), true);
  assert.equal(isExportCfop(5102), false);
  assert.equal(isExportCfop('6102'), false);
  assert.equal(isExportCfop(undefined), false);
  assert.equal(isExportCfop(null), false);
});

test('resolveInvoiceDestination usa international so pra CFOP de exportacao', () => {
  assert.equal(resolveInvoiceDestination(7101, 'internal'), 'international');
  assert.equal(resolveInvoiceDestination('7102', 'interstate'), 'international');
  assert.equal(resolveInvoiceDestination(5102, 'internal'), 'internal');
  assert.equal(resolveInvoiceDestination(6102, 'interstate'), 'interstate');
});

test('resolveInvoiceUnitFields mantem comercial=tributavel fora de CFOP de exportacao', () => {
  const result = resolveInvoiceUnitFields({
    cfop: 5102,
    unidadeComercial: 'UN',
    quantidadeComercial: 10,
    valorUnitarioComercial: 25,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields, {
    unit: 'UN', quantity: 10, unitAmount: 25,
    unitTax: 'UN', quantityTax: 10, unitTaxAmount: 25,
  });
});

test('resolveInvoiceUnitFields converte pra quilo em CFOP de exportacao com peso configurado', () => {
  const result = resolveInvoiceUnitFields({
    cfop: 7101,
    unidadeComercial: 'UN',
    quantidadeComercial: 30,
    valorUnitarioComercial: 20,
    pesoLiquidoUnitarioKg: 0.5,
  });
  assert.equal(result.ok, true);
  assert.equal(result.fields?.unit, 'UN');
  assert.equal(result.fields?.quantity, 30);
  assert.equal(result.fields?.unitAmount, 20);
  assert.equal(result.fields?.unitTax, 'KG');
  assert.equal(result.fields?.quantityTax, 15); // 0.5kg * 30un
  assert.equal(result.fields?.unitTaxAmount, 40); // (20*30) / 15kg
});

test('resolveInvoiceUnitFields bloqueia CFOP de exportacao sem peso configurado', () => {
  const semPeso = resolveInvoiceUnitFields({
    cfop: '7102', unidadeComercial: 'UN', quantidadeComercial: 5, valorUnitarioComercial: 10,
  });
  assert.equal(semPeso.ok, false);
  assert.ok(semPeso.error);

  const pesoZero = resolveInvoiceUnitFields({
    cfop: '7102', unidadeComercial: 'UN', quantidadeComercial: 5, valorUnitarioComercial: 10, pesoLiquidoUnitarioKg: 0,
  });
  assert.equal(pesoZero.ok, false);
});

// --- Empresa que nao controla fiscal --------------------------------------

test('fiscal vem ligado por padrao', () => {
  assert.equal(DEFAULT_CONTROLA_FISCAL, true);
});

test('so false explicito desliga o fiscal', () => {
  assert.equal(parseControlaFiscal(false), false);
  // Empresa que nunca abriu a configuracao nao tem o campo gravado -- sumir
  // com o menu de nota de quem ja emite seria bem pior que o contrario.
  assert.equal(parseControlaFiscal(undefined), true);
  assert.equal(parseControlaFiscal(null), true);
  assert.equal(parseControlaFiscal(true), true);
  assert.equal(parseControlaFiscal('false'), true);
});
