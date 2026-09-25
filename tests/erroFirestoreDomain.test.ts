import assert from 'node:assert/strict';
import { test } from 'node:test';
import { erroDeAcessoNegado } from '../src/utils/erroFirestoreDomain';

test('permissão negada é reconhecida; rede, indisponível e lixo não', () => {
  assert.equal(erroDeAcessoNegado({ code: 'permission-denied' }), true);
  assert.equal(erroDeAcessoNegado({ code: 'firestore/permission-denied' }), true);
  assert.equal(erroDeAcessoNegado({ code: 'unavailable' }), false);
  assert.equal(erroDeAcessoNegado(new Error('x')), false);
  assert.equal(erroDeAcessoNegado(null), false);
  assert.equal(erroDeAcessoNegado(undefined), false);
});
