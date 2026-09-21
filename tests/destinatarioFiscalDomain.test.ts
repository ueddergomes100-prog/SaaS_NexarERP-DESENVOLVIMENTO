import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolverInscricaoEstadualDestinatario } from '../src/utils/destinatarioFiscalDomain';

const CNPJ = '07488550000140';
const CPF = '06859540648';

test('CNPJ com IE cadastrada: manda so os digitos', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: '062.307.904/0081' }), { valor: '0623079040081' });
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: ' 123456789 ' }), { valor: '123456789' });
});

test('CNPJ isento: manda ISENTO, em qualquer caixa', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: 'isento' }), { valor: 'ISENTO' });
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: 'ISENTO' }), { valor: 'ISENTO' });
});

test('CNPJ sem IE: bloqueia dizendo onde cadastrar, sem adivinhar', () => {
  const r = resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: '', clienteNome: 'NATUMAIS' });
  assert.equal(r.valor, undefined);
  assert.match(String(r.erro), /O cliente "NATUMAIS" é pessoa jurídica e não tem Inscrição Estadual cadastrada/);
  assert.match(String(r.erro), /Cadastros → Clientes/);
  assert.match(String(r.erro), /ISENTO/);
});

test('CNPJ com IE que nao parece valida: bloqueia citando o que esta la', () => {
  const r = resolverInscricaoEstadualDestinatario({ documento: CNPJ, identidade: 'abc', clienteNome: 'X' });
  assert.match(String(r.erro), /"abc"\) não parece válida/);
});

test('CPF: o campo e RG e nunca vai como IE', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CPF, identidade: 'MG-12.345.678' }), {});
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: CPF, identidade: '' }), {});
});

test('documento formatado tambem conta como CNPJ', () => {
  assert.deepEqual(resolverInscricaoEstadualDestinatario({ documento: '07.488.550/0001-40', identidade: '123456789' }), { valor: '123456789' });
});
