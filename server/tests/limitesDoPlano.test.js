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

test('criar login de motorista: motorista vinculado, permissao de entregas e app se houver vaga (26/10/2026)', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).criarLogin({ user: { uid: 'gerente', tenantId: 'loja' }, tenantId: 'loja', corpo: novo({ nome: 'Carlos', motorista: { telefone: ' 33999 ', cnh: '123' } }) });
  assert.equal(r.motorista, true);
  assert.equal(r.appLiberado, true);
  const cadastro = fake.ler(`usuarios/${r.uid}`);
  assert.deepEqual(cadastro.permissoes, ['operacoes.entregas_app']);
  assert.equal(cadastro.acessoAppMobile, true);
  assert.equal(cadastro.nivelAcesso, 'funcionario');
  const motorista = fake.ler(`motoristas/${r.uid}`);
  assert.equal(motorista.nome, 'CARLOS');
  assert.equal(motorista.telefone, '33999');
  assert.equal(motorista.usuarioId, r.uid);
  assert.equal(motorista.tenantId, 'loja');
  assert.equal(motorista.ativo, true);
});

test('criar login de motorista sem vaga no app: cria o login e o motorista, app desligado', async () => {
  const fake = criarBancoFalso(base({ 'usuarios/loja': { tenantId: 'loja', role: 'Master', limiteUsuarios: 5, limiteAcessoMobile: 1, acessoAppMobile: true } }), { consultas: true });
  const r = await carregar(fake.db).criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo({ motorista: {} }) });
  assert.equal(r.appLiberado, false);
  assert.equal(fake.ler(`usuarios/${r.uid}`).acessoAppMobile, undefined);
  assert.equal(fake.ler(`motoristas/${r.uid}`).usuarioId, r.uid);
});

test('criar login sem motorista nao cria motorista', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).criarLogin({ user: ADMIN, tenantId: 'loja', corpo: novo() });
  assert.equal(r.motorista, undefined);
  assert.equal(fake.ler(`motoristas/${r.uid}`), undefined);
});

test('vincular motorista ja cadastrado: id do motorista nao muda, permissao de entregas e app (26/10/2026)', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/carlos': { tenantId: 'loja', role: 'Funcionario', nome: 'CARLOS', permissoes: ['vendas.pedido'] },
    'motoristas/m1': { tenantId: 'loja', nome: 'CARLOS SILVA', ativo: true },
  }), { consultas: true });
  const r = await carregar(fake.db).vincularMotorista({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', motoristaId: 'm1' } });
  assert.equal(r.appLiberado, true);
  assert.equal(fake.ler('motoristas/m1').usuarioId, 'carlos');
  const u = fake.ler('usuarios/carlos');
  assert.equal(u.motoristaId, 'm1');
  assert.deepEqual(u.permissoes, ['vendas.pedido', 'operacoes.entregas_app']);
  assert.equal(u.acessoAppMobile, true);
});

