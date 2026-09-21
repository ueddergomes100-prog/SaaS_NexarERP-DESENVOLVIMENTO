import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  motivoPedidoNaoEmiteNota,
  notaCancelada,
  notaDeveAparecer,
} from '../src/utils/notaFiscalVisibilidadeDomain';

const cancelados = new Set(['ped-cancelado']);

test('nota cancelada de verdade some, nas duas grafias', () => {
  assert.equal(notaCancelada('canceled'), true);
  assert.equal(notaCancelada('cancelled'), true);
  assert.equal(notaCancelada('authorized'), false);
  assert.equal(notaDeveAparecer({ status: 'canceled', pedidoId: 'p1' }, cancelados, false), false);
  assert.equal(notaDeveAparecer({ status: 'cancelled' }, cancelados, false), false);
});

test('nota que nao chegou a valer de pedido cancelado some', () => {
  for (const status of ['rejected', 'denied', 'enqueued', 'processing', 'created']) {
    assert.equal(notaDeveAparecer({ status, pedidoId: 'ped-cancelado' }, cancelados, false), false, status);
  }
});

test('nota AUTORIZADA nunca some, mesmo de pedido cancelado (ainda vale na SEFAZ)', () => {
  assert.equal(notaDeveAparecer({ status: 'authorized', pedidoId: 'ped-cancelado' }, cancelados, false), true);
});

test('nota comum, de pedido ativo ou sem pedido, continua aparecendo', () => {
  assert.equal(notaDeveAparecer({ status: 'rejected', pedidoId: 'ped-ok' }, cancelados, false), true);
  assert.equal(notaDeveAparecer({ status: 'authorized', pedidoId: 'ped-ok' }, cancelados, false), true);
  assert.equal(notaDeveAparecer({ status: 'rejected', pedidoId: null }, cancelados, false), true);
});

test('"Mostrar canceladas" traz tudo de volta', () => {
  assert.equal(notaDeveAparecer({ status: 'canceled' }, cancelados, true), true);
  assert.equal(notaDeveAparecer({ status: 'rejected', pedidoId: 'ped-cancelado' }, cancelados, true), true);
});

test('so pedido finalizado gera nota; pre-venda espera virar pedido', () => {
  assert.equal(motivoPedidoNaoEmiteNota('Finalizada'), null);
  assert.match(String(motivoPedidoNaoEmiteNota('Pré-venda')), /depois que ela virar pedido/);
  assert.match(String(motivoPedidoNaoEmiteNota('Cancelada')), /cancelado/);
  assert.match(String(motivoPedidoNaoEmiteNota('Em Análise')), /em análise/);
  assert.match(String(motivoPedidoNaoEmiteNota(undefined)), /não foi finalizado/);
});
