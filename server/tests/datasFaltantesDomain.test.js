const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const { decidirDataVenda, decidirDataDoLancamento } = require('../utils/datasFaltantesDomain');

// 13/09 as 23h30 em Sao Paulo = 14/09 02h30 UTC: o dia certo e' 13/09.
const criadoTarde = Timestamp.fromDate(new Date('2026-09-14T02:30:00Z'));

test('pedido com data da venda fica como esta', () => {
  assert.deepEqual(decidirDataVenda({ dataVenda: '2026-09-13', createdAt: criadoTarde }), { acao: 'ok' });
});

test('pedido sem data da venda: dia da criacao no fuso de Sao Paulo', () => {
  assert.deepEqual(decidirDataVenda({ createdAt: criadoTarde }), { acao: 'preencher', campo: 'dataVenda', valor: '2026-09-13' });
  assert.deepEqual(decidirDataVenda({ dataVenda: '', createdAt: criadoTarde }).valor, '2026-09-13');
  assert.equal(decidirDataVenda({ dataVenda: '24/07/2026', createdAt: criadoTarde }).acao, 'preencher', 'formato errado tambem');
});

test('criacao gravada como mapa (empresa restaurada antes da correcao) tambem serve', () => {
  assert.equal(decidirDataVenda({ createdAt: { _seconds: 1784890800, _nanoseconds: 0 } }).acao, 'preencher');
});

test('sem data e sem criacao: nao inventa', () => {
  assert.deepEqual(decidirDataVenda({}), { acao: 'sem_data' });
});

test('lancamento pago sem dataPagamento e sem data: dataPagamento = dia da criacao', () => {
  assert.deepEqual(
    decidirDataDoLancamento({ status: 'Paga', createdAt: criadoTarde }),
    { acao: 'preencher', campo: 'dataPagamento', valor: '2026-09-13' },
  );
});

test('lancamento pago com alguma das datas fica como esta', () => {
  assert.deepEqual(decidirDataDoLancamento({ status: 'Paga', dataPagamento: '2026-07-29', createdAt: criadoTarde }), { acao: 'ok' });
  assert.deepEqual(decidirDataDoLancamento({ status: 'Paga', data: '2026-07-29', createdAt: criadoTarde }), { acao: 'ok' });
});

test('pendente sem vencimento nao ganha data inventada: so e listado', () => {
  assert.deepEqual(decidirDataDoLancamento({ status: 'Pendente', createdAt: criadoTarde }), { acao: 'pendente_sem_vencimento' });
  assert.deepEqual(decidirDataDoLancamento({ status: 'Pendente', data: '2026-10-20' }), { acao: 'ok' });
  assert.deepEqual(decidirDataDoLancamento({ status: 'Cancelada' }), { acao: 'ok' });
});
