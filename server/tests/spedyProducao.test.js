const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/spedyProducao').pop();

const base = (extra = {}) => ({
  'plataforma/spedy': { masterApiKeyProducao: 'mestra-prod' },
  'configuracoes/loja': {
    tenantId: 'loja', cnpj: '07.488.550/0001-40', nfseCidadeCodigo: '3139409', nomeOficina: 'LOJA DEMONSTRACAO',
    spedyEnabled: true, spedyEnvironment: 'sandbox', spedyCompanyId: 'empresa-sandbox',
    spedyCertificadoValidade: '2027-01-01T00:00:00Z', spedyCertificadoStatus: 'ativo',
    spedyNumeracao: { productInvoice: { series: 1, nextNumber: 15 } },
    ...extra,
  },
  'configuracoes_privadas/loja': { tenantId: 'loja', spedyApiKey: 'chave-sandbox', nfceCsc: { csc: 'CSC', tokenId: '01' } },
});

const comSpedy = async (resposta, fn) => {
  const original = global.fetch;
  const chamadas = [];
  global.fetch = async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    return resposta;
  };
  try {
    return await fn(chamadas);
  } finally {
    global.fetch = original;
  }
};

const ok = (corpo) => ({ ok: true, status: 200, json: async () => corpo });

test('passa para producao: cadastra na producao com a chave mestra e troca chave, id e ambiente; tira certificado e numeracao do sandbox', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  await comSpedy(ok({ id: 'empresa-prod', apiCredentials: { apiKey: 'chave-prod' } }), async (chamadas) => {
    const r = await s.passarParaProducao({ tenantId: 'loja', uid: 'admin' });
    assert.deepEqual(r, { companyId: 'empresa-prod', environment: 'production' });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, 'https://api.spedy.com.br/v1/companies');
    assert.equal(chamadas[0].opcoes.method, 'POST');
    assert.equal(chamadas[0].opcoes.headers['X-Api-Key'], 'mestra-prod');
  });
  const config = fake.ler('configuracoes/loja');
  assert.equal(config.spedyEnvironment, 'production');
  assert.equal(config.spedyCompanyId, 'empresa-prod');
  assert.equal(config.spedyApiKeyConfigured, true);
  assert.equal('spedyCertificadoValidade' in config, false);
  assert.equal('spedyCertificadoStatus' in config, false);
  assert.equal('spedyNumeracao' in config, false);
  assert.equal(config.nomeOficina, 'LOJA DEMONSTRACAO', 'o resto de Configuracoes fica');
  const privada = fake.ler('configuracoes_privadas/loja');
  assert.equal(privada.spedyApiKey, 'chave-prod');
  assert.deepEqual(privada.nfceCsc, { csc: 'CSC', tokenId: '01' }, 'o CSC fica; a tela pede o de producao');
});

test('Spedy recusa ou nao devolve a chave: nada muda na empresa, mensagem em portugues', async () => {
  const fake = criarBancoFalso(base());
  const s = carregar(fake.db);
  await comSpedy({ ok: false, status: 422, json: async () => ({ errors: [{ message: 'CNPJ já cadastrado' }] }) }, async () => {
    await assert.rejects(() => s.passarParaProducao({ tenantId: 'loja', uid: 'admin' }), (e) => e.status === 422 && /recusou o cadastro em produção: CNPJ já cadastrado\. Nada foi alterado/.test(e.message));
  });
  await comSpedy(ok({ id: 'empresa-prod' }), async () => {
    await assert.rejects(() => s.passarParaProducao({ tenantId: 'loja', uid: 'admin' }), (e) => e.status === 502 && /não devolveu a chave/.test(e.message));
  });
  assert.equal(fake.ler('configuracoes/loja').spedyEnvironment, 'sandbox');
  assert.equal(fake.ler('configuracoes/loja').spedyCompanyId, 'empresa-sandbox');
  assert.equal(fake.ler('configuracoes_privadas/loja').spedyApiKey, 'chave-sandbox');
});

test('recusa antes de falar com a Spedy: ja em producao, sem cadastro, sem cidade, sem chave mestra de producao', async () => {
  const casos = [
    [base({ spedyEnvironment: 'production' }), /já está no ambiente de produção/],
    [base({ spedyCompanyId: null }), /ainda não foi cadastrada na Spedy/],
    [base({ nfseCidadeCodigo: '' }), /não tem cidade cadastrada para a Spedy/],
    [{ ...base(), 'plataforma/spedy': { masterApiKeySandbox: 'so-sandbox' } }, /chave mestra da Spedy de produção ainda não foi configurada/],
  ];
  for (const [dados, mensagem] of casos) {
    const fake = criarBancoFalso(dados);
    const s = carregar(fake.db);
    await comSpedy(ok({}), async (chamadas) => {
      await assert.rejects(() => s.passarParaProducao({ tenantId: 'loja', uid: 'admin' }), mensagem);
      assert.equal(chamadas.length, 0, 'nao chama a Spedy');
    });
  }
});
