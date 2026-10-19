import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMITE_ACESSO_MOBILE_PADRAO,
  LIMITE_USUARIOS_PADRAO,
  idsDentroDoLimiteDoApp,
  lerLimiteDoPlano,
  mensagemLimiteDoApp,
  mensagemLimiteDeUsuarios,
} from '../src/utils/limitesDoPlanoDomain';

/* Limites do plano conferidos pelo servidor (19/10/2026). */

test('limite gravado ou o padrao (logins 3, app 0)', () => {
  assert.equal(lerLimiteDoPlano(undefined, LIMITE_USUARIOS_PADRAO), 3);
  assert.equal(lerLimiteDoPlano(null, LIMITE_ACESSO_MOBILE_PADRAO), 0);
  assert.equal(lerLimiteDoPlano(5, 3), 5);
  assert.equal(lerLimiteDoPlano('4', 3), 4);
  assert.equal(lerLimiteDoPlano(-2, 3), 0);
  assert.equal(lerLimiteDoPlano('abc', 3), 3);
});

test('mensagens em portugues, com singular e plural', () => {
  assert.match(mensagemLimiteDeUsuarios(1), /limite de 1 usuário contratado\./);
  assert.match(mensagemLimiteDeUsuarios(4), /limite de 4 usuários contratados\./);
  assert.match(mensagemLimiteDoApp(0), /ainda não tem o aplicativo mobile contratado/);
  assert.match(mensagemLimiteDoApp(2), /limite de 2 acessos/);
});

test('vaga no app: os primeiros a ganhar o acesso (sem data = antigos) ficam dentro', () => {
  const registros = [
    { id: 'c', acessoAppMobile: true, acessoAppMobileEm: '2026-10-19T10:00:00.000Z' },
    { id: 'a', acessoAppMobile: true },
    { id: 'b', acessoAppMobile: true, acessoAppMobileEm: '2026-10-18T10:00:00.000Z' },
    { id: 'd', acessoAppMobile: false },
  ];
  assert.deepEqual([...idsDentroDoLimiteDoApp(registros, 2)].sort(), ['a', 'b']);
  assert.deepEqual([...idsDentroDoLimiteDoApp(registros, 0)], []);
  assert.deepEqual([...idsDentroDoLimiteDoApp(registros, 10)].sort(), ['a', 'b', 'c']);
});
