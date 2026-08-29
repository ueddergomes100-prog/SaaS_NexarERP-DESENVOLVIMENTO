import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apenasDigitos,
  formatarDocumento,
  isCnpjValido,
  isCpfValido,
  isDocumentoValido,
  mensagemDocumentoInvalido,
  tipoDocumento,
} from '../src/utils/documentoValidacao';

test('isCpfValido aceita CPF valido conhecido, com ou sem mascara', () => {
  assert.equal(isCpfValido('11144477735'), true);
  assert.equal(isCpfValido('111.444.777-35'), true);
});

test('isCpfValido recusa digito verificador errado', () => {
  assert.equal(isCpfValido('11144477736'), false);
});

test('isCpfValido recusa sequencia de digitos repetidos (nunca e CPF de verdade)', () => {
  assert.equal(isCpfValido('00000000000'), false);
  assert.equal(isCpfValido('11111111111'), false);
});

test('isCpfValido recusa tamanho errado', () => {
  assert.equal(isCpfValido('123456789'), false);
  assert.equal(isCpfValido(''), false);
});

test('isCnpjValido aceita CNPJ valido conhecido, com ou sem mascara', () => {
  assert.equal(isCnpjValido('11222333000181'), true);
  assert.equal(isCnpjValido('11.222.333/0001-81'), true);
});

test('isCnpjValido recusa digito verificador errado e sequencia repetida', () => {
  assert.equal(isCnpjValido('11222333000180'), false);
  assert.equal(isCnpjValido('11111111111111'), false);
});

test('tipoDocumento classifica por quantidade de digitos', () => {
  assert.equal(tipoDocumento('11144477735'), 'CPF');
  assert.equal(tipoDocumento('11222333000181'), 'CNPJ');
  assert.equal(tipoDocumento('123'), null);
});

test('isDocumentoValido trata documento em branco como valido (campo opcional)', () => {
  assert.equal(isDocumentoValido(''), true);
  assert.equal(isDocumentoValido('   '), true);
});

test('isDocumentoValido despacha pro validador certo conforme o tamanho', () => {
  assert.equal(isDocumentoValido('111.444.777-35'), true);
  assert.equal(isDocumentoValido('111.444.777-36'), false);
  assert.equal(isDocumentoValido('11.222.333/0001-81'), true);
  assert.equal(isDocumentoValido('123456'), false);
});

test('mensagemDocumentoInvalido devolve null quando esta tudo certo', () => {
  assert.equal(mensagemDocumentoInvalido(''), null);
  assert.equal(mensagemDocumentoInvalido('11144477735'), null);
  assert.equal(mensagemDocumentoInvalido('11222333000181'), null);
});

test('mensagemDocumentoInvalido explica o problema em portugues', () => {
  assert.match(mensagemDocumentoInvalido('123456') || '', /11.*CNPJ.*14/);
  assert.match(mensagemDocumentoInvalido('11144477736') || '', /CPF inválido/);
  assert.match(mensagemDocumentoInvalido('11222333000180') || '', /CNPJ inválido/);
});

test('formatarDocumento aplica a mascara certa por tamanho, sem mexer no que nao reconhece', () => {
  assert.equal(formatarDocumento('11144477735'), '111.444.777-35');
  assert.equal(formatarDocumento('11222333000181'), '11.222.333/0001-81');
  assert.equal(formatarDocumento('123'), '123');
});

test('apenasDigitos tira qualquer coisa que nao seja numero', () => {
  assert.equal(apenasDigitos('111.444.777-35'), '11144477735');
  assert.equal(apenasDigitos(''), '');
});
