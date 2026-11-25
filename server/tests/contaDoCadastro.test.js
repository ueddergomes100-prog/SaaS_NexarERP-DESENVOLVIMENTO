const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/*
 * Auditoria de seguranca de 24/11/2026: o cadastro `usuarios/{id}` de vendedor de balcao
 * nasce pela tela, com o id que quem cria quiser. Antes de trocar senha ou emitir login
 * para a CONTA com aquele id, o servidor confere que ela e' mesmo do cadastro
 * (services/contaDoCadastro.js), e o middleware nunca trata login por codigo como equipe
 * da plataforma.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const BASE = {
  'configuracoes/loja': { cnpj: '12.345.678/0001-90' },
  'configuracoes/filial-alheia': { cnpj: '98.765.432/0001-10' },
  'usuarios/loja': { tenantId: 'loja', role: 'Master', status: 'Ativo', email: 'dono@loja.test' },
  'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', email: '12345678000190-ana@nexar.app' },
};

const carregar = (docs, contas = []) => {
  const fake = criarBancoFalso(docs, { consultas: true });
  fake.db.__contasDoAuth = new Map(contas);
  const [servico] = carregarComBancoFalso(fake.db, 'services/contaDoCadastro').slice(-1);
  return { fake, servico };
};

test('cadastro comum: conta que ainda nao existe (vendedor de balcao) ou conta normal passam', async () => {
  const { servico } = carregar(BASE, [['ana', { customClaims: {}, email: '12345678000190-ana@nexar.app' }]]);
  assert.equal(await servico.conferirContaDoCadastro({ id: 'balcao-novo', usuario: { tenantId: 'loja', tipoRegistro: 'vendedor' } }), null);
  const conta = await servico.conferirContaDoCadastro({ id: 'ana', usuario: BASE['usuarios/ana'] });
  assert.equal(conta.uid, 'ana');
});

test('dono da empresa (uid = id da empresa) passa; papel Master gravado na conta nao e\' plataforma', async () => {
  const { servico } = carregar(BASE, [['loja', { customClaims: { role: 'Master', tenantId: 'loja' }, email: 'dono@loja.test' }]]);
  const conta = await servico.conferirContaDoCadastro({ id: 'loja', usuario: BASE['usuarios/loja'] });
  assert.equal(conta.uid, 'loja');
});

test('cadastro com o id de uma filial/empresa que nao e\' dele: recusa em portugues', async () => {
  const { servico } = carregar(BASE);
  await assert.rejects(
    servico.conferirContaDoCadastro({ id: 'filial-alheia', usuario: { tenantId: 'loja', tipoRegistro: 'vendedor' } }),
    (e) => e instanceof servico.ErroContaDoCadastro && e.status === 403 && /identificador dele pertence a outra conta/.test(e.message),
  );
});

test('cadastro com o id de uma conta da plataforma: recusa, em qualquer forma de marcar o papel', async () => {
  for (const marcas of [{ role: 'SuperAdmin' }, { role: 'NexarAdmin' }, { superAdmin: true }, { nexarAdmin: true }]) {
    const { servico } = carregar(BASE, [['uid-equipe', { customClaims: marcas, email: 'equipe@hennder.test' }]]);
    await assert.rejects(
      servico.conferirContaDoCadastro({ id: 'uid-equipe', usuario: { tenantId: 'loja', tipoRegistro: 'vendedor', email: 'equipe@hennder.test' } }),
      (e) => e.status === 403,
      JSON.stringify(marcas),
    );
  }
});

test('erro inesperado do Firebase nao vira "conta nao existe"', async () => {
  const { fake, servico } = carregar(BASE);
  fake.db.__contasDoAuth = { get: () => { throw Object.assign(new Error('rede'), { code: 'auth/internal-error' }); } };
  await assert.rejects(servico.conferirContaDoCadastro({ id: 'ana', usuario: BASE['usuarios/ana'] }), /rede/);
});

/* ---------- middleware: login por codigo nunca vira plataforma ---------- */

const carregarMiddleware = (docs, tokens) => {
  const fake = criarBancoFalso(docs, { consultas: true });
  const base = path.join(__dirname, '..');
  const firebase = require.resolve(path.join(base, 'config/firebase'));
  const authFalso = { verifyIdToken: async (token) => { if (!tokens[token]) throw new Error('token invalido'); return tokens[token]; } };
  require.cache[firebase] = { id: firebase, filename: firebase, loaded: true, exports: { db: fake.db, auth: authFalso, admin: { auth: () => authFalso } } };
  const caminho = require.resolve(path.join(base, 'middleware/auth'));
  delete require.cache[caminho];
  return require(caminho);
};

const chamar = async (authenticate, token) => {
  const req = { headers: { authorization: `Bearer ${token}` }, query: {} };
  const resposta = { codigo: 200, corpo: null };
  const res = { status(c) { resposta.codigo = c; return this; }, json(b) { resposta.corpo = b; return this; } };
  let passou = false;
  await authenticate(req, res, () => { passou = true; });
  return { passou, req, ...resposta };
};

test('middleware: papel de plataforma no token vale com usuario e senha, nunca em login por codigo', async () => {
  const { authenticate } = carregarMiddleware({
    // Ficha criada por uma empresa com o uid da equipe da plataforma (vendedor de balcao).
    'usuarios/uid-equipe': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', tipoRegistro: 'vendedor' },
  }, {
    senha: { uid: 'uid-equipe', role: 'SuperAdmin', firebase: { sign_in_provider: 'password' } },
    codigo: { uid: 'uid-equipe', role: 'SuperAdmin', isVendedorBalcao: true, firebase: { sign_in_provider: 'custom' } },
  });

  // Com usuario e senha: continua plataforma, e a ficha plantada nao o barra.
  const porSenha = await chamar(authenticate, 'senha');
  assert.equal(porSenha.passou, true);
  assert.equal(porSenha.req.user.isPlatformAdmin, true);

  // Por codigo: entra so' como o que a ficha diz (funcionario), sem papel de plataforma.
  const porCodigo = await chamar(authenticate, 'codigo');
  assert.equal(porCodigo.passou, true);
  assert.equal(porCodigo.req.user.isPlatformAdmin, false);
  assert.equal(porCodigo.req.user.role, 'Funcionario');
});

test('middleware: funcionario inativo e vendedor de balcao sem a marca continuam barrados', async () => {
  const { authenticate } = carregarMiddleware({
    'usuarios/inativo': { tenantId: 'loja', role: 'Funcionario', status: 'Inativo' },
    'usuarios/balcao': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', tipoRegistro: 'vendedor' },
  }, {
    a: { uid: 'inativo', firebase: { sign_in_provider: 'password' } },
    b: { uid: 'balcao', firebase: { sign_in_provider: 'password' } },
  });
  assert.equal((await chamar(authenticate, 'a')).codigo, 403);
  assert.equal((await chamar(authenticate, 'b')).codigo, 403);
});
