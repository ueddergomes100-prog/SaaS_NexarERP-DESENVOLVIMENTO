import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nomeArquivoDocumento, numeroDaNota } from '../src/utils/nomeArquivoDomain';

test('NF-e: tipo, numero sem zeros a esquerda e destinatario (15/10/2026: 93, nao 000093)', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 40, destinatario: 'JL SUPERMERCADOS LTDA' }), 'NFE 40 - JL SUPERMERCADOS LTDA.pdf');
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: '000093', destinatario: 'SOL LIFE' }), 'NFE 93 - SOL LIFE.pdf');
});

test('boleto: nosso numero com traco fica como esta', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'BOLETO', numero: '2037-6', destinatario: 'JL SUPERMERCADO LTDA' }), 'BOLETO 2037-6 - JL SUPERMERCADO LTDA.pdf');
});

test('tira caractere que o Windows nao aceita e espacos repetidos', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 7, destinatario: 'H.R.R DROGARIA/PERF: "LTDA" <EPP>  ' }), 'NFE 7 - H.R.R DROGARIA PERF LTDA EPP.pdf');
});

test('sem numero ou sem destinatario nao deixa traco sobrando', () => {
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', destinatario: 'CLIENTE' }), 'NFE - CLIENTE.pdf');
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 12 }), 'NFE 12.pdf');
  assert.equal(nomeArquivoDocumento({ tipo: 'NFE', numero: 12, destinatario: 'X', extensao: 'xml' }), 'NFE 12 - X.xml');
});

test('nome gigante e cortado sem terminar em ponto ou espaco', () => {
  const nome = nomeArquivoDocumento({ tipo: 'NFE', numero: 1, destinatario: 'A'.repeat(300) });
  assert.ok(nome.length <= 124);
  assert.ok(nome.endsWith('.pdf'));
});

test('numero da nota como o cliente le: sem zeros a esquerda', () => {
  assert.equal(numeroDaNota(93), '93');
  assert.equal(numeroDaNota('0000093'), '93');
  assert.equal(numeroDaNota('000100'), '100');
  assert.equal(numeroDaNota('0'), '0');
  assert.equal(numeroDaNota(' 94 '), '94');
  assert.equal(numeroDaNota('2037-6'), '2037-6', 'texto que nao e so digito fica como veio');
  assert.equal(numeroDaNota(null), '');
  assert.equal(numeroDaNota(undefined), '');
  assert.equal(numeroDaNota(''), '');
});
