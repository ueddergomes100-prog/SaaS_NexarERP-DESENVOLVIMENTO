import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abasParaSalvar, donoDasAbas, lerAbasSalvas } from '../src/utils/abasSalvasDomain';

const abas = { tabs: [{ id: 't1', path: '/pedidos-venda/0044', label: 'Pedido 0044' }], activeTabId: 't1' };

test('abas salvas: voltam para o mesmo usuario na mesma empresa', () => {
  const dono = donoDasAbas('u1', 'empresaA');
  assert.deepEqual(lerAbasSalvas(abasParaSalvar(abas, dono), dono), abas);
});

test('abas salvas: nao voltam para outra conta no mesmo navegador (conta nova, outra empresa)', () => {
  const salvo = abasParaSalvar(abas, donoDasAbas('u1', 'empresaA'));
  assert.equal(lerAbasSalvas(salvo, donoDasAbas('u2', 'empresaB')), null);
});

test('abas salvas: nao voltam para o mesmo usuario em outra empresa, nem para outro usuario da mesma empresa', () => {
  const salvo = abasParaSalvar(abas, donoDasAbas('u1', 'empresaA'));
  assert.equal(lerAbasSalvas(salvo, donoDasAbas('u1', 'empresaB')), null);
  assert.equal(lerAbasSalvas(salvo, donoDasAbas('u2', 'empresaA')), null);
});

test('abas salvas: gravadas antes da regra (sem dono) nao voltam', () => {
  assert.equal(lerAbasSalvas(JSON.stringify(abas), donoDasAbas('u1', 'empresaA')), null);
});

test('abas salvas: nada salvo, conteudo quebrado ou lista vazia nao restaura nada', () => {
  const dono = donoDasAbas('u1', 'empresaA');
  assert.equal(lerAbasSalvas(null, dono), null);
  assert.equal(lerAbasSalvas('{quebrado', dono), null);
  assert.equal(lerAbasSalvas('null', dono), null);
  assert.equal(lerAbasSalvas(abasParaSalvar({ tabs: [], activeTabId: '' }, dono), dono), null);
});

test('abas salvas: o dono nunca fica com "undefined" no texto', () => {
  assert.equal(donoDasAbas(undefined, null), '|');
});
