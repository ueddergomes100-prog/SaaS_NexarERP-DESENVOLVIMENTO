import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tomDoContador, tomDoStatusPedido } from '../src/utils/chipStatusDomain';

test('cada status do pedido tem a sua cor', () => {
  assert.equal(tomDoStatusPedido('Pré-venda'), 'azul');
  assert.equal(tomDoStatusPedido('Em Análise'), 'violeta');
  assert.equal(tomDoStatusPedido('Finalizada'), 'verde');
  assert.equal(tomDoStatusPedido('Cancelada'), 'cinza');
});

test('status legado que conta como venda fica verde, igual a venda finalizada', () => {
  assert.equal(tomDoStatusPedido('concluida'), 'verde');
  assert.equal(tomDoStatusPedido(undefined), 'verde');
});

test('contador zerado fica cinza; com pendencia, a cor pedida', () => {
  assert.equal(tomDoContador(0, 'verm'), 'cinza');
  assert.equal(tomDoContador(3, 'verm'), 'verm');
});
