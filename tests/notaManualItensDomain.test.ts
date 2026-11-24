import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adicionarProdutoNaNotaManual,
  descricaoDaNotaManual,
  lerNumeroDigitado,
  totalDaLinhaManual,
  totalDaNotaManual,
  validarItensDaNotaManual,
  type ItemDaNotaManual,
} from '../src/utils/notaManualItensDomain';

const id = (base: ItemDaNotaManual) => base;

test('escolher o produto entra com o preco de venda e soma o total', () => {
  const r1 = adicionarProdutoNaNotaManual([], { id: 'p1', nome: 'SACO 50KG', precoVenda: 12.5, unidadeMedidaSigla: 'UN' }, id);
  assert.equal(r1.itens.length, 1);
  assert.equal(r1.itens[0].precoUnitario, 12.5);
  assert.equal(r1.itens[0].quantidade, 1);
  assert.equal(r1.semUnidade, false);
  const r2 = adicionarProdutoNaNotaManual(r1.itens, { id: 'p2', nome: 'FITA', precoVenda: '3.33' }, id);
  assert.equal(totalDaNotaManual(r2.itens), 15.83);
  assert.equal(r2.semUnidade, true, 'sem unidade no cadastro: a tela avisa');
  assert.equal(r2.itens[1].unidadeMedidaSigla, 'UN', 'entra como UN (regra do CLAUDE.md)');
});

test('o mesmo produto de novo soma na linha', () => {
  const r1 = adicionarProdutoNaNotaManual([], { id: 'p1', nome: 'A', precoVenda: 10 }, id);
  const r2 = adicionarProdutoNaNotaManual(r1.itens, { id: 'p1', nome: 'A', precoVenda: 10 }, id);
  assert.equal(r2.itens.length, 1);
  assert.equal(r2.itens[0].quantidade, 2);
  assert.equal(r2.itens[0].valorTotal, 20);
  assert.equal(r2.somouNaLinha, true);
});

test('linha: quantidade x preco arredondado como a nota, menos desconto', () => {
  assert.equal(totalDaLinhaManual({ quantidade: 3, precoUnitario: 81.445, desconto: 0 }), 244.34);
  assert.equal(totalDaLinhaManual({ quantidade: 2, precoUnitario: 10, desconto: 1.5 }), 18.5);
});

test('conferencia em portugues dizendo o que fazer', () => {
  assert.match(validarItensDaNotaManual([]) || '', /Escolha pelo menos um produto/);
  const base: ItemDaNotaManual = { id: 'p', nome: 'CAIXA', quantidade: 1, precoUnitario: 5, desconto: 0, valorTotal: 5, unidadeMedidaSigla: 'UN', unidadeMedidaFracionado: false, unidadeMedidaCasasDecimais: 0 };
  assert.equal(validarItensDaNotaManual([base]), null);
  assert.match(validarItensDaNotaManual([{ ...base, quantidade: 1.5 }]) || '', /inteira/);
  assert.equal(validarItensDaNotaManual([{ ...base, quantidade: 1.5, unidadeMedidaFracionado: true, unidadeMedidaCasasDecimais: 3, unidadeMedidaSigla: 'KG' }]), null);
  assert.match(validarItensDaNotaManual([{ ...base, precoUnitario: 0 }]) || '', /preço de "CAIXA"/);
  assert.match(validarItensDaNotaManual([{ ...base, desconto: 5 }]) || '', /desconto/);
});

test('numero digitado com virgula e descricao curta', () => {
  assert.equal(lerNumeroDigitado('1.234,56'), 1234.56);
  assert.equal(lerNumeroDigitado('12,5'), 12.5);
  assert.equal(lerNumeroDigitado('12.5'), 12.5);
  assert.equal(lerNumeroDigitado(''), 0);
  assert.equal(descricaoDaNotaManual([{ nome: 'A', quantidade: 2 }, { nome: 'B', quantidade: 1.5 }]), '2x A, 1,5x B');
  assert.equal(descricaoDaNotaManual([]), '');
});
