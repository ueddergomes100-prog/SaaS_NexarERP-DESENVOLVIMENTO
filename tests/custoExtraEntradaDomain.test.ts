import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aplicarCustoExtraEmTodos,
  comCustoExtra,
  erroDoCustoExtra,
  totalDoCustoExtra,
  valorDoCustoExtra,
} from '../src/utils/custoExtraEntradaDomain';

test('custo extra do item: % sobre o custo ou R$ da linha', () => {
  assert.equal(valorDoCustoExtra(200, { tipo: 'percentual', valor: 10 }), 20);
  assert.equal(valorDoCustoExtra(200, { tipo: 'valor', valor: 15.5 }), 15.5);
  assert.equal(valorDoCustoExtra(200, { tipo: 'valor', valor: -3 }), 0);
  assert.equal(valorDoCustoExtra(200, null), 0);
});

test('aplicar em todos: R$ rateado pelo custo de cada item, fechando no centavo', () => {
  const extras = aplicarCustoExtraEmTodos([100, 200, 0.01], 'valor', 10);
  const soma = extras.reduce((s, e) => s + e.valor, 0);
  assert.equal(Math.round(soma * 100), 1000);
  assert.ok(extras[1].valor > extras[0].valor, 'quem custou mais leva mais');
  assert.ok(extras.every((e) => e.tipo === 'valor'));
  const pct = aplicarCustoExtraEmTodos([100, 200], 'percentual', 5);
  assert.deepEqual(pct, [{ tipo: 'percentual', valor: 5 }, { tipo: 'percentual', valor: 5 }]);
});

test('custos com o extra: soma no custo total e no custo por unidade, nao no resto', () => {
  const custos = [{ custoTotal: 120, custoUnitarioNota: 10, valorProduto: 120 }, { custoTotal: 50, custoUnitarioNota: 25, valorProduto: 50 }];
  const r = comCustoExtra(custos, [{ tipo: 'valor', valor: 12 }, undefined], [12, 2]);
  assert.equal(r[0].custoTotal, 132);
  assert.equal(r[0].custoUnitarioNota, 11);
  assert.equal(r[0].custoExtra, 12);
  assert.equal(r[0].valorProduto, 120, 'o valor do produto da nota nao muda');
  assert.equal(r[1].custoTotal, 50);
  assert.equal(r[1].custoExtra, 0);
  assert.equal(totalDoCustoExtra(r), 12);
});

test('conferencia em portugues', () => {
  assert.equal(erroDoCustoExtra('valor', 10), null);
  assert.match(erroDoCustoExtra('valor', -1, 'CAIXA') || '', /CAIXA.*negativo/);
  assert.match(erroDoCustoExtra('percentual', 1000) || '', /digitação errada/);
});