test('vincular motorista: recusa motorista de outro usuario, usuario ja vinculado e outra empresa', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/carlos': { tenantId: 'loja', role: 'Funcionario', nome: 'CARLOS' },
    'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', nome: 'ANA', motoristaId: 'm2' },
    'motoristas/m1': { tenantId: 'loja', nome: 'M1', usuarioId: 'ana' },
    'motoristas/m2': { tenantId: 'loja', nome: 'M2', usuarioId: 'ana' },
    'motoristas/m3': { tenantId: 'loja', nome: 'M3' },
    'motoristas/fora': { tenantId: 'outra', nome: 'FORA' },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.vincularMotorista({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', motoristaId: 'm1' } }), (e) => e.status === 409 && /outro usuário/.test(e.message));
  await assert.rejects(() => s.vincularMotorista({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'ana', motoristaId: 'm3' } }), (e) => e.status === 409 && /outro motorista/.test(e.message));
  await assert.rejects(() => s.vincularMotorista({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', motoristaId: 'fora' } }), (e) => e.status === 404);
});

test('ficha do funcionario: nome e codigo; codigo repetido recusa; marcar motorista cria o vinculado (26/10/2026)', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/carlos': { tenantId: 'loja', role: 'Funcionario', nome: 'CARLOS', codigoVendedor: '03', permissoes: [] },
    'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', nome: 'ANA', codigoVendedor: '05' },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.editarFicha({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', nome: 'CARLOS', codigoVendedor: '5' } }), (e) => e.status === 409 && /05/.test(e.message));
  const r = await s.editarFicha({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', nome: 'Carlos Souza', codigoVendedor: '7', motorista: { telefone: '1', cnh: '2' } } });
  assert.equal(r.motorista.novo, true);
  const u = fake.ler('usuarios/carlos');
  assert.equal(u.nome, 'Carlos Souza');
  assert.equal(u.codigoVendedor, '07');
  assert.deepEqual(u.permissoes, ['operacoes.entregas_app']);
  assert.equal(fake.ler('motoristas/carlos').usuarioId, 'carlos');
  await assert.rejects(() => s.editarFicha({ user: ADMIN, tenantId: 'outra', corpo: { usuarioId: 'carlos', nome: 'X' } }), (e) => e.status === 404);
});

test('situacao: inativa e reativa; dono nao', async () => {
  const fake = criarBancoFalso(base({ 'usuarios/carlos': { tenantId: 'loja', role: 'Funcionario', nome: 'CARLOS', status: 'Ativo' } }), { consultas: true });
  const s = carregar(fake.db);
  await s.alterarSituacao({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', ativo: false } });
  assert.equal(fake.ler('usuarios/carlos').status, 'Inativo');
  await s.alterarSituacao({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', ativo: true } });
  assert.equal(fake.ler('usuarios/carlos').status, 'Ativo');
  await assert.rejects(() => s.alterarSituacao({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'loja', ativo: false } }), (e) => e.status === 400);
});

test('permissoes pelo servidor: grava com o marcador do app; gerente so mexe no que tem (26/10/2026)', async () => {
  const fake = criarBancoFalso(base({
    'usuarios/carlos': { tenantId: 'loja', role: 'Funcionario', nome: 'CARLOS', permissoes: ['vendas.pedidos'] },
    'usuarios/adm': { tenantId: 'loja', role: 'Admin', nome: 'ADM' },
  }), { consultas: true });
  const s = carregar(fake.db);
  // Administrador tira "Consultar preco" de quem nunca teve o app gravado.
  await s.salvarPermissoes({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'carlos', permissoes: ['vendas.pedidos', 'app.pedido'], nivelAcesso: 'supervisor' }, gerente: false });
  const u = fake.ler('usuarios/carlos');
  assert.deepEqual([...u.permissoes].sort(), ['app.definido', 'app.pedido', 'vendas.pedidos']);
  assert.equal(u.nivelAcesso, 'supervisor');
  // Gerente sem "financeiro.pagar" nao da' essa permissao; nem muda o nivel.
  const gerente = { uid: 'g1', tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente', permissoes: ['vendas.pedidos', 'administrativo.equipe'] };
  await assert.rejects(() => s.salvarPermissoes({ user: gerente, tenantId: 'loja', corpo: { usuarioId: 'carlos', permissoes: ['vendas.pedidos', 'app.pedido', 'financeiro.pagar'] }, gerente: true }), (e) => e.status === 403 && /financeiro\.pagar/.test(e.message));
  // Gerente (que nunca teve o app gravado, entao "tem" as chaves do app) devolve o Consultar preco.
  await s.salvarPermissoes({ user: gerente, tenantId: 'loja', corpo: { usuarioId: 'carlos', permissoes: ['vendas.pedidos', 'app.pedido', 'app.preco'], nivelAcesso: 'gerente' }, gerente: true });
  const depois = fake.ler('usuarios/carlos');
  assert.ok(depois.permissoes.includes('app.preco'));
  assert.equal(depois.nivelAcesso, 'supervisor', 'gerente nao muda o nivel');
  // Administrador/dono nao tem permissao por modulo.
  await assert.rejects(() => s.salvarPermissoes({ user: ADMIN, tenantId: 'loja', corpo: { usuarioId: 'adm', permissoes: [] }, gerente: false }), (e) => e.status === 400);
});
