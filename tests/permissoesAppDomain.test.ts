import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAVES_APP_NOVAS,
  MARCADOR_APP_DEFINIDO,
  PERMISSAO_APP,
  appDefinido,
  mexidasSemTer,
  permissaoValida,
  permissoesEfetivas,
  permissoesParaGravar,
  podeNoApp,
} from '../src/utils/permissoesAppDomain';

test('quem nunca teve o app gravado conta com todas as chaves novas (ninguem perde acesso)', () => {
  const efetivas = permissoesEfetivas(['vendas.pedidos']);
  assert.ok(efetivas.includes('vendas.pedidos'));
  CHAVES_APP_NOVAS.forEach((chave) => assert.ok(efetivas.includes(chave), chave));
  assert.equal(appDefinido(['vendas.pedidos']), false);
});

test('depois de gravado, vale so o que esta marcado; aplicar de novo nao muda nada', () => {
  const gravadas = permissoesParaGravar(['vendas.pedidos', PERMISSAO_APP.preco]);
  assert.ok(gravadas.includes(MARCADOR_APP_DEFINIDO));
  const efetivas = permissoesEfetivas(gravadas);
  assert.deepEqual([...efetivas].sort(), ['app.definido', 'app.preco', 'vendas.pedidos']);
  // O AuthContext entrega as efetivas e a tela aplica de novo: nao pode liberar nada.
  assert.deepEqual([...permissoesEfetivas(efetivas)].sort(), [...efetivas].sort());
  assert.equal(podeNoApp(PERMISSAO_APP.contasPagar, { role: 'Funcionario', isOwner: false, permissoes: efetivas }), false);
  // Quem nunca teve o app gravado: aplicar duas vezes da' o mesmo.
  const antigas = permissoesEfetivas(['vendas.pedidos']);
  assert.deepEqual([...permissoesEfetivas(antigas)].sort(), [...antigas].sort());
  assert.equal(podeNoApp(PERMISSAO_APP.pedido, { role: 'Funcionario', isOwner: false, permissoes: gravadas }), false);
  assert.equal(podeNoApp(PERMISSAO_APP.preco, { role: 'Funcionario', isOwner: false, permissoes: gravadas }), true);
  assert.equal(podeNoApp(PERMISSAO_APP.pedido, { role: 'Admin', isOwner: false, permissoes: gravadas }), true, 'gestor sempre');
  assert.deepEqual(permissoesParaGravar([MARCADOR_APP_DEFINIDO, 'a.b', 'a.b']), ['a.b', MARCADOR_APP_DEFINIDO]);
});

test('gerente: so mexe no que tem, contando as chaves implicitas dos dois lados', () => {
  const gerenteAntigo = ['vendas.pedidos', 'administrativo.equipe']; // sem marcador: tem as chaves do app
  const alvoAntigo = ['vendas.pedidos'];
  // Tirar "Consultar preco" do funcionario: o gerente (implicitamente) tem -> pode.
  const semPreco = permissoesParaGravar(permissoesEfetivas(alvoAntigo).filter((p) => p !== PERMISSAO_APP.preco));
  assert.deepEqual(mexidasSemTer({ antes: alvoAntigo, depois: semPreco, doGerente: gerenteAntigo }), []);
  // Dar "Financeiro: contas a pagar" que o gerente nao tem -> recusa.
  assert.deepEqual(mexidasSemTer({ antes: alvoAntigo, depois: [...alvoAntigo, 'financeiro.pagar'], doGerente: gerenteAntigo }), ['financeiro.pagar']);
  // Gerente ja' configurado sem a chave do app nao a tira de ninguem.
  const gerenteSemPedido = permissoesParaGravar(['vendas.pedidos']);
  const tira = permissoesParaGravar(permissoesEfetivas(alvoAntigo).filter((p) => p !== PERMISSAO_APP.pedido));
  assert.deepEqual(mexidasSemTer({ antes: alvoAntigo, depois: tira, doGerente: gerenteSemPedido }), ['app.pedido']);
});

test('id de permissao valido', () => {
  assert.equal(permissaoValida('app.pedido'), true);
  assert.equal(permissaoValida('vendas.troca_solicitar'), true);
  assert.equal(permissaoValida('estoque.ajusteManual'), true, 'ids antigos em camelCase nao podem sumir ao salvar');
  assert.equal(permissaoValida('estoque.relatorioAjustes'), true);
  assert.equal(permissaoValida('a b.c'), false);
  assert.equal(permissaoValida('semponto'), false);
  assert.equal(permissaoValida(3), false);
});
