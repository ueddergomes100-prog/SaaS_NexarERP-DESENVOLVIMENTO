import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMITE_SNAPSHOT_LOG_BYTES,
  reduzirSnapshotDeLog,
  tamanhoJsonEmBytes,
} from '../src/utils/auditoriaSnapshotDomain';

const pedidoGrande = (quantidadeDeItens: number) => ({
  numeroPedido: '0042',
  clienteNome: 'JOÃO DA SILVA',
  vendedorId: 'vend-1',
  vendedorNome: 'JULIANO',
  status: 'Finalizada',
  valorTotal: 1234.5,
  observacoesInternas: 'campo qualquer que nao e de identificacao',
  itens: Array.from({ length: quantidadeDeItens }, (_, i) => ({
    id: `item-${i}`,
    nome: `PRODUTO DE NOME BEM COMPRIDO PARA OCUPAR ESPAÇO ${i}`,
    quantidade: 1,
    precoUnitario: 10,
    subtotal: 10,
  })),
});

test('snapshot que cabe passa intacto', () => {
  const pedido = pedidoGrande(3);
  assert.deepEqual(reduzirSnapshotDeLog(pedido), pedido);
});

test('ausencia de snapshot nao e erro', () => {
  // Documento que ja nao existia na hora de excluir cai aqui.
  assert.equal(reduzirSnapshotDeLog(null), null);
  assert.equal(reduzirSnapshotDeLog(undefined), null);
});

test('snapshot grande demais vira resumo identificavel, nao some', () => {
  // Registro parcial e pior que completo, mas e' infinitamente melhor que
  // registro nenhum -- que era o que acontecia quando a gravacao estourava.
  const reduzido = reduzirSnapshotDeLog(pedidoGrande(5000)) as Record<string, unknown>;

  assert.equal(reduzido.truncado, true);
  assert.equal(reduzido.totalDeItens, 5000);
  assert.equal(reduzido.numeroPedido, '0042');
  assert.equal(reduzido.clienteNome, 'JOÃO DA SILVA');
  assert.equal(reduzido.vendedorNome, 'JULIANO');
  assert.equal(reduzido.valorTotal, 1234.5);
  // O que pesava fica de fora.
  assert.equal(reduzido.itens, undefined);
  assert.equal(reduzido.observacoesInternas, undefined);
});

test('o resumo cabe com folga no limite', () => {
  const reduzido = reduzirSnapshotDeLog(pedidoGrande(5000));
  assert.ok(tamanhoJsonEmBytes(reduzido) < LIMITE_SNAPSHOT_LOG_BYTES);
});

test('acento conta 2 bytes -- medir por length subestimaria', () => {
  assert.equal(tamanhoJsonEmBytes('a'), 3);   // "a" com as aspas
  assert.equal(tamanhoJsonEmBytes('ã'), 4);   // "ã" ocupa 2 bytes
});

test('referencia circular conta como grande demais, nao quebra', () => {
  const circular: Record<string, unknown> = { numeroPedido: '0001' };
  circular.ele_mesmo = circular;

  assert.equal(tamanhoJsonEmBytes(circular), Number.POSITIVE_INFINITY);
  const reduzido = reduzirSnapshotDeLog(circular) as Record<string, unknown>;
  assert.equal(reduzido.truncado, true);
  assert.equal(reduzido.numeroPedido, '0001');
});

test('snapshot sem lista de itens nao quebra a contagem', () => {
  const semItens = { numeroPedido: '0007', texto: 'x'.repeat(300_000) };
  const reduzido = reduzirSnapshotDeLog(semItens) as Record<string, unknown>;

  assert.equal(reduzido.truncado, true);
  assert.equal(reduzido.totalDeItens, 0);
  assert.equal(reduzido.numeroPedido, '0007');
});

test('o limite fica bem abaixo do teto de 1 MB do Firestore', () => {
  // O snapshot divide o documento com descricao, diff e metadados, e o teto
  // do Firestore vale pro documento inteiro, nao por campo.
  assert.ok(LIMITE_SNAPSHOT_LOG_BYTES < 1_000_000 / 4);
});
