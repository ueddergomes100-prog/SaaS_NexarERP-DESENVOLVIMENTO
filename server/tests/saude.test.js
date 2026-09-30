const test = require('node:test');
const assert = require('node:assert/strict');
const { estadoDoFirestore, limparCacheDaSonda, INTERVALO_CACHE_MS } = require('../services/saude');

const dbQue = (get) => ({ collection: () => ({ limit: () => ({ get }) }) });

test('sem Admin SDK: erro com motivo em portugues', async () => {
  limparCacheDaSonda();
  const estado = await estadoDoFirestore(null);
  assert.equal(estado.ok, false);
  assert.match(estado.motivo, /credencial/);
});

test('leitura que responde = ok; resultado fica em cache por 30 s', async () => {
  limparCacheDaSonda();
  let chamadas = 0;
  const db = dbQue(async () => { chamadas += 1; return {}; });
  assert.deepEqual(await estadoDoFirestore(db, { agora: 1000 }), { ok: true });
  assert.deepEqual(await estadoDoFirestore(db, { agora: 1000 + INTERVALO_CACHE_MS - 1 }), { ok: true });
  assert.equal(chamadas, 1, 'segunda chamada dentro do intervalo nao consulta o banco');
  await estadoDoFirestore(db, { agora: 1000 + INTERVALO_CACHE_MS + 1 });
  assert.equal(chamadas, 2);
});

test('leitura que falha = erro com o motivo', async () => {
  limparCacheDaSonda();
  const db = dbQue(async () => { throw new Error('Could not load the default credentials'); });
  const estado = await estadoDoFirestore(db);
  assert.equal(estado.ok, false);
  assert.match(estado.motivo, /default credentials/);
});

test('leitura que nunca responde = erro por tempo limite', async () => {
  limparCacheDaSonda();
  const db = dbQue(() => new Promise(() => {}));
  const estado = await estadoDoFirestore(db, { timeoutMs: 50 });
  assert.equal(estado.ok, false);
  assert.match(estado.motivo, /não respondeu/);
});
