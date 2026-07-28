import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../src/utils/documentMetadata';

test('buildDocumentMetadata usa o mesmo timestamp para criacao e alteracao', () => {
  const timestamp = 'TS_SENTINEL';
  const result = buildDocumentMetadata('user-1', timestamp);

  assert.deepEqual(result, {
    criadoPor: 'user-1',
    criadoEm: timestamp,
    alteradoPor: 'user-1',
    alteradoEm: timestamp,
  });
});

test('buildDocumentUpdateMetadata omite ultimaAlteracao quando nao informado', () => {
  const result = buildDocumentUpdateMetadata('user-2', 'TS');

  assert.deepEqual(result, { alteradoPor: 'user-2', alteradoEm: 'TS' });
  assert.equal('ultimaAlteracao' in result, false);
});

test('buildDocumentUpdateMetadata inclui ultimaAlteracao quando informado', () => {
  const result = buildDocumentUpdateMetadata('user-3', 'TS', 'Status alterado de Pendente para Finalizada');

  assert.deepEqual(result, {
    alteradoPor: 'user-3',
    alteradoEm: 'TS',
    ultimaAlteracao: 'Status alterado de Pendente para Finalizada',
  });
});
