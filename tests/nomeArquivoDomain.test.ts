import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nomeArquivoDocumento } from '../src/utils/nomeArquivoDomain';

test('NF-e: tipo, numero com 6 digitos e destinatario', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 40, destinatario: 'JL SUPERMERCADOS LTDA' }), 'NFE 000040 - JL SUPERMERCADOS LTDA.pdf');
});

test('boleto: nosso numero com traco fica como esta', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'BOLETO', numero: '2037-6', destinatario: 'JL SUPERMERCADO LTDA' }), 'BOLETO 2037-6 - JL SUPERMERCADO LTDA.pdf');
});

test('tira caractere que o Windows nao aceita e espacos repetidos', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 7, destinatario: 'H.R.R DROGARIA/PERF: "LTDA" <EPP>  ' }), 'NFE 000007 - H.R.R DROGARIA PERF LTDA EPP.pdf');
});

test('sem numero ou sem destinatario nao deixa traco sobrando', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', destinatario: 'CLIENTE' }), 'NFE - CLIENTE.pdf');
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 12 }), 'NFE 000012.pdf');
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 12, destinatario: 'X', extensao: 'xml' }), 'NFE 000012 - X.xml');
});

test('nome gigante e cortado sem terminar em ponto ou espaco', () => {
  const nome = nomeArquivoDocumento({ tipo: 'NFE', numero: 1, destinatario: 'A'.repeat(300) });
  assert.ok(nome.length <= 124);
  assert.ok(nome.endsWith('.pdf'));
});
