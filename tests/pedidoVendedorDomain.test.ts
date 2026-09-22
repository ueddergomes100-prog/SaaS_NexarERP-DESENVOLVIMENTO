import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OBSERVACAO_PEDIDO_MAX,
  clienteComCodigo,
  camposDeEnderecoQueFaltam,
  comNotaFiscalDaEscolha,
  enderecoEmLinhas,
  erroDaEscolhaNotaFiscal,
  escolhaDaNotaFiscal,
  normalizarObservacaoPedido,
  rotuloNotaFiscalPedido,
} from '../src/utils/pedidoVendedorDomain';

const COMPLETO = { endereco: 'RUA A', numero: '10', bairro: 'CENTRO', cidade: 'MANHUACU', estado: 'mg', cep: '36940000' };

test('endereco completo vira tres linhas, CEP formatado e UF em caixa alta', () => {
  assert.deepEqual(enderecoEmLinhas(COMPLETO), ['RUA A, 10 - CENTRO', 'MANHUACU - MG', 'CEP 36940-000']);
});

test('pedaco que falta some da linha, sem virgula nem "undefined"', () => {
  assert.deepEqual(enderecoEmLinhas({ endereco: 'RUA A', cidade: 'MANHUACU', estado: 'MG' }), ['RUA A', 'MANHUACU - MG']);
  assert.deepEqual(enderecoEmLinhas({ endereco: 'RUA A', numero: '10' }), ['RUA A, 10']);
  assert.deepEqual(enderecoEmLinhas({ bairro: 'CENTRO' }), ['CENTRO']);
  assert.deepEqual(enderecoEmLinhas({}), []);
  assert.deepEqual(enderecoEmLinhas({ endereco: null, numero: undefined, cep: '' }), []);
});

test('CEP: com mascara ou so digitos formata igual; incompleto aparece como veio', () => {
  assert.deepEqual(enderecoEmLinhas({ cep: '36.940-000' }), ['CEP 36940-000']);
  assert.deepEqual(enderecoEmLinhas({ cep: '3694' }), ['CEP 3694']);
});

test('cadastro completo nao falta nada', () => {
  assert.deepEqual(camposDeEnderecoQueFaltam(COMPLETO), []);
});

test('lista o que falta no endereco, na ordem da tela', () => {
  assert.deepEqual(camposDeEnderecoQueFaltam({}), ['rua', 'número', 'bairro', 'cidade', 'estado', 'CEP']);
  assert.deepEqual(camposDeEnderecoQueFaltam({ ...COMPLETO, numero: '', cep: '3694' }), ['número', 'CEP']);
  assert.deepEqual(camposDeEnderecoQueFaltam({ ...COMPLETO, estado: 'M' }), ['estado']);
});

test('escolha COM/SEM vira o booleano gravado e volta', () => {
  assert.equal(comNotaFiscalDaEscolha('com'), true);
  assert.equal(comNotaFiscalDaEscolha('sem'), false);
  assert.equal(escolhaDaNotaFiscal(true), 'com');
  assert.equal(escolhaDaNotaFiscal(false), 'sem');
});

test('empresa que controla nota fiscal exige a marcacao; a que nao controla nao pergunta', () => {
  assert.match(erroDaEscolhaNotaFiscal(null, true) ?? '', /COM nota fiscal ou SEM nota fiscal/);
  assert.match(erroDaEscolhaNotaFiscal(undefined, true) ?? '', /Marque/);
  assert.equal(erroDaEscolhaNotaFiscal('com', true), null);
  assert.equal(erroDaEscolhaNotaFiscal('sem', true), null);
  assert.equal(erroDaEscolhaNotaFiscal(null, false), null);
});

test('rotulo na retaguarda: COM, SEM, e nada quando o pedido nao informa', () => {
  assert.deepEqual(rotuloNotaFiscalPedido(true), { texto: 'COM NOTA FISCAL', tom: 'com' });
  assert.deepEqual(rotuloNotaFiscalPedido(false), { texto: 'SEM NOTA FISCAL', tom: 'sem' });
  for (const nulo of [undefined, null, '', 'true', 1, 0]) assert.equal(rotuloNotaFiscalPedido(nulo), null, String(nulo));
});

test('observacao: espaco e quebra de linha viram um espaco so e corta no limite', () => {
  assert.equal(normalizarObservacaoPedido('  Entregar\n\n de   manha\t '), 'Entregar de manha');
  assert.equal(normalizarObservacaoPedido(''), '');
  assert.equal(normalizarObservacaoPedido('x'.repeat(OBSERVACAO_PEDIDO_MAX + 50)).length, OBSERVACAO_PEDIDO_MAX);
});

test('codigo do cliente sai junto do nome, e some quando nao existe', () => {
  assert.equal(clienteComCodigo({ codigo: '0123', nome: 'MERCADO SAO JOSE' }), '0123 · MERCADO SAO JOSE');
  assert.equal(clienteComCodigo({ nome: 'MERCADO SAO JOSE' }), 'MERCADO SAO JOSE');
  assert.equal(clienteComCodigo({ codigo: '', nome: 'MERCADO SAO JOSE' }), 'MERCADO SAO JOSE');
  assert.equal(clienteComCodigo({ codigo: '   ', nome: 'MERCADO SAO JOSE' }), 'MERCADO SAO JOSE');
});

test('codigo do cliente: nada de separador solto nem "undefined" na tela', () => {
  assert.equal(clienteComCodigo({ codigo: '0123' }), '0123');
  assert.equal(clienteComCodigo({}), '');
  assert.equal(clienteComCodigo(null), '');
  assert.equal(clienteComCodigo(undefined), '');
});
