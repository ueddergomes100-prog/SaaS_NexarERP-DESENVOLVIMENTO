import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularProgressoMeta,
  faltaParaMeta,
  parseMetaFaturamentoMensal,
  temMetaFaturamento,
} from '../src/utils/metaFaturamentoDomain';

test('parseMetaFaturamentoMensal aceita numero positivo e recusa o resto', () => {
  assert.equal(parseMetaFaturamentoMensal(50000), 50000);
  assert.equal(parseMetaFaturamentoMensal('50000'), 50000);
  assert.equal(parseMetaFaturamentoMensal(0), 0);
  assert.equal(parseMetaFaturamentoMensal(-100), 0);
  assert.equal(parseMetaFaturamentoMensal(null), 0);
  assert.equal(parseMetaFaturamentoMensal(undefined), 0);
  assert.equal(parseMetaFaturamentoMensal('abc'), 0);
});

test('temMetaFaturamento so e verdadeiro com meta positiva cadastrada', () => {
  assert.equal(temMetaFaturamento(50000), true);
  assert.equal(temMetaFaturamento(0), false);
  assert.equal(temMetaFaturamento(undefined), false);
});

test('calcularProgressoMeta devolve null (nao 0) quando NAO ha meta -- "nada a medir" e diferente de "0% da meta"', () => {
  assert.equal(calcularProgressoMeta(10000, 0), null);
  assert.equal(calcularProgressoMeta(10000, undefined), null);
});

test('calcularProgressoMeta calcula o percentual atingido', () => {
  assert.equal(calcularProgressoMeta(25000, 50000), 50);
  assert.equal(calcularProgressoMeta(50000, 50000), 100);
  assert.equal(calcularProgressoMeta(0, 50000), 0);
});

test('calcularProgressoMeta PASSA de 100 quando a meta e superada -- bater e superar nao podem parecer igual', () => {
  assert.equal(calcularProgressoMeta(59000, 50000), 118);
  assert.equal(calcularProgressoMeta(100000, 50000), 200);
});

test('calcularProgressoMeta trata faturamento negativo/invalido como zero', () => {
  assert.equal(calcularProgressoMeta(-500, 50000), 0);
  assert.equal(calcularProgressoMeta(Number.NaN, 50000), 0);
});

test('faltaParaMeta devolve o que resta, nunca negativo', () => {
  assert.equal(faltaParaMeta(20000, 50000), 30000);
  assert.equal(faltaParaMeta(50000, 50000), 0);
  assert.equal(faltaParaMeta(80000, 50000), 0);
});

test('faltaParaMeta sem meta cadastrada e zero', () => {
  assert.equal(faltaParaMeta(20000, 0), 0);
  assert.equal(faltaParaMeta(20000, undefined), 0);
});
