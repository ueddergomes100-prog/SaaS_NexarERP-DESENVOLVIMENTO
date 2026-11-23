import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ehAppVendas, ehEnderecoLocal, persistenciaDoLogin } from '../src/utils/loginPersistenciaDomain';

/* Onde o login fica guardado no navegador (23/11/2026: maquina de desenvolvimento guarda o login). */

const publicado = { hostname: 'accounts.hennder.com.br', modoDesenvolvimento: false };
const maquinaDeDev = { hostname: 'localhost', modoDesenvolvimento: true };

test('site publicado: o sistema vale so\' para a aba; app Vendas e Frente de Caixa ficam guardados', () => {
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/pedidos-venda' }), 'sessao');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/' }), 'sessao');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/login' }), 'sessao');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/vendedor' }), 'local');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/vendedor/pedidos' }), 'local');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/caixa' }), 'local');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/caixa/login' }), 'local');
  assert.equal(persistenciaDoLogin({ ...publicado, pathname: '/caixa.html' }), 'local');
});

test('maquina de desenvolvimento (npm run dev em localhost): o sistema tambem guarda o login', () => {
  assert.equal(persistenciaDoLogin({ ...maquinaDeDev, pathname: '/pedidos-venda' }), 'local');
  assert.equal(persistenciaDoLogin({ ...maquinaDeDev, pathname: '/login' }), 'local');
  assert.equal(persistenciaDoLogin({ ...maquinaDeDev, pathname: '/caixa' }), 'local');
  assert.equal(persistenciaDoLogin({ pathname: '/pre-vendas', hostname: '127.0.0.1', modoDesenvolvimento: true }), 'local');
});

test('precisa das duas coisas: modo de desenvolvimento E endereco local -- nenhum site publicado muda', () => {
  // Build de producao aberto em localhost (npm run preview): continua por aba.
  assert.equal(persistenciaDoLogin({ pathname: '/pedidos-venda', hostname: 'localhost', modoDesenvolvimento: false }), 'sessao');
  // Modo de desenvolvimento exposto na rede ou num dominio: continua por aba.
  assert.equal(persistenciaDoLogin({ pathname: '/pedidos-venda', hostname: '192.168.0.15', modoDesenvolvimento: true }), 'sessao');
  assert.equal(persistenciaDoLogin({ pathname: '/pedidos-venda', hostname: 'saas-nexarerp-desenvolvimento.vercel.app', modoDesenvolvimento: true }), 'sessao');
  assert.equal(persistenciaDoLogin({ pathname: '/pedidos-venda', hostname: 'localhost.empresa.com.br', modoDesenvolvimento: true }), 'sessao');
});

test('endereco local e app Vendas', () => {
  assert.equal(ehEnderecoLocal('localhost'), true);
  assert.equal(ehEnderecoLocal('LOCALHOST'), true);
  assert.equal(ehEnderecoLocal('127.0.0.1'), true);
  assert.equal(ehEnderecoLocal('[::1]'), true);
  assert.equal(ehEnderecoLocal('app.localhost'), true);
  assert.equal(ehEnderecoLocal('meulocalhost'), false);
  assert.equal(ehEnderecoLocal('api.nexarcompany.com.br'), false);
  assert.equal(ehEnderecoLocal(''), false);
  assert.equal(ehEnderecoLocal(undefined), false);
  assert.equal(ehAppVendas('/vendedor/clientes'), true);
  assert.equal(ehAppVendas('/vendas'), false);
});
