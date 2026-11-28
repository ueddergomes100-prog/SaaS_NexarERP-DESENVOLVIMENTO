import test from 'node:test';
import assert from 'node:assert/strict';
import { problemaDaSenha } from '../src/utils/senhaForteDomain';

test('senha forte: 8+ caracteres com letras e numeros passa', () => {
  assert.equal(problemaDaSenha('loja2026x'), null);
  assert.equal(problemaDaSenha('Caixa#4521'), null);
  assert.equal(problemaDaSenha('ção12345'), null, 'letra acentuada conta como letra');
});

test('senha fraca: curta, so numero, so letra, obvia ou sequencia e recusada com motivo em portugues', () => {
  for (const ruim of ['', 'ab12', '1234567', '12345678', 'abcdefgh', 'senha123', 'SENHA123', 'aaaa1111', '11111111', 'abcd1234', undefined, 12345678]) {
    const motivo = problemaDaSenha(ruim);
    assert.ok(motivo && /senha/i.test(motivo), String(ruim));
  }
  assert.match(problemaDaSenha('x'.repeat(129) + '1') || '', /no máximo/);
});
