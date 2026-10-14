const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const { decidirDataVenda } = require('../domain/dataVendaDomain');

test('pedido com data da venda fica como esta', () => {
  assert.deepEqual(decidirDataVenda({ dataVenda: '2026-09-13', createdAt: Timestamp.fromDate(new Date('2026-01-01T12:00:00Z')) }), { acao: 'ok' });
});

test('sem data da venda: usa o dia da criacao no fuso de Sao Paulo', () => {
  // 13/09 as 23h30 em Sao Paulo = 14/09 02h30 UTC: o dia certo e' 13/09.
  const criadoTarde = Timestamp.fromDate(new Date('2026-09-14T02:30:00Z'));
  assert.deepEqual(decidirDataVenda({ createdAt: criadoTarde }), { acao: 'preencher', dataVenda: '2026-09-13' });
  assert.deepEqual(decidirDataVenda({ dataVenda: '', createdAt: criadoTarde }), { acao: 'preencher', dataVenda: '2026-09-13' });
});

test('data da venda em formato errado tambem e preenchida pela criacao', () => {
  const criado = Timestamp.fromDate(new Date('2026-07-24T15:00:00Z'));
  assert.equal(decidirDataVenda({ dataVenda: '24/07/2026', createdAt: criado }).dataVenda, '2026-07-24');
});

test('criacao gravada como mapa (empresa restaurada antes da correcao) tambem serve', () => {
  assert.deepEqual(decidirDataVenda({ createdAt: { _seconds: 1784890800, _nanoseconds: 0 } }).acao, 'preencher');
});

test('sem data da venda e sem criacao: nao inventa data', () => {
  assert.deepEqual(decidirDataVenda({}), { acao: 'sem_data' });
  assert.deepEqual(decidirDataVenda({ createdAt: null }), { acao: 'sem_data' });
});
