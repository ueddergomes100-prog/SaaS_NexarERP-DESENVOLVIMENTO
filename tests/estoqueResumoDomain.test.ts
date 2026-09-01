import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../src/utils/estoqueResumoDomain';

test('os cartoes vem ligados por padrao -- e o comportamento de hoje', () => {
  assert.equal(DEFAULT_MOSTRAR_RESUMO_ESTOQUE, true);
});

test('so false explicito esconde os cartoes', () => {
  assert.equal(parseMostrarResumoEstoque(false), false);
  // Empresa que nunca abriu a configuracao nao tem o campo gravado -- sumir
  // com os cartoes de quem nunca pediu seria mudanca a revelia.
  assert.equal(parseMostrarResumoEstoque(undefined), true);
  assert.equal(parseMostrarResumoEstoque(null), true);
  assert.equal(parseMostrarResumoEstoque(true), true);
  // String vinda de formulario nao e booleano.
  assert.equal(parseMostrarResumoEstoque('false'), true);
});
