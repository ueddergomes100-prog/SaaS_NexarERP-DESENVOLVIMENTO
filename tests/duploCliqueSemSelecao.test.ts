import test from 'node:test';
import assert from 'node:assert/strict';
import { deveImpedirSelecao } from '../src/utils/duploCliqueSemSelecao';

/*
 * Duplo clique nao marca o texto de azul (18/11/2026): so' fora de campo de
 * digitar, e so' a partir do segundo clique do botao principal.
 */

test('duplo (e triplo) clique fora de campo de digitar: sem marcar texto', () => {
  assert.equal(deveImpedirSelecao({ cliques: 2, botao: 0, emCampoDeDigitar: false }), true);
  assert.equal(deveImpedirSelecao({ cliques: 3, botao: 0, emCampoDeDigitar: false }), true);
});

test('o que nao pode mudar', () => {
  // Clique simples e arrastar para copiar: o navegador segue como sempre.
  assert.equal(deveImpedirSelecao({ cliques: 1, botao: 0, emCampoDeDigitar: false }), false);
  // Dentro de campo de digitar, duplo clique continua marcando a palavra.
  assert.equal(deveImpedirSelecao({ cliques: 2, botao: 0, emCampoDeDigitar: true }), false);
  // Botao direito (menu) e do meio nao sao "abrir".
  assert.equal(deveImpedirSelecao({ cliques: 2, botao: 2, emCampoDeDigitar: false }), false);
  assert.equal(deveImpedirSelecao({ cliques: 2, botao: 1, emCampoDeDigitar: false }), false);
});
