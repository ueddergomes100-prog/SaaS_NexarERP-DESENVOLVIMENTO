import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MOSTRAR_RESUMO_ESTOQUE, parseMostrarResumoEstoque } from '../src/utils/estoqueResumoDomain';

test('os cartoes vem desligados por padrao (decisao de 2026-09-19)', () => {
  assert.equal(DEFAULT_MOSTRAR_RESUMO_ESTOQUE, false);
});

test('so true explicito mostra os cartoes', () => {
  assert.equal(parseMostrarResumoEstoque(true), true);
  // Empresa que nunca abriu a configuracao nao tem o campo gravado: escondido.
  assert.equal(parseMostrarResumoEstoque(undefined), false);
  assert.equal(parseMostrarResumoEstoque(null), false);
  assert.equal(parseMostrarResumoEstoque(false), false);
  // String vinda de formulario nao e booleano.
  assert.equal(parseMostrarResumoEstoque('true'), false);
});
