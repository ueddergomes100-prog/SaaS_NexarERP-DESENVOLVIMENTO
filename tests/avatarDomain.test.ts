import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUANTIDADE_CORES_AVATAR, corDoAvatar, iniciaisDoNome } from '../src/utils/avatarDomain';

test('iniciais pulam as palavras curtas e usam no maximo duas letras', () => {
  assert.equal(iniciaisDoNome('Agropecuária Boa Safra'), 'AB');
  assert.equal(iniciaisDoNome('Casa do Produtor'), 'CP');
  assert.equal(iniciaisDoNome('CONSUMIDOR FINAL'), 'CF');
  assert.equal(iniciaisDoNome('  ana  '), 'A');
  assert.equal(iniciaisDoNome('Élida de Sá'), 'É');
  assert.equal(iniciaisDoNome('Zé da Lu'), 'ZD');
});

test('nome vazio ou so com simbolos nao quebra a tela', () => {
  assert.equal(iniciaisDoNome(''), '?');
  assert.equal(iniciaisDoNome(undefined), '?');
  assert.equal(iniciaisDoNome(null), '?');
  assert.equal(iniciaisDoNome('- -'), '-');
});

test('a cor e a mesma para o mesmo cliente e fica dentro da paleta', () => {
  assert.equal(corDoAvatar('Fazenda Santa Luzia'), corDoAvatar('fazenda santa luzia '));
  ['', 'A', 'Casa do Produtor', 'Mercado São Jorge', undefined].forEach((nome) => {
    const cor = corDoAvatar(nome);
    assert.ok(Number.isInteger(cor) && cor >= 0 && cor < QUANTIDADE_CORES_AVATAR);
  });
});
