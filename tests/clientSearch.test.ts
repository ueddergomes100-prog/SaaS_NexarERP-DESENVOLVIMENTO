import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchClients } from '../src/utils/clientSearch';

const clients = [
  { id: '1', nome: 'João da Silva', codigo: '10' },
  { id: '2', nome: 'Maria Souza', codigo: '2' },
  { id: '3', nome: 'José Pereira', codigo: '23' },
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

test('searchClients encontra por codigo exato', () => {
  const result = searchClients(clients, '2');
  // "2" bate no codigo do cliente 2 (exato) e no codigo do cliente 3 ("23",
  // prefixo) -- ambos sao resultados validos de uma busca parcial.
  assert.deepEqual(result.map((c) => c.id).sort(), ['2', '3']);
});

test('searchClients encontra por prefixo de codigo', () => {
  const result = searchClients(clients, '10');
  assert.deepEqual(result.map((c) => c.id), ['1']);
});
