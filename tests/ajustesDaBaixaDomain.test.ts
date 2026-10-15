import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ajustesDoPedido,
  camposDosAjustes,
  centavosDoCampo,
  descricaoDosAjustes,
  erroDosAjustes,
  SEM_AJUSTES,
  textoDoCampo,
  valorPagoDaBaixa,
} from '../src/utils/ajustesDaBaixaDomain';

test('campo em reais vira centavos; vazio e\' zero; texto errado e\' null', () => {
  assert.equal(centavosDoCampo('12,50'), 1250);
  assert.equal(centavosDoCampo('1.234,56'), 123456);
  assert.equal(centavosDoCampo('R$ 7'), 700);
  assert.equal(centavosDoCampo('12.5'), 1250);
  assert.equal(centavosDoCampo(''), 0);
  assert.equal(centavosDoCampo('  '), 0);
  assert.equal(centavosDoCampo('abc'), null);
  assert.equal(centavosDoCampo('-5'), null);
  assert.equal(centavosDoCampo('1,234'), null);
  assert.equal(textoDoCampo(1250), '12,50');
  assert.equal(textoDoCampo(0), '');
});

test('valor pago = conta + juros + multa - desconto', () => {
  assert.equal(valorPagoDaBaixa(10000, { jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 500 }), 9850);
  assert.equal(valorPagoDaBaixa(10000, SEM_AJUSTES), 10000);
});

test('desconto pede a permissao propria e nao pode levar a conta inteira; juros absurdo e\' barrado', () => {
  const comDesconto = { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 500 };
  assert.match(erroDosAjustes(10000, comDesconto, { podeDescontar: false }) || '', /dar desconto na baixa/);
  assert.equal(erroDosAjustes(10000, comDesconto, { podeDescontar: true }), null);
  assert.match(erroDosAjustes(10000, { ...comDesconto, descontoCentavos: 10000 }, { podeDescontar: true }) || '', /cancele a conta/);
  assert.match(erroDosAjustes(1000, { jurosCentavos: 500000, multaCentavos: 0, descontoCentavos: 0 }, { podeDescontar: false }) || '', /muito acima/);
  assert.match(erroDosAjustes(1000, { jurosCentavos: -1, multaCentavos: 0, descontoCentavos: 0 }, { podeDescontar: false }) || '', /^Juros:/);
  // Sem desconto, a permissao nao importa.
  assert.equal(erroDosAjustes(1000, { jurosCentavos: 10, multaCentavos: 20, descontoCentavos: 0 }, { podeDescontar: false }), null);
});

test('pedido do servidor: tres campos inteiros; o campo antigo de juros e multa vale como juros', () => {
  assert.deepEqual(ajustesDoPedido({ jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50 }).ajustes, { jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50 });
  assert.deepEqual(ajustesDoPedido({ acrescimoCentavos: 350 }).ajustes, { jurosCentavos: 350, multaCentavos: 0, descontoCentavos: 0 });
  assert.deepEqual(ajustesDoPedido({}).ajustes, SEM_AJUSTES);
  assert.ok(ajustesDoPedido({ descontoCentavos: 1.5 }).erro);
  assert.ok(ajustesDoPedido({ jurosCentavos: -3 }).erro);
});

test('so\' o que tem valor vai ao servidor; descricao para o log', () => {
  assert.deepEqual(camposDosAjustes({ jurosCentavos: 0, multaCentavos: 200, descontoCentavos: 0 }), { multaCentavos: 200 });
  assert.deepEqual(camposDosAjustes(SEM_AJUSTES), {});
  const texto = descricaoDosAjustes({ jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50 }).replace(/\s/g, ' ');
  assert.equal(texto, 'juros R$ 1,50 + multa R$ 2,00 − desconto R$ 0,50');
  assert.equal(descricaoDosAjustes({ jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 50 }).replace(/\s/g, ' '), 'desconto R$ 0,50');
  assert.equal(descricaoDosAjustes(SEM_AJUSTES), '');
});
