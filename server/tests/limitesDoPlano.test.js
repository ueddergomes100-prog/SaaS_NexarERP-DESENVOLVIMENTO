const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Limites do plano pelo servidor (19/10/2026): criar login e ligar o app
 * Vendas conferem o limite contratado; o login do app pelo codigo confere a vaga.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/limitesDoPlano')[3];

const ADMIN = { uid: 'dono', tenantId: 'loja', isTenantManager: true };
const CNPJ = '12345678000199';

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', cnpj: CNPJ },
  'usuarios/loja': { tenantId: 'loja', role: 'Master', limiteUsuarios: 2, limiteAcessoMobile: 1 },
  ...extra,
});

const novo = (extra = {}) => ({ nome: 'JOAO', usuario: 'joao', senha: '123456', ...extra });

test('criar login dentro do limite: conta, cadastro e indice de login', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo({ codigoVendedor: '7' }) });
  assert.equal(r.limite, 2);
  assert.equal(r.emUso, 2);
  const cadastro = fake.ler(`usuarios/${r.uid}`);
  assert.equal(cadastro.role, 'Funcionario');
  assert.equal(cadastro.status, 'Ativo');
  assert.deepEqual(cadastro.permissoes, []);
  assert.equal(cadastro.codigoVendedor, '07');
  assert.equal(cadastro.username, `${CNPJ}-joao`);
  assert.deepEqual(fake.ler(`usernames/${CNPJ}-joao`), { email: `${CNPJ}-joao@nexar.app`, tenantId: 'loja' });
});

test('criar login acima do limite e\' recusado; vendedor de balcao nao conta', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/u2': { tenantId: 'loja', role: 'Funcionario' },
    'usuarios/v1': { tenantId: 'loja', role: 'Funcionario', tipoRegistro: 'vendedor' },
  }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo() }),
    (erro) => erro.status === 409 && /limite de 2 usuários/.test(erro.message),
  );
});

test('na filial vale o limite da matriz', async () => {
  const fake = criarBancoFalso({
    'configuracoes/filial': { tenantId: 'filial', cnpj: '98765432000188', grupoId: 'g1' },
    'grupos/g1': { matrizTenantId: 'matriz' },
    'usuarios/matriz': { tenantId: 'matriz', role: 'Master', limiteUsuarios: 0 },
  }, { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).criarLogin({ user: { ...ADMIN, tenantId: 'filial' }, tenantId: 'filial', corpo: novo() }),
    (erro) => erro.status === 409,
  );
});

test('usuario repetido, codigo em uso e CNPJ faltando sao recusados com mensagem', async () => {
  const fake = criarBancoFalso(base({ 'usuarios/loja': { tenantId: 'loja', role: 'Master', limiteUsuarios: 10, codigoVendedor: '05' } }), { consultas: true });
  const s = carregar(fake.db);
  await s.criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo() });
  await assert.rejects(() => s.criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo() }), (erro) => erro.status === 409 && /já está em uso/.test(erro.message));
  await assert.rejects(() => s.criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo({ usuario: 'maria', codigoVendedor: '5' }) }), (erro) => erro.status === 409 && /código 05/.test(erro.message));
  const semCnpj = criarBancoFalso({ 'configuracoes/loja': { tenantId: 'loja' }, 'usuarios/loja': { tenantId: 'loja', role: 'Master' } }, { consultas: true });
  await assert.rejects(() => carregar(semCnpj.db).criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo() }), (erro) => erro.status === 400 && /CNPJ/.test(erro.message));
});

test('ligar o app confere a vaga; vendedor ganha o indice de login', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/v1': { tenantId: 'loja', role: 'Funcionario', tipoRegistro: 'vendedor', codigoVendedor: '07' },
    'usuarios/v2': { tenantId: 'loja', role: 'Funcionario', tipoRegistro: 'vendedor', codigoVendedor: '08' },
  }), { consultas: true });
  const s = carregar(fake.db);
  await s.alterarAcessoApp({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'v1', ligar: true } });
  assert.equal(fake.ler('usuarios/v1').acessoAppMobile, true);
  assert.ok(fake.ler('usuarios/v1').acessoAppMobileEm);
  assert.deepEqual(fake.ler(`vendedores_mobile_login/${CNPJ}-07`), { tenantId: 'loja', vendedorId: 'v1' });
  await assert.rejects(
    () => s.alterarAcessoApp({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'v2', ligar: true } }),
    (erro) => erro.status === 409 && /limite de 1 acesso/.test(erro.message),
  );
  await s.alterarAcessoApp({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'v1', ligar: false } });
  assert.equal(fake.ler('usuarios/v1').acessoAppMobile, false);
  assert.equal(fake.ler(`vendedores_mobile_login/${CNPJ}-07`), undefined);
});

test('login do app: quem passou do limite (o ultimo a ganhar o acesso) nao entra', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/antigo': { tenantId: 'loja', role: 'Funcionario', tipoRegistro: 'vendedor', acessoAppMobile: true },
    'usuarios/novo': { tenantId: 'loja', role: 'Funcionario', tipoRegistro: 'vendedor', acessoAppMobile: true, acessoAppMobileEm: '2026-10-19T12:00:00.000Z' },
  }), { consultas: true });
  const s = carregar(fake.db);
  assert.equal(await s.vagaNoApp('loja', 'antigo'), null);
  assert.match(String(await s.vagaNoApp('loja', 'novo')), /mais pessoas com o aplicativo ligado do que o plano permite \(1\)/);
});
