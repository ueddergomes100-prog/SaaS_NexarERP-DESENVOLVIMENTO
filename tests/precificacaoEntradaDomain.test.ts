import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisosDePreco,
  lucroPorUnidade,
  markupDoPreco,
  numeroDaTela,
  precoPadraoDeItemNovo,
  precoPeloMarkup,
  variacaoDeMargem,
  vendaMinima,
} from '../src/utils/precificacaoEntradaDomain';

test('markup e preço são o mesmo cálculo visto dos dois lados (markup sobre o custo)', () => {
  assert.equal(precoPeloMarkup(10, '80'), 18);
  assert.equal(precoPeloMarkup(10, '80,5'), 18.05);
  assert.equal(markupDoPreco(18, 10), '80.0');
  assert.equal(precoPeloMarkup(0, '50'), null);
  assert.equal(precoPeloMarkup(10, ''), null);
  assert.equal(precoPeloMarkup(10, 'abc'), null);
  assert.equal(precoPeloMarkup(10, '-100'), null);
  assert.equal(markupDoPreco(0, 10), '');
  assert.equal(markupDoPreco(10, 0), '');
});

test('item novo acompanha o custo com 50% de markup; sem custo, zero', () => {
  assert.equal(precoPadraoDeItemNovo(10.8), 16.2);
  assert.equal(precoPadraoDeItemNovo(0), 0);
});

test('venda mínima e lucro por unidade', () => {
  assert.equal(vendaMinima(100, 10), 90);
  assert.equal(vendaMinima(100, 0), 100);
  assert.equal(vendaMinima(100, 150), 0);
  assert.equal(vendaMinima(0, 10), 0);
  assert.equal(lucroPorUnidade(18, 10), 8);
});

test('número digitado com vírgula ou vazio', () => {
  assert.equal(numeroDaTela('12,5'), 12.5);
  assert.equal(numeroDaTela(''), 0);
  assert.equal(numeroDaTela('x'), 0);
});

test('avisos: abaixo do custo, venda mínima abaixo do custo, atacado', () => {
  assert.deepEqual(avisosDePreco({ custo: 10, precoVarejo: 15, atacadoAtivo: false, precoAtacado: 0, descontoMaximoPercentual: 0 }), []);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 8, atacadoAtivo: false, precoAtacado: 0, descontoMaximoPercentual: 0 })[0], /prejuízo/);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 11, atacadoAtivo: false, precoAtacado: 0, descontoMaximoPercentual: 20 })[0], /venda mínima/);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 15, atacadoAtivo: true, precoAtacado: 0, descontoMaximoPercentual: 0 })[0], /preço de atacado/);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 15, atacadoAtivo: true, precoAtacado: 16, descontoMaximoPercentual: 0 })[0], /maior que o de varejo/);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 15, atacadoAtivo: true, precoAtacado: 9, descontoMaximoPercentual: 0 })[0], /abaixo do custo/);
  assert.match(avisosDePreco({ custo: 10, precoVarejo: 15, atacadoAtivo: false, precoAtacado: 0, descontoMaximoPercentual: 120 })[0], /entre 0% e 100%/);
});

test('margem do mesmo preço antes e depois do custo novo', () => {
  assert.deepEqual(variacaoDeMargem(15, 10, 12), { antes: 50, depois: 25 });
  assert.deepEqual(variacaoDeMargem(0, 10, 12), { antes: null, depois: null });
});
