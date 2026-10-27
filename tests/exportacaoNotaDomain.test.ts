import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MUNICIPIO_EXTERIOR,
  camposFaltandoNoEndereco,
  cfopDeExportacaoSugerido,
  destinatarioDaNota,
  erroDoCadastroExterior,
  montarExportacaoDaNota,
  nomeDoPais,
  normalizarDocumentoEstrangeiro,
  paisDoCliente,
  textoLegalDaExportacao,
} from '../src/utils/exportacaoNotaDomain';

const BRASIL = {
  clienteNome: 'MERCADO CENTRAL LTDA', documento: '12.345.678/0001-99', email: 'a@b.com',
  rua: 'RUA A', numero: '10', bairro: 'CENTRO', cep: '35500-000', cidade: 'DIVINOPOLIS', estado: 'MG', codigoIbge: '3122306',
};
const EXTERIOR = {
  clienteNome: 'GLOBAL FOODS LLC', documento: 'ein 12-3456789', email: '',
  rua: '500 MAIN STREET', numero: '', bairro: '', cep: '', cidade: 'MIAMI, FL', estado: '', codigoIbge: '', pais: 'USA',
};

test('pais do cliente: so com a marcacao de exterior e codigo de 3 letras', () => {
  assert.equal(paisDoCliente({ estrangeiro: true, pais: 'usa' }), 'USA');
  assert.equal(paisDoCliente({ estrangeiro: false, pais: 'USA' }), '');
  assert.equal(paisDoCliente({ estrangeiro: true, pais: 'BRA' }), '');
  assert.equal(paisDoCliente(null), '');
  assert.equal(nomeDoPais('PRY'), 'Paraguai');
});

test('cadastro do exterior pede pais, documento, endereco e cidade', () => {
  assert.equal(erroDoCadastroExterior({ estrangeiro: false }), null);
  assert.match(erroDoCadastroExterior({ estrangeiro: true, pais: '' }) || '', /país/);
  assert.match(erroDoCadastroExterior({ estrangeiro: true, pais: 'USA', documentoEstrangeiro: ' ' }) || '', /documento/);
  assert.match(erroDoCadastroExterior({ estrangeiro: true, pais: 'USA', documentoEstrangeiro: 'X1', endereco: 'A' }) || '', /cidade/);
  assert.equal(erroDoCadastroExterior({ estrangeiro: true, pais: 'USA', documentoEstrangeiro: 'X1', endereco: 'A', cidade: 'B' }), null);
  assert.equal(normalizarDocumentoEstrangeiro('ein 12-3456789'), 'EIN12-3456789');
});

test('destinatario do Brasil continua igual (CNPJ so digitos, IE, CEP, IBGE)', () => {
  const r = destinatarioDaNota(BRASIL, '0012345') as { federalTaxNumber: string; stateTaxNumber: string; address: Record<string, unknown> };
  assert.equal(r.federalTaxNumber, '12345678000199');
  assert.equal(r.stateTaxNumber, '0012345');
  assert.equal(r.address.postalCode, '35500000');
  assert.deepEqual(r.address.city, { code: '3122306', name: 'DIVINOPOLIS', state: 'MG' });
  assert.deepEqual(camposFaltandoNoEndereco(BRASIL), []);
  assert.deepEqual(camposFaltandoNoEndereco({ ...BRASIL, codigoIbge: '', cep: '' }), ['CEP', 'Código IBGE da cidade']);
});

test('destinatario do exterior: documento estrangeiro, pais e municipio EXTERIOR, sem IE e sem CEP', () => {
  const r = destinatarioDaNota(EXTERIOR, '999') as Record<string, unknown> & { address: Record<string, unknown> };
  assert.equal(r.federalTaxNumber, 'EIN12-3456789');
  assert.equal('stateTaxNumber' in r, false);
  assert.equal('email' in r, false);
  assert.equal(r.address.country, 'USA');
  assert.deepEqual(r.address.city, MUNICIPIO_EXTERIOR);
  assert.equal(r.address.additionalInformation, 'MIAMI, FL');
  assert.equal(r.address.number, 'S/N');
  assert.equal('postalCode' in r.address, false);
  assert.deepEqual(camposFaltandoNoEndereco(EXTERIOR), []);
  assert.deepEqual(camposFaltandoNoEndereco({ ...EXTERIOR, rua: '' }), ['Endereço']);
});

test('CFOP de venda do cadastro vira o de exportacao equivalente', () => {
  assert.equal(cfopDeExportacaoSugerido('5101'), '7101');
  assert.equal(cfopDeExportacaoSugerido('6.102'), '7102');
  assert.equal(cfopDeExportacaoSugerido('7102'), '7102');
  assert.equal(cfopDeExportacaoSugerido('5405'), '5405');
});

test('exportacao: travas e grupo de embarque', () => {
  const base = { clienteNome: 'GLOBAL FOODS LLC', pais: 'USA', cfops: [7101, '7102'], ufEmbarque: 'sp', localEmbarque: 'PORTO DE SANTOS' };
  assert.deepEqual(montarExportacaoDaNota({ ...base, pais: '', cfops: [5102] }), { ok: true, exportacao: false });
  assert.deepEqual(montarExportacaoDaNota(base), { ok: true, exportacao: true, exportation: { state: 'sp', departureLocation: 'PORTO DE SANTOS' } });
  const brasilComCfop7 = montarExportacaoDaNota({ ...base, pais: '' });
  assert.equal(brasilComCfop7.ok, false);
  assert.match(!brasilComCfop7.ok ? brasilComCfop7.erro : '', /é do Brasil/);
  const misturado = montarExportacaoDaNota({ ...base, cfops: [7101, 6102] });
  assert.match(!misturado.ok ? misturado.erro : '', /todos os itens/);
  const semEmbarque = montarExportacaoDaNota({ ...base, localEmbarque: ' ' });
  assert.match(!semEmbarque.ok ? semEmbarque.erro : '', /local de embarque/);
  assert.equal(montarExportacaoDaNota({ ...base, ufEmbarque: 'EX' }).ok, false);
});

test('texto legal da exportacao nas informacoes complementares', () => {
  assert.equal(textoLegalDaExportacao([{ cfop: 5102 }]), '');
  assert.equal(
    textoLegalDaExportacao([{ cfop: 6501, taxes: { ipi: { cst: 55 } } }]),
    'Remessa com fim específico de exportação. ICMS: não incidência conforme art. 3º, II, e parágrafo único, II, da Lei Complementar 87/1996. IPI suspenso conforme o Regulamento do IPI.',
  );
  assert.equal(textoLegalDaExportacao([{ cfop: 7101 }]), 'ICMS: não incidência conforme art. 3º, II, da Lei Complementar 87/1996.');
});