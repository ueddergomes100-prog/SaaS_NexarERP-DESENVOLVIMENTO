import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CAMINHO_APP_CAIXA,
  MENSAGEM_SEM_ACESSO_AO_CAIXA,
  destinoAposLogin,
  ehAppDoCaixa,
  entraDiretoNoCaixa,
  podeUsarFrenteDeCaixa,
} from '../src/utils/frenteDeCaixaDomain';

/* Frente de Caixa como app separado (19/10/2026). */

test('quem usa o caixa: PDV, so-caixa, dono, administrador', () => {
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.pdv'] }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: ['vendas.pedidos'] }), false);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', permissoes: [] }), false);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Funcionario', isOwner: true }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'Admin' }), true);
  assert.equal(podeUsarFrenteDeCaixa({ role: 'SuperAdmin' }), true);
  assert.equal(podeUsarFrenteDeCaixa({ permissoes: null }), false);
});

test('entra direto no caixa so o funcionario com a permissao; dono e administrador nunca ficam presos', () => {
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }), true);
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', permissoes: ['vendas.pdv'] }), false);
  assert.equal(entraDiretoNoCaixa({ role: 'Admin', permissoes: ['vendas.so_caixa'] }), false);
  assert.equal(entraDiretoNoCaixa({ role: 'Funcionario', isOwner: true, permissoes: ['vendas.so_caixa'] }), false);
});

test('destino depois do login e caminho do app', () => {
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }, false), CAMINHO_APP_CAIXA);
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.pdv'] }, false), '/dashboard');
  assert.equal(destinoAposLogin({ role: 'Funcionario', permissoes: ['vendas.so_caixa'] }, true), '/superadmin');
  assert.equal(ehAppDoCaixa('/caixa'), true);
  assert.equal(ehAppDoCaixa('/caixa/login'), true);
  assert.equal(ehAppDoCaixa('/caixa.html'), true);
  assert.equal(ehAppDoCaixa('/caixas-pdv'), false);
  assert.equal(ehAppDoCaixa('/pdv'), false);
  assert.match(MENSAGEM_SEM_ACESSO_AO_CAIXA, /Frente de Caixa/);
});

test('nomeDoOperador: o nome do cadastro vence o login gravado', async () => {
  const { nomeDoOperador } = await import('../src/utils/frenteDeCaixaDomain');
  assert.equal(nomeDoOperador({ nome: 'Uedder Gomes' }, '50672123000147-uedder'), 'Uedder Gomes');
  assert.equal(nomeDoOperador({ nome: '  ', nomeResponsavel: 'Dono' }, 'login'), 'Dono');
  assert.equal(nomeDoOperador(null, '50672123000147-uedder'), '50672123000147-uedder');
});
