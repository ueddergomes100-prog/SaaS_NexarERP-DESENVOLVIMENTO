const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Inutilizacao de numeracao (21/10/2026): o servidor confere a faixa, recusa
 * numero usado por nota do sistema, manda a Spedy e guarda o resultado.
 */

const chamadas = [];
let resposta = null;
const caminhoFetch = require.resolve(path.join(__dirname, '..', 'utils/fetchComTimeout'));
require.cache[caminhoFetch] = {
  id: caminhoFetch, filename: caminhoFetch, loaded: true,
  exports: {
    PERFIS: { spedyEmissao: {}, spedyLeitura: {} },
    fetchComTimeout: async (url, init) => {
      chamadas.push({ url, metodo: init.method, corpo: init.body ? JSON.parse(init.body) : null });
      return { ok: resposta.ok !== false, status: resposta.status || 200, json: async () => resposta.corpo };
    },
  },
};

const carregar = (db) => carregarComBancoFalso(db, 'services/spedyAcesso', 'services/inutilizacao').pop();

const USER = { uid: 'u1', tenantId: 'loja', email: 'u@loja', nome: 'FISCAL' };
const MOTIVO = 'Quebra de sequência por falha antes do envio';
const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', spedyEnabled: true, spedyEnvironment: 'sandbox' },
  'configuracoes_privadas/loja': { spedyApiKey: 'chave-teste' },
  'notas_fiscais/n1': { tenantId: 'loja', tipo: 'NFC-e', number: 10, status: 'authorized', clienteNome: 'MARIA' },
  'notas_fiscais/n2': { tenantId: 'loja', tipo: 'NFC-e', number: 11, status: 'rejected' },
  'notas_fiscais/n3': { tenantId: 'loja', tipo: 'NF-e', number: 12, status: 'authorized' },
  'notas_fiscais/n4': { tenantId: 'outra', tipo: 'NFC-e', number: 13, status: 'authorized' },
  ...extra,
});
const pedido = (extra = {}) => ({ modelo: 'nfce', serie: 1, inicial: 11, final: 13, motivo: MOTIVO, ...extra });

test('inutiliza a faixa livre: manda a Spedy (NFC-e) e guarda o resultado', async () => {
  chamadas.length = 0;
  resposta = { corpo: { id: '3f1c2b7e-0000-4000-8000-000000000001', status: 'registered', protocolNumber: '135000', environment: 'development', series: '1' } };
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).solicitar({ user: USER, tenantId: 'loja', corpo: pedido() });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://sandbox-api.spedy.com.br/v1/consumer-invoices/disablements');
  assert.deepEqual(chamadas[0].corpo, { series: 1, initialNumber: 11, finalNumber: 13, reason: MOTIVO });
  assert.equal(r.status, 'registered');
  const gravada = fake.ler(`inutilizacoes/${r.id}`);
  assert.equal(gravada.protocolo, '135000');
  assert.equal(gravada.solicitadoPor, 'u1');
  assert.equal(gravada.inicial, 11);
});

test('numero de nota autorizada do sistema nao vai para a SEFAZ; faixa repetida tambem nao', async () => {
  chamadas.length = 0;
  const fake = criarBancoFalso(base({
    'inutilizacoes/i1': { tenantId: 'loja', modelo: 'nfce', serie: 1, inicial: 20, final: 25, status: 'registered' },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.solicitar({ user: USER, tenantId: 'loja', corpo: pedido({ inicial: 9, final: 10 }) }),
    (e) => e.status === 409 && /nº 10 \(autorizada, MARIA\)/.test(e.message),
  );
  await assert.rejects(
    () => s.solicitar({ user: USER, tenantId: 'loja', corpo: pedido({ inicial: 24, final: 30 }) }),
    (e) => e.status === 409 && /já foi inutilizada/.test(e.message),
  );
  await assert.rejects(() => s.solicitar({ user: USER, tenantId: 'loja', corpo: pedido({ motivo: 'curto' }) }), (e) => e.status === 400);
  assert.equal(chamadas.length, 0);
});

test('Spedy recusa: a mensagem dela sobe e nada e gravado', async () => {
  resposta = { ok: false, status: 400, corpo: { errors: [{ message: 'Série inexistente para esta empresa.' }] } };
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).solicitar({ user: USER, tenantId: 'loja', corpo: pedido({ modelo: 'nfe', inicial: 1, final: 1 }) }),
    (e) => e.status === 400 && /Série inexistente/.test(e.message),
  );
  assert.equal((await fake.db.collection('inutilizacoes').where('tenantId', '==', 'loja').get()).size, 0);
});

test('consultar atualiza a situacao; de outra empresa nao acha; listar so a da empresa', async () => {
  chamadas.length = 0;
  const fake = criarBancoFalso(base({
    'inutilizacoes/i1': { tenantId: 'loja', modelo: 'nfe', serie: 1, inicial: 5, final: 5, status: 'inProcessing', spedyId: '3f1c2b7e-0000-4000-8000-000000000002' },
    'inutilizacoes/i2': { tenantId: 'outra', modelo: 'nfe', serie: 1, inicial: 5, final: 5, status: 'registered', spedyId: '3f1c2b7e-0000-4000-8000-000000000003' },
  }), { consultas: true });
  const s = carregar(fake.db);
  resposta = { corpo: { status: 'rejected', messageCode: '563', messageText: 'Já existe pedido de inutilização com a mesma faixa' } };
  const r = await s.consultar({ tenantId: 'loja', id: 'i1' });
  assert.equal(chamadas[0].url, 'https://sandbox-api.spedy.com.br/v1/product-invoices/disablements/3f1c2b7e-0000-4000-8000-000000000002');
  assert.equal(r.status, 'rejected');
  assert.equal(fake.ler('inutilizacoes/i1').codigoSefaz, '563');
  await assert.rejects(() => s.consultar({ tenantId: 'loja', id: 'i2' }), (e) => e.status === 404);
  const lista = await s.listar({ tenantId: 'loja' });
  assert.deepEqual(lista.map((i) => i.id), ['i1']);
});
