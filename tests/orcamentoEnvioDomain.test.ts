import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mensagemDoOrcamentoParaCliente,
  nomeDaEmpresaNoDocumento,
  numeroDoOrcamentoParaTexto,
} from '../src/utils/orcamentoEnvioDomain.js';

test('envio do orcamento: mensagem em nome da empresa, nunca "Hennder ERP" (23/11/2026)', () => {
  const texto = mensagemDoOrcamentoParaCliente({ numero: 12, empresa: 'JOMARLY MATERIAIS DE CONSTRUCAO', total: 1234.5 });
  assert.match(texto, /orçamento nº 0012 da \*JOMARLY MATERIAIS DE CONSTRUCAO\*/);
  assert.match(texto, /R\$\s?1\.234,50/);
  assert.match(texto, /PDF/);
  assert.doesNotMatch(texto, /Hennder|Nexus|Nexar/i);
});

test('envio do orcamento: com link, o PDF vai como link na mensagem (wa.me nao aceita anexo)', () => {
  const link = 'https://firebasestorage.googleapis.com/v0/b/x/o/empresas%2Ft%2Forcamentos%2Fa%2F1.pdf?alt=media&token=abc';
  const texto = mensagemDoOrcamentoParaCliente({ numero: 1, empresa: 'Jomarly Materiais de Construção', total: 16478, link });
  assert.ok(texto.includes(`Orçamento completo em PDF:\n${link}`));
  assert.doesNotMatch(texto, /em anexo/);
  assert.match(texto, /Aguardamos sua aprovação!$/);
});

test('envio do orcamento: sem nome de empresa no cadastro, a mensagem nao cita empresa nenhuma', () => {
  const texto = mensagemDoOrcamentoParaCliente({ numero: '7', empresa: '', total: 10 });
  assert.match(texto, /^Olá! Segue o orçamento nº 0007\./);
  assert.doesNotMatch(texto, /\*\*/);
});

test('envio do orcamento: nome da empresa = nome no cadastro, senao fantasia, senao razao social', () => {
  assert.equal(nomeDaEmpresaNoDocumento({ nomeOficina: ' LOJA X ', razaoSocial: 'LOJA X LTDA' }), 'LOJA X');
  assert.equal(nomeDaEmpresaNoDocumento({ nomeFantasia: 'FANTASIA', razaoSocial: 'RAZAO LTDA' }), 'FANTASIA');
  assert.equal(nomeDaEmpresaNoDocumento({ razaoSocial: 'RAZAO LTDA' }), 'RAZAO LTDA');
  assert.equal(nomeDaEmpresaNoDocumento(null), '');
  assert.equal(nomeDaEmpresaNoDocumento({ nomeOficina: 123 }), '');
});

test('envio do orcamento: numero com 4 digitos; texto livre fica como esta', () => {
  assert.equal(numeroDoOrcamentoParaTexto(5), '0005');
  assert.equal(numeroDoOrcamentoParaTexto('12345'), '12345');
  assert.equal(numeroDoOrcamentoParaTexto('ABC123'), 'ABC123');
  assert.equal(numeroDoOrcamentoParaTexto(undefined), '');
});
