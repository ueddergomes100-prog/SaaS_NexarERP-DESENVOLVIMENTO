import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchClients } from '../src/utils/clientSearch';

const clients = [
  { id: '1', nome: 'João da Silva' },
  { id: '2', nome: 'Maria Souza' },
  { id: '3', nome: 'José Pereira' },
];

test('searchClients retorna todos quando o termo esta vazio', () => {
  assert.equal(searchClients(clients, '').length, 3);
});

test('searchClients encontra por nome em qualquer posicao, sem acento e sem caixa', () => {
  const result = searchClients(clients, 'jose');
  assert.deepEqual(result.map((c) => c.id), ['3']);
});

test('searchClients encontra ocorrencia no meio do nome', () => {
  const result = searchClients(clients, 'souza');
  assert.deepEqual(result.map((c) => c.id), ['2']);
});

test('searchClients nao encontra nada para termo sem match', () => {
  assert.equal(searchClients(clients, 'zzz').length, 0);
});
