const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/spedyCidades').pop();

const SANDBOX = 'https://sandbox-api.spedy.com.br/v1';
const PRODUCAO = 'https://api.spedy.com.br/v1';

/** Spedy falsa: responde conforme a chave que chegou no cabecalho. */
const comSpedy = async (respostaPorChave, fn) => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url, opcoes) => {
    const chave = opcoes.headers['X-Api-Key'];
    chamadas.push({ url: String(url), chave });
    const status = respostaPorChave[chave] ?? 200;
    return { ok: status === 200, status, json: async () => (status === 200 ? { items: [{ code: '3139409', name: 'Manhuaçu', state: 'MG' }] } : {}) };
  };
  try {
    return await fn(chamadas);
  } finally {
    global.fetch = original;
  }
};

const pedido = { tenantId: 'loja', typePath: 'service-invoices', filterText: 'manhua' };

test('empresa nova, sem chave: busca com a chave mestra do sandbox', async () => {
  const fake = criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox', masterApiKeyProducao: 'mestra-prod' },
    'configuracoes/loja': { tenantId: 'loja' },
  });
  const s = carregar(fake.db);
  await comSpedy({}, async (chamadas) => {
    const resposta = await s.buscarCidadesNaSpedy(pedido);
    assert.equal(resposta.status, 200);
    assert.deepEqual(chamadas, [{ url: `${SANDBOX}/service-invoices/cities?filterText=manhua`, chave: 'mestra-sandbox' }]);
  });
});

test('empresa com chave valida: usa a dela, no ambiente dela, e nao toca na mestra', async () => {
  const fake = criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox' },
    'configuracoes/loja': { tenantId: 'loja', spedyEnvironment: 'production' },
    'configuracoes_privadas/loja': { tenantId: 'loja', spedyApiKey: 'chave-da-loja' },
  });
  const s = carregar(fake.db);
  await comSpedy({}, async (chamadas) => {
    await s.buscarCidadesNaSpedy({ ...pedido, state: 'MG' });
    assert.deepEqual(chamadas, [{ url: `${PRODUCAO}/service-invoices/cities?filterText=manhua&state=MG`, chave: 'chave-da-loja' }]);
  });
});

test('chave da empresa recusada pela Spedy (valor errado no campo): cai para a chave mestra e a busca funciona', async () => {
  const fake = criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox' },
    'configuracoes/loja': { tenantId: 'loja', spedyEnabled: true },
    'configuracoes_privadas/loja': { tenantId: 'loja', spedyApiKey: 'senha123' },
  });
  const s = carregar(fake.db);
  await comSpedy({ senha123: 401 }, async (chamadas) => {
    const resposta = await s.buscarCidadesNaSpedy(pedido);
    assert.equal(resposta.status, 200);
    assert.deepEqual(chamadas.map((c) => c.chave), ['senha123', 'mestra-sandbox']);
  });
});

test('mestra do sandbox recusada: tenta a de producao', async () => {
  const fake = criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox', masterApiKeyProducao: 'mestra-prod' },
    'configuracoes/loja': { tenantId: 'loja' },
  });
  const s = carregar(fake.db);
  await comSpedy({ 'mestra-sandbox': 403 }, async (chamadas) => {
    const resposta = await s.buscarCidadesNaSpedy(pedido);
    assert.equal(resposta.status, 200);
    assert.deepEqual(chamadas.map((c) => c.url.startsWith(PRODUCAO)), [false, true]);
  });
});

test('erro que nao e de chave volta como veio, sem tentar outra chave', async () => {
  const fake = criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox' },
    'configuracoes/loja': { tenantId: 'loja' },
    'configuracoes_privadas/loja': { tenantId: 'loja', spedyApiKey: 'chave-da-loja' },
  });
  const s = carregar(fake.db);
  await comSpedy({ 'chave-da-loja': 429 }, async (chamadas) => {
    const resposta = await s.buscarCidadesNaSpedy(pedido);
    assert.equal(resposta.status, 429);
    assert.equal(chamadas.length, 1);
  });
});

test('sem chave nenhuma, ou todas recusadas: erro em portugues dizendo onde resolver', async () => {
  const semNada = carregar(criarBancoFalso({ 'configuracoes/loja': { tenantId: 'loja' } }).db);
  await comSpedy({}, async (chamadas) => {
    await assert.rejects(() => semNada.buscarCidadesNaSpedy(pedido), (e) => e.status === 400 && /Chave mestra da Spedy/.test(e.message));
    assert.equal(chamadas.length, 0);
  });

  const soADaEmpresa = carregar(criarBancoFalso({
    'configuracoes/loja': { tenantId: 'loja' },
    'configuracoes_privadas/loja': { tenantId: 'loja', spedyApiKey: 'senha123' },
  }).db);
  await comSpedy({ senha123: 401 }, async () => {
    await assert.rejects(() => soADaEmpresa.buscarCidadesNaSpedy(pedido), (e) => e.status === 502 && /Spedy API Key/.test(e.message));
  });

  const mestraRuim = carregar(criarBancoFalso({
    'plataforma/spedy': { masterApiKeySandbox: 'mestra-sandbox' },
    'configuracoes/loja': { tenantId: 'loja' },
  }).db);
  await comSpedy({ 'mestra-sandbox': 401 }, async () => {
    await assert.rejects(() => mestraRuim.buscarCidadesNaSpedy(pedido), (e) => e.status === 502 && /chave mestra da plataforma/.test(e.message));
  });

  await assert.rejects(() => semNada.buscarCidadesNaSpedy({ ...pedido, tenantId: '' }), (e) => e.status === 400);
});
