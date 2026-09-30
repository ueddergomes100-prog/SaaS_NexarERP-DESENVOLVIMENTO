const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { limitadorPublico, limitadorPorChave, limitadorTotal, MINUTO_MS } = require('../middleware/rateLimit');

/** Sobe um Express de verdade (com `trust proxy` = 1, como em producao) numa porta livre. */
const subirApp = (montar) => new Promise((resolve) => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  montar(app);
  const servidor = app.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${servidor.address().port}`,
    fechar: () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(() => ok()); }),
  }));
});

const post = (url, corpo, headers = {}) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(corpo || {}),
});

test('limite por IP: a requisicao seguinte ao limite recebe 429 com mensagem em portugues', async () => {
  const { url, fechar } = await subirApp((app) => {
    app.post('/x', limitadorPublico('teste-ip', { limite: 2, janelaMs: MINUTO_MS }), (req, res) => res.json({ ok: true }));
  });
  try {
    assert.equal((await post(`${url}/x`)).status, 200);
    assert.equal((await post(`${url}/x`)).status, 200);
    const bloqueada = await post(`${url}/x`);
    assert.equal(bloqueada.status, 429);
    const corpo = await bloqueada.json();
    assert.match(corpo.error, /Muitas tentativas/);
    assert.equal(bloqueada.headers.get('ratelimit-policy') !== null || bloqueada.headers.get('ratelimit') !== null, true);
  } finally {
    await fechar();
  }
});

test('o primeiro valor de X-Forwarded-For (o que o cliente escreve) NAO e o IP considerado', async () => {
  const { url, fechar } = await subirApp((app) => {
    app.post('/ip', (req, res) => res.json({ ip: req.ip }));
  });
  try {
    // Com trust proxy = 1, o Express fica com o ULTIMO endereco da cadeia --
    // o que o proxy confiavel acrescentou -- e descarta o resto.
    const resposta = await post(`${url}/ip`, {}, { 'X-Forwarded-For': '1.1.1.1, 9.9.9.9' });
    assert.equal((await resposta.json()).ip, '9.9.9.9');
  } finally {
    await fechar();
  }
});

test('limite por chave (e-mail) vale mesmo com IPs diferentes', async () => {
  const { url, fechar } = await subirApp((app) => {
    app.post('/start', limitadorPorChave('teste-email', (req) => String(req.body.email || '').toLowerCase(), {
      limite: 2, janelaMs: MINUTO_MS, mensagem: 'Este e-mail já recebeu códigos demais.',
    }), (req, res) => res.json({ ok: true }));
  });
  try {
    const ips = ['5.5.5.5', '6.6.6.6', '7.7.7.7'];
    const respostas = [];
    for (const ip of ips) {
      respostas.push(await post(`${url}/start`, { email: 'Alvo@Exemplo.com' }, { 'X-Forwarded-For': ip }));
    }
    assert.deepEqual(respostas.map((r) => r.status), [200, 200, 429]);
    assert.equal((await respostas[2].json()).error, 'Este e-mail já recebeu códigos demais.');
    // outro e-mail segue livre
    assert.equal((await post(`${url}/start`, { email: 'outro@exemplo.com' })).status, 200);
  } finally {
    await fechar();
  }
});

test('teto total da rota soma todo mundo', async () => {
  const { url, fechar } = await subirApp((app) => {
    app.post('/cnpj', limitadorTotal('teste-total', { limite: 2, janelaMs: MINUTO_MS }), (req, res) => res.json({ ok: true }));
  });
  try {
    assert.equal((await post(`${url}/cnpj`, {}, { 'X-Forwarded-For': '1.1.1.1' })).status, 200);
    assert.equal((await post(`${url}/cnpj`, {}, { 'X-Forwarded-For': '2.2.2.2' })).status, 200);
    const bloqueada = await post(`${url}/cnpj`, {}, { 'X-Forwarded-For': '3.3.3.3' });
    assert.equal(bloqueada.status, 429);
    assert.match((await bloqueada.json()).error, /pedidos demais na última hora/);
  } finally {
    await fechar();
  }
});
