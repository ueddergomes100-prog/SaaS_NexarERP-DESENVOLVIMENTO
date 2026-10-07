import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEQUENCIAS_DE_DOCUMENTOS,
  lerValorDeSequencia,
  sequenciaPelaChave,
  ultimoNumeroUsado,
  validarNovoProximo,
} from '../src/utils/numeracaoDomain';

test('lista de sequencias: chaves unicas, boleto fora, pedido de venda presente', () => {
  const chaves = SEQUENCIAS_DE_DOCUMENTOS.map((s) => s.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  assert.equal(chaves.some((c) => /boleto/.test(c)), false);
  assert.equal(sequenciaPelaChave('pedidos_venda')?.campo, 'numeroPedido');
  assert.equal(sequenciaPelaChave('boleto_remessa_x'), null);
});

test('ultimo numero usado = maior entre sequencia, legado e gravado; lixo vira 0', () => {
  assert.equal(lerValorDeSequencia('0079'), 79);
  assert.equal(lerValorDeSequencia(undefined), 0);
  assert.equal(lerValorDeSequencia('abc'), 0);
  assert.equal(ultimoNumeroUsado(79, 67, '0081'), 81);
  assert.equal(ultimoNumeroUsado(undefined, undefined, undefined), 0);
});

test('adiantar a numeracao: so inteiro maior que o ultimo; nunca volta; mensagens em portugues', () => {
  assert.deepEqual(validarNovoProximo('80', 79, 'Pedido de venda'), { ok: true, valorDaSequencia: 79 });
  assert.deepEqual(validarNovoProximo('75.713', 79, 'Pedido de venda'), { ok: true, valorDaSequencia: 75712 });
  const volta = validarNovoProximo('50', 79, 'Pedido de venda');
  assert.equal(volta.ok, false);
  if (!volta.ok) assert.match(volta.erro, /último pedido de venda gravado é o nº 79.*precisa ser 80 ou maior/);
  const igual = validarNovoProximo('79', 79, 'Pedido de venda');
  assert.equal(igual.ok, false);
  const ruim = validarNovoProximo('abc', 79, 'Orçamento');
  assert.equal(ruim.ok, false);
  if (!ruim.ok) assert.match(ruim.erro, /próximo número de orçamento/);
  assert.equal(validarNovoProximo('0', 0, 'Troca').ok, false);
  assert.equal(validarNovoProximo('1', 0, 'Troca').ok, true);
  assert.equal(validarNovoProximo('9999999999', 0, 'Troca').ok, false);
});
