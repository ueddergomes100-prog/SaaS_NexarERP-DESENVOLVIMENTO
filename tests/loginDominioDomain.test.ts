import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMINIO_DO_LOGIN,
  DOMINIO_DO_LOGIN_ANTIGO,
  ehEmailDoDominioAntigo,
  emailNoDominioDoLogin,
  montarChaveUsername,
  montarEmailSintetico,
} from '../src/utils/loginIdentidadeDomain';

/*
 * Dominio dos logins de funcionario (25/11/2026, auditoria de seguranca item 1.3):
 * o antigo (`nexar.app`) e' de terceiro; o novo e' um subdominio do dono sem caixa
 * de entrada. Login novo nasce no novo; a migracao so' troca o que vem depois do "@".
 */

test('login novo nasce no dominio do dono, nunca no antigo', () => {
  assert.equal(DOMINIO_DO_LOGIN, 'login.nexarcompany.com.br');
  const email = montarEmailSintetico(montarChaveUsername('12.345.678/0001-99', 'Joao'));
  assert.equal(email, '12345678000199-joao@login.nexarcompany.com.br');
  assert.equal(ehEmailDoDominioAntigo(email), false);
  assert.ok(!email.endsWith(`@${DOMINIO_DO_LOGIN_ANTIGO}`));
});

test('reconhece o login antigo, com qualquer caixa e espaco em volta', () => {
  assert.equal(ehEmailDoDominioAntigo('12345678000199-joao@nexar.app'), true);
  assert.equal(ehEmailDoDominioAntigo('  12345678000199-JOAO@NEXAR.APP '), true);
});

test('nao confunde e-mail real nem dominio parecido com o antigo', () => {
  assert.equal(ehEmailDoDominioAntigo('dono@loja.com.br'), false);
  assert.equal(ehEmailDoDominioAntigo('joao@xnexar.app'), false);
  assert.equal(ehEmailDoDominioAntigo('joao@nexar.app.br'), false);
  assert.equal(ehEmailDoDominioAntigo('joao@sub.nexar.app'), false);
  assert.equal(ehEmailDoDominioAntigo(''), false);
  assert.equal(ehEmailDoDominioAntigo(undefined), false);
});

test('migracao troca so\' o dominio e mantem a chave do indice', () => {
  assert.equal(emailNoDominioDoLogin('12345678000199-joao@nexar.app'), '12345678000199-joao@login.nexarcompany.com.br');
  assert.equal(emailNoDominioDoLogin(' 12345678000199-Maria.S@Nexar.App'), '12345678000199-maria.s@login.nexarcompany.com.br');
});

test('migracao nao mexe no que nao e\' login antigo (devolve vazio)', () => {
  assert.equal(emailNoDominioDoLogin('dono@loja.com.br'), '');
  assert.equal(emailNoDominioDoLogin('12345678000199-joao@login.nexarcompany.com.br'), '');
  assert.equal(emailNoDominioDoLogin('@nexar.app'), '');
  assert.equal(emailNoDominioDoLogin(null), '');
});
