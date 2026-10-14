import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diaDaData, diasAteAData } from '../src/utils/avisosSinoDomain';

test('dia da data: texto, Date, Timestamp e mapa de backup restaurado', () => {
  assert.equal(diaDaData('2026-10-20'), '2026-10-20');
  assert.equal(diaDaData('2026-10-20T15:00:00.000Z'), '2026-10-20', 'ISO: so o dia');
  // 23h30 em Sao Paulo de 19/10 ainda e 19/10 (UTC ja e 20/10)
  const noiteDo19 = new Date('2026-10-20T02:30:00.000Z');
  assert.equal(diaDaData(noiteDo19), '2026-10-19');
  assert.equal(diaDaData({ toDate: () => noiteDo19 }), '2026-10-19', 'Timestamp do Firestore');
  assert.equal(diaDaData({ _seconds: noiteDo19.getTime() / 1000, _nanoseconds: 0 }), '2026-10-19', 'mapa de empresa restaurada');
  assert.equal(diaDaData({ seconds: noiteDo19.getTime() / 1000 }), '2026-10-19');
});

test('dia da data: valor ilegivel vira null em vez de quebrar o sino', () => {
  assert.equal(diaDaData(''), null);
  assert.equal(diaDaData(undefined), null);
  assert.equal(diaDaData('20/10/2026'), null);
  assert.equal(diaDaData(new Date('x')), null);
  assert.equal(diaDaData({}), null);
  assert.equal(diaDaData(42), null);
});

test('dias ate a data: futuro positivo, hoje zero, passado negativo', () => {
  assert.equal(diasAteAData('2026-10-20', '2026-10-14'), 6);
  assert.equal(diasAteAData('2026-10-14', '2026-10-14'), 0);
  assert.equal(diasAteAData('2026-10-01', '2026-10-14'), -13);
  assert.equal(diasAteAData(null, '2026-10-14'), null);
});
