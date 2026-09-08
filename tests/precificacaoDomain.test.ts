import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compararMargem,
  margemMarkup,
  precoParaMargem,
} from '../src/utils/precificacaoDomain';

test('margemMarkup e sobre o custo, nao sobre a venda', () => {
  // custo 44, venda 79,20 -> 80% de markup
  assert.equal(Math.round(margemMarkup(79.2, 44) * 10) / 10, 80);
});

test('margemMarkup sem custo devolve 0 em vez de dividir por zero', () => {
  assert.equal(margemMarkup(100, 0), 0);
});

test('precoParaMargem e o inverso de margemMarkup', () => {
  const preco = precoParaMargem(44, 80);
  assert.equal(Math.round(preco * 100) / 100, 79.2);
  assert.equal(Math.round(margemMarkup(preco, 44) * 10) / 10, 80);
});

test('custo subiu depois da precificacao: margem caiu', () => {
  // preco 79,20 definido quando o custo era 44 (80%); hoje o custo e 52
  const comparacao = compararMargem(79.2, 44, 52);
  assert.ok(comparacao);
  assert.equal(comparacao!.direcao, 'caiu');
  assert.equal(Math.round(comparacao!.margemAnterior * 10) / 10, 80);
  assert.equal(Math.round(comparacao!.margemAtual * 10) / 10, 52.3);
  assert.ok(comparacao!.diferencaPontos < 0);
});

test('custo caiu depois da precificacao: margem subiu', () => {
  const comparacao = compararMargem(79.2, 44, 40);
  assert.ok(comparacao);
  assert.equal(comparacao!.direcao, 'subiu');
  assert.ok(comparacao!.diferencaPontos > 0);
});

test('mesma base e mesmo custo: manteve, sem alarme falso', () => {
  const comparacao = compararMargem(79.2, 44, 44);
  assert.equal(comparacao!.direcao, 'manteve');
});

test('diferenca de centavo por arredondamento nao acusa mudanca', () => {
  const comparacao = compararMargem(79.2, 44, 44.004);
  assert.equal(comparacao!.direcao, 'manteve');
});

test('produto sem base gravada (precificado antes do recurso) nao gera aviso', () => {
  assert.equal(compararMargem(79.2, null, 52), null);
  assert.equal(compararMargem(79.2, undefined, 52), null);
  assert.equal(compararMargem(79.2, 0, 52), null);
});

test('produto sem preco ou sem custo atual nao gera aviso', () => {
  assert.equal(compararMargem(0, 44, 52), null);
  assert.equal(compararMargem(79.2, 44, 0), null);
});
