import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODO_VALIDACAO_CLIENTE,
  parseModoValidacaoCliente,
  resolverAcaoValidacaoCliente,
} from '../src/utils/clienteValidacaoDomain';

test('parseModoValidacaoCliente aceita so os 3 modos validos', () => {
  assert.equal(parseModoValidacaoCliente('bloquear'), 'bloquear');
  assert.equal(parseModoValidacaoCliente('perguntar'), 'perguntar');
  assert.equal(parseModoValidacaoCliente('permitir'), 'permitir');
  assert.equal(parseModoValidacaoCliente('lixo'), DEFAULT_MODO_VALIDACAO_CLIENTE);
  assert.equal(parseModoValidacaoCliente(undefined), DEFAULT_MODO_VALIDACAO_CLIENTE);
});

test('resolverAcaoValidacaoCliente sempre segue quando o cliente foi encontrado', () => {
  assert.deepEqual(resolverAcaoValidacaoCliente('bloquear', true, 'FULANO'), { tipo: 'seguir' });
  assert.deepEqual(resolverAcaoValidacaoCliente('perguntar', true, 'FULANO'), { tipo: 'seguir' });
});

test('resolverAcaoValidacaoCliente sempre segue quando o nome digitado esta vazio', () => {
  assert.deepEqual(resolverAcaoValidacaoCliente('bloquear', false, ''), { tipo: 'seguir' });
  assert.deepEqual(resolverAcaoValidacaoCliente('bloquear', false, '   '), { tipo: 'seguir' });
});

test('resolverAcaoValidacaoCliente modo permitir sempre segue', () => {
  assert.deepEqual(resolverAcaoValidacaoCliente('permitir', false, 'FULANO'), { tipo: 'seguir' });
});

test('resolverAcaoValidacaoCliente modo bloquear recusa nome sem cadastro', () => {
  const acao = resolverAcaoValidacaoCliente('bloquear', false, 'FULANO');
  assert.equal(acao.tipo, 'bloquear');
});

test('resolverAcaoValidacaoCliente modo perguntar pede confirmacao', () => {
  assert.deepEqual(resolverAcaoValidacaoCliente('perguntar', false, 'FULANO'), { tipo: 'perguntar' });
});
