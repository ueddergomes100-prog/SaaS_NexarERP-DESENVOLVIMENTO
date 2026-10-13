const test = require('node:test');
const assert = require('node:assert/strict');
const { baixarArquivoDaSpedy, esperaAteLiberar } = require('../services/spedyArquivo');

const resposta = (status, reset) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h === 'x-rate-limit-reset' ? reset || null : null) } });

test('limite da Spedy (429): espera liberar e tenta de novo', async () => {
  const respostas = [resposta(429), resposta(429), resposta(200)];
  const chamadas = [];
  const esperas = [];
  const r = await baixarArquivoDaSpedy({ apiKey: 'k', baseUrl: 'https://api' }, 'product-invoices', 'abc', 'pdf', {
    buscar: async (url, init) => { chamadas.push([url, init.headers['X-Api-Key']]); return respostas.shift(); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.equal(r.status, 200);
  assert.equal(chamadas.length, 3);
  assert.deepEqual(chamadas[0], ['https://api/product-invoices/abc/pdf', 'k']);
  assert.equal(esperas.length, 2);
});

test('desiste depois de 3 tentativas e devolve o 429 para quem chamou', async () => {
  let n = 0;
  const r = await baixarArquivoDaSpedy({ apiKey: 'k', baseUrl: 'https://api' }, 'product-invoices', 'abc', 'xml', {
    buscar: async () => { n += 1; return resposta(429); },
    esperar: async () => {},
  });
  assert.equal(r.status, 429);
  assert.equal(n, 3);
});

test('outros erros (404, 400) nao sao repetidos', async () => {
  let n = 0;
  const r = await baixarArquivoDaSpedy({ apiKey: 'k', baseUrl: 'https://api' }, 'product-invoices', 'abc', 'pdf', {
    buscar: async () => { n += 1; return resposta(404); },
    esperar: async () => { throw new Error('nao deveria esperar'); },
  });
  assert.equal(r.status, 404);
  assert.equal(n, 1);
});

test('espera usa a hora de liberacao da Spedy, entre 1 s e 15 s', () => {
  const agora = Date.parse('2026-10-13T20:00:00Z');
  assert.equal(esperaAteLiberar(resposta(429, '2026-10-13T20:00:04Z'), 0, agora), 4300);
  assert.equal(esperaAteLiberar(resposta(429, '2026-10-13T20:05:00Z'), 0, agora), 15000);
  assert.equal(esperaAteLiberar(resposta(429, '2026-10-13T19:59:00Z'), 0, agora), 1000);
  assert.equal(esperaAteLiberar(resposta(429), 1, agora), 10000, 'sem o cabecalho: 5 s, 10 s...');
});
