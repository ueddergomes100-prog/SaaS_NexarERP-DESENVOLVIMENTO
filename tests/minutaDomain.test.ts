import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codigoENomeMinuta,
  condicaoPagamentoMinuta,
  enderecoMinuta,
  formatarCepMinuta,
  formatarDocumentoMinuta,
  formatarEmissaoMinuta,
  formatarGeradoEmMinuta,
  formatarQuantidadeMinuta,
  formatarTelefoneMinuta,
  formatarTotalPecasMinuta,
  rotuloDocumentoMinuta,
  vendedorMinuta,
} from '../src/utils/minutaDomain';

test('documento: CPF e CNPJ formatados; o resto fica como veio', () => {
  assert.equal(formatarDocumentoMinuta('06859540648'), '068.595.406-48');
  assert.equal(formatarDocumentoMinuta('12345678000199'), '12.345.678/0001-99');
  assert.equal(formatarDocumentoMinuta('123'), '123');
  assert.equal(formatarDocumentoMinuta(undefined), '');
  assert.equal(rotuloDocumentoMinuta('12345678000199'), 'CNPJ');
  assert.equal(rotuloDocumentoMinuta('06859540648'), 'CPF');
});

test('telefone e CEP formatados', () => {
  assert.equal(formatarTelefoneMinuta('3333333333'), '(33) 3333-3333');
  assert.equal(formatarTelefoneMinuta('33984145675'), '(33) 98414-5675');
  assert.equal(formatarTelefoneMinuta('4133'), '4133');
  assert.equal(formatarCepMinuta('36900000'), '36900-000');
  assert.equal(formatarCepMinuta('36900-000'), '36900-000');
});

test('quantidade com 4 casas e total de pecas com 2, como na minuta antiga', () => {
  assert.equal(formatarQuantidadeMinuta(5), '5,0000');
  assert.equal(formatarQuantidadeMinuta(0.26), '0,2600');
  assert.equal(formatarTotalPecasMinuta([{ quantidade: 5 }, { quantidade: 2 }, { quantidade: 3 }, { quantidade: 5 }]), '15,00');
  assert.equal(formatarTotalPecasMinuta([]), '0,00');
});

test('emissao e rodape usam o horario de Sao Paulo', () => {
  // 12:59Z = 09:59 em Sao Paulo
  const d = new Date('2026-09-21T12:59:31Z');
  assert.equal(formatarEmissaoMinuta(d), '21/09/2026 09:59');
  assert.equal(formatarGeradoEmMinuta(d), '21/09/2026 as 09:59:31');
  assert.equal(formatarEmissaoMinuta(null), '');
  assert.equal(formatarEmissaoMinuta(new Date('lixo')), '');
});

test('condicao de pagamento junta as formas sem repetir', () => {
  assert.equal(condicaoPagamentoMinuta([{ forma: 'Pix' }, { forma: 'Boleto' }, { forma: 'Pix' }]), 'Pix / Boleto');
  assert.equal(condicaoPagamentoMinuta([]), '');
  assert.equal(condicaoPagamentoMinuta(undefined), '');
});

test('codigo + nome, vendedor e endereco', () => {
  assert.equal(codigoENomeMinuta('2913', 'DAVI'), '2913 DAVI');
  assert.equal(codigoENomeMinuta('', 'DAVI'), 'DAVI');
  assert.equal(vendedorMinuta('1', 'DAVI JORGE'), '1 - DAVI JORGE');
  assert.equal(vendedorMinuta(undefined, 'DAVI JORGE'), 'DAVI JORGE');
  assert.equal(enderecoMinuta({ endereco: 'AV. TRINTA DE MARCO', numero: '22' }), 'AV. TRINTA DE MARCO, 22');
  assert.equal(enderecoMinuta({ endereco: 'AV. TRINTA DE MARCO' }), 'AV. TRINTA DE MARCO');
  assert.equal(enderecoMinuta(null), '');
});
