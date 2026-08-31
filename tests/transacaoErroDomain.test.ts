import test from 'node:test';
import assert from 'node:assert/strict';

import { describeTransactionError } from '../src/utils/transacaoErroDomain';

test('disputa entre vendedores vira recado dizendo que nada foi gravado', () => {
  const mensagem = describeTransactionError({ code: 'aborted', message: 'Transaction failed: ABORTED' });

  assert.ok(mensagem);
  assert.match(mensagem, /Nada foi gravado/);
  assert.match(mensagem, /tente novamente/i);
});

test('reconhece o codigo mesmo quando so a mensagem sobreviveu ao embrulho', () => {
  const mensagem = describeTransactionError(new Error('Transaction failed: ABORTED after 5 attempts'));

  assert.ok(mensagem);
  assert.match(mensagem, /Nada foi gravado/);
});

test('queda de conexao manda conferir a internet', () => {
  for (const code of ['unavailable', 'deadline-exceeded']) {
    const mensagem = describeTransactionError({ code });
    assert.ok(mensagem, `esperava mensagem para ${code}`);
    assert.match(mensagem, /internet/);
  }
});

test('falta de permissao atende quem nao e admin E quem ja e', () => {
  const mensagem = describeTransactionError({ code: 'permission-denied' });

  assert.ok(mensagem);
  // Quem nao e administrador tem a quem recorrer...
  assert.match(mensagem, /administrador da empresa/);
  // ...e quem JA e' administrador nao pode ficar sem saida: a causa provavel
  // e' regra de acesso nao publicada, e isso e' com o suporte.
  assert.match(mensagem, /suporte/);
});

test('indice faltando manda avisar o suporte dizendo a tela', () => {
  const mensagem = describeTransactionError({ code: 'failed-precondition' });

  assert.ok(mensagem);
  assert.match(mensagem, /suporte/);
  assert.match(mensagem, /tela/);
});

test('limite do plano tem recado proprio', () => {
  const mensagem = describeTransactionError({ code: 'resource-exhausted' });

  assert.ok(mensagem);
  assert.match(mensagem, /limite de operações do plano/);
});

// O ponto da funcao devolver null: erro de negocio ja tem mensagem melhor
// no ponto onde foi lancado ("Estoque insuficiente para X"), e sobrescrever
// aquilo por um texto generico seria perda de informacao pro operador.
test('erro de negocio devolve null para a tela manter a propria mensagem', () => {
  assert.equal(describeTransactionError(new Error('Estoque insuficiente para Parafuso M8. Disponivel: 3.')), null);
  assert.equal(describeTransactionError(new Error('O vendedor selecionado não pertence à empresa ativa.')), null);
});

test('erro vazio ou de formato inesperado nao inventa mensagem', () => {
  assert.equal(describeTransactionError(null), null);
  assert.equal(describeTransactionError(undefined), null);
  assert.equal(describeTransactionError({}), null);
  assert.equal(describeTransactionError('falhou'), null);
  assert.equal(describeTransactionError({ code: 123 }), null);
});

test('nenhuma mensagem devolve texto cru de biblioteca para a tela', () => {
  const codigos = ['aborted', 'unavailable', 'deadline-exceeded', 'permission-denied', 'failed-precondition', 'resource-exhausted'];

  for (const code of codigos) {
    const mensagem = describeTransactionError({ code });
    assert.ok(mensagem, `esperava mensagem para ${code}`);
    assert.doesNotMatch(mensagem, /Transaction failed|undefined|Firestore|FirebaseError/i);
    // Recado de tela termina em ponto final e comeca com maiuscula --
    // mesmo padrao das demais mensagens de erro do sistema.
    assert.match(mensagem, /^[A-ZÀ-Ú].*\.$/);
  }
});
