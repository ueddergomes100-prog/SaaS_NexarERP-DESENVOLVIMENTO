const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompanyPayload, regimeDaEmpresaNaSpedy } = require('../services/spedyEmpresa');

test('regime na Spedy: Simples, MEI (marca em Configuracoes) e regime normal', () => {
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'simples_nacional' }), 'simplesNacional');
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'simples_nacional', empresaMei: true }), 'simplesNacionalMEI');
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'lucro_presumido' }), 'regimeNormal');
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'lucro_real' }), 'regimeNormal');
});

test('MEI so vale junto com o Simples: marca esquecida em empresa de regime normal nao muda o regime', () => {
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'lucro_presumido', empresaMei: true }), 'regimeNormal');
});

test('sem regime gravado, ou marca que nao e exatamente "sim": Simples comum', () => {
  assert.equal(regimeDaEmpresaNaSpedy({}), 'simplesNacional');
  assert.equal(regimeDaEmpresaNaSpedy(undefined), 'simplesNacional');
  assert.equal(regimeDaEmpresaNaSpedy({ regimeTributario: 'simples_nacional', empresaMei: 'true' }), 'simplesNacional');
});

test('cadastro da empresa MEI vai para a Spedy com o regime de MEI, razao social e cidade', () => {
  const payload = buildCompanyPayload({
    nomeOficina: 'OFICINA DO ZE', razaoSocial: '12.345.678 JOSE DA SILVA', cnpj: '12.345.678/0001-95',
    regimeTributario: 'simples_nacional', empresaMei: true, inscricaoEstadual: '001.234.567/00-89',
    rua: 'RUA A', numero: '10', bairro: 'CENTRO', cep: '36900-000',
    nfseCidadeCodigo: '3139409', nfseCidadeNome: 'Manhuaçu', nfseCidadeEstado: 'MG',
  });
  assert.equal(payload.taxRegime, 'simplesNacionalMEI');
  assert.equal(payload.legalName, '12.345.678 JOSE DA SILVA');
  assert.equal(payload.name, 'OFICINA DO ZE');
  assert.equal(payload.federalTaxNumber, '12345678000195');
  assert.equal(payload.stateTaxNumber, '0012345670089');
  assert.deepEqual(payload.address.city, { code: '3139409', name: 'Manhuaçu', state: 'mg' });
});
