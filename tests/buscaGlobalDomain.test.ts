import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consultasDaBusca, fimDoPrefixo } from '../src/utils/buscaGlobalDomain';

test('nome: prefixo em maiusculas', () => {
  const c = consultasDaBusca('  maria sil ');
  assert.equal(c.prefixoNome, 'MARIA SIL');
  assert.deepEqual(c.codigosProduto, [], 'com espaco nao e codigo');
  assert.deepEqual(c.numerosOS, []);
  assert.equal(fimDoPrefixo('MARIA') > 'MARIA SILVA', true);
});

test('numero: codigo do produto em texto e numero, numero da OS com e sem zero a esquerda', () => {
  const c = consultasDaBusca('7');
  assert.deepEqual(c.codigosProduto, ['7', 7]);
  assert.deepEqual(c.numerosOS, ['7', '07']);
  assert.equal(c.codigoBarras, null, 'curto demais para codigo de barras');
  const c2 = consultasDaBusca('0012');
  assert.deepEqual(c2.numerosOS, ['0012', '12']);
});

test('codigo de barras so com 8 digitos ou mais', () => {
  assert.equal(consultasDaBusca('7891234567895').codigoBarras, '7891234567895');
  assert.equal(consultasDaBusca('789123').codigoBarras, null);
});

test('placa antiga e Mercosul, com e sem hifen', () => {
  assert.deepEqual(consultasDaBusca('abc-1234').placas, ['ABC1234', 'ABC-1234']);
  assert.deepEqual(consultasDaBusca('ABC1D23').placas, ['ABC1D23', 'ABC-1D23']);
  assert.deepEqual(consultasDaBusca('ABCD123').placas, []);
});

test('CPF e CNPJ: so digitos e com mascara', () => {
  assert.deepEqual(consultasDaBusca('123.456.789-01').documentos, ['12345678901', '123.456.789-01']);
  assert.deepEqual(consultasDaBusca('12345678000199').documentos, ['12345678000199', '12.345.678/0001-99']);
});

test('codigo alfanumerico vai em texto e maiusculas', () => {
  assert.deepEqual(consultasDaBusca('ab12').codigosProduto, ['ab12', 'AB12']);
});
