const test = require('node:test');
const assert = require('node:assert/strict');
const { criarVerificadorAppCheck, MENSAGEM_BLOQUEIO } = require('../middleware/appCheck');

const requisicao = (caminho, token) => ({
  path: caminho,
  get: (nome) => (nome === 'X-Firebase-AppCheck' ? token : undefined),
});

const resposta = () => {
  const r = { statusCode: 200, corpo: null };
  r.status = (codigo) => { r.statusCode = codigo; return r; };
  r.json = (corpo) => { r.corpo = corpo; return r; };
  return r;
};

const rodar = async (middleware, req) => {
  const res = resposta();
  let passou = false;
  await middleware(req, res, () => { passou = true; });
  return { req, res, passou };
};

const verificar = async (token) => {
  if (token !== 'bom') throw new Error('token invalido');
};

test('modo de observacao: marca e deixa passar (valido, invalido, ausente)', async () => {
  const mw = criarVerificadorAppCheck({ verificar, exigir: () => false });
  const ok = await rodar(mw, requisicao('/financeiro/baixa', 'bom'));
  assert.equal(ok.req.appCheck, 'valido');
  assert.equal(ok.passou, true);
  const ruim = await rodar(mw, requisicao('/financeiro/baixa', 'falso'));
  assert.equal(ruim.req.appCheck, 'invalido');
  assert.equal(ruim.passou, true);
  const sem = await rodar(mw, requisicao('/financeiro/baixa', undefined));
  assert.equal(sem.req.appCheck, 'ausente');
  assert.equal(sem.passou, true);
});

test('com APP_CHECK_EXIGIR: so passa token valido, com mensagem em portugues', async () => {
  const mw = criarVerificadorAppCheck({ verificar, exigir: () => true });
  assert.equal((await rodar(mw, requisicao('/vendas/finalizar', 'bom'))).passou, true);
  const barrado = await rodar(mw, requisicao('/vendas/finalizar', undefined));
  assert.equal(barrado.passou, false);
  assert.equal(barrado.res.statusCode, 401);
  assert.equal(barrado.res.corpo.error, MENSAGEM_BLOQUEIO);
});

test('webhook da Spedy e /health ficam de fora mesmo exigindo', async () => {
  const mw = criarVerificadorAppCheck({ verificar, exigir: () => true });
  const webhook = await rodar(mw, requisicao('/spedy-webhook/segredo', undefined));
  assert.equal(webhook.passou, true);
  assert.equal(webhook.req.appCheck, undefined);
  assert.equal((await rodar(mw, requisicao('/health', undefined))).passou, true);
});

test('encerramento de sessao (sendBeacon, sem cabecalho) passa mesmo exigindo', async () => {
  const mw = criarVerificadorAppCheck({ verificar, exigir: () => true });
  assert.equal((await rodar(mw, requisicao('/sessions/end', undefined))).passou, true);
});
