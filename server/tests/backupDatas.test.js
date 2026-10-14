const test = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('@google-cloud/firestore');
const { restaurarDatasDoBackup } = require('../services/backupDatas');

test('Timestamp que passou pelo JSON do backup volta a ser Timestamp', () => {
  const original = Timestamp.fromDate(new Date('2026-10-14T12:00:00.123Z'));
  const doArquivo = JSON.parse(JSON.stringify({ createdAt: original }));
  assert.deepEqual(Object.keys(doArquivo.createdAt).sort(), ['_nanoseconds', '_seconds'], 'formato gravado no arquivo');

  const restaurado = restaurarDatasDoBackup(doArquivo, Timestamp);
  assert.ok(restaurado.createdAt instanceof Timestamp);
  assert.ok(restaurado.createdAt.isEqual(original));
});

test('datas dentro de mapas e listas tambem voltam; o resto passa igual', () => {
  const data = Timestamp.fromDate(new Date('2026-09-01T00:00:00Z'));
  const doArquivo = JSON.parse(JSON.stringify({
    nome: 'Pedido 10',
    valor: 0,
    ativo: false,
    vazio: null,
    dataVenda: '2026-09-01',
    pagamentos: [{ valor: 10, pagoEm: data }],
    boleto: { emitidoEm: data, nossoNumero: '123' },
  }));

  const restaurado = restaurarDatasDoBackup(doArquivo, Timestamp);
  assert.ok(restaurado.pagamentos[0].pagoEm instanceof Timestamp);
  assert.ok(restaurado.boleto.emitidoEm instanceof Timestamp);
  assert.equal(restaurado.boleto.nossoNumero, '123');
  assert.equal(restaurado.nome, 'Pedido 10');
  assert.equal(restaurado.valor, 0);
  assert.equal(restaurado.ativo, false);
  assert.equal(restaurado.vazio, null);
  assert.equal(restaurado.dataVenda, '2026-09-01', 'data em texto continua texto');
});

test('mapa que so parece data (campo a mais ou valor nao inteiro) nao e convertido', () => {
  const comCampoAMais = { _seconds: 1, _nanoseconds: 0, outro: 'x' };
  const naoInteiro = { _seconds: '1', _nanoseconds: 0 };
  assert.deepEqual(restaurarDatasDoBackup(comCampoAMais, Timestamp), comCampoAMais);
  assert.deepEqual(restaurarDatasDoBackup(naoInteiro, Timestamp), naoInteiro);
});
