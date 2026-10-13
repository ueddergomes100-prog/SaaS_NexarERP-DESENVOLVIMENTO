import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  campoSeguinte,
  interpretarDesconto,
  interpretarPreco,
  interpretarQuantidade,
  lerNumero,
  localizarProdutoPorCodigo,
  textoParaEdicao,
} from '../src/utils/itensVendaDomain';

const catalogo = [
  { id: 'a', nome: 'ACUCAR MASCAVO 500G', codigo: '1', codigoBarras: '7891000000001', precoVenda: 4.7, quantidade: 10 },
  { id: 'b', nome: 'CASTANHA DE CAJU 60G', codigo: '10', referencia: 'CAJ-60', precoVenda: 9.9, quantidade: 3 },
  { id: 'c', nome: 'INATIVO', codigo: '99', precoVenda: 1, quantidade: 1, ativo: false },
];

test('codigo exato acha o produto; prefixo nao; inativo nunca', () => {
  assert.equal(localizarProdutoPorCodigo(catalogo, '1')?.id, 'a');
  assert.equal(localizarProdutoPorCodigo(catalogo, '10')?.id, 'b');
  assert.equal(localizarProdutoPorCodigo(catalogo, ' 10 ')?.id, 'b');
  assert.equal(localizarProdutoPorCodigo(catalogo, '7891000000001')?.id, 'a');
  assert.equal(localizarProdutoPorCodigo(catalogo, 'caj-60')?.id, 'b');
  assert.equal(localizarProdutoPorCodigo(catalogo, '99'), null);
  assert.equal(localizarProdutoPorCodigo(catalogo, '100'), null);
  assert.equal(localizarProdutoPorCodigo(catalogo, ''), null);
});

test('numeros no jeito brasileiro e no jeito do teclado', () => {
  assert.equal(lerNumero('1.234,56'), 1234.56);
  assert.equal(lerNumero('12,5'), 12.5);
  assert.equal(lerNumero('12.5'), 12.5);
  assert.equal(lerNumero('3'), 3);
  assert.ok(Number.isNaN(lerNumero('')));
  assert.ok(Number.isNaN(lerNumero('abc')));
});

test('quantidade e preco: so maior que zero', () => {
  assert.deepEqual(interpretarQuantidade('2,5'), { valor: 2.5, erro: null });
  assert.match(interpretarQuantidade('0').erro || '', /maior que zero/);
  assert.match(interpretarQuantidade('x').erro || '', /maior que zero/);
  assert.deepEqual(interpretarPreco('R$ 4,70'), { valor: 4.7, erro: null });
  assert.equal(interpretarPreco('4.705').valor, 4.71);
  assert.match(interpretarPreco('-1').erro || '', /maior que zero/);
});

test('desconto em reais ou em percentual, nunca acima do item', () => {
  assert.deepEqual(interpretarDesconto('', 100), { valor: 0, erro: null });
  assert.deepEqual(interpretarDesconto('-', 100), { valor: 0, erro: null });
  assert.deepEqual(interpretarDesconto('5', 100), { valor: 5, erro: null });
  assert.deepEqual(interpretarDesconto('10%', 47), { valor: 4.7, erro: null });
  assert.deepEqual(interpretarDesconto('100%', 47), { valor: 47, erro: null });
  assert.match(interpretarDesconto('101%', 47).erro || '', /100%/);
  assert.match(interpretarDesconto('50', 47).erro || '', /maior que o valor/);
  assert.match(interpretarDesconto('abc', 47).erro || '', /inválido/);
});

test('tab anda quantidade -> preco -> desconto (ou para no preco sem desconto por item)', () => {
  assert.equal(campoSeguinte('quantidade', true), 'precoUnitario');
  assert.equal(campoSeguinte('precoUnitario', true), 'desconto');
  assert.equal(campoSeguinte('desconto', true), null);
  assert.equal(campoSeguinte('precoUnitario', false), null);
});

test('texto da celula em edicao', () => {
  const item = { quantidade: 2.5, precoUnitario: 4.7, desconto: 0 };
  assert.equal(textoParaEdicao('quantidade', item), '2,5');
  assert.equal(textoParaEdicao('precoUnitario', item), '4,70');
  assert.equal(textoParaEdicao('desconto', item), '');
  assert.equal(textoParaEdicao('desconto', { ...item, desconto: 1.5 }), '1,50');
});
