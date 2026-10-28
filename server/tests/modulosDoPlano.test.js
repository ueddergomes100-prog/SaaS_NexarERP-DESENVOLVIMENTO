const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/modulosDoPlano')[3];
const ADMIN = { uid: 'plataforma', isPlatformAdmin: true };

const comGrupo = () => ({
  'usuarios/dono': { tenantId: 'dono', role: 'Master', modulosBloqueados: ['operacoes.producao'] },
  'configuracoes/dono': { tenantId: 'dono', grupoId: 'g1', modulosBloqueados: ['operacoes.producao'] },
  'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1' },
  'grupos/g1': {
    matrizTenantId: 'dono',
    filiais: [{ tenantId: 'dono', codigo: '10' }, { tenantId: 'f20', codigo: '20' }],
    modulosBloqueados: ['operacoes.producao'],
  },
});

test('bloquear depois de criar a filial chega ao grupo: o dono, a configuracao e as filiais ficam iguais', async () => {
  const fake = criarBancoFalso(comGrupo());
  const s = carregar(fake.db);
  const r = await s.salvarModulosBloqueados({ user: ADMIN, tenantId: 'dono', modulos: ['comercial.cashback', 'operacoes.producao', 'comercial.cashback'] });

  const esperado = ['comercial.cashback', 'operacoes.producao'];
  assert.deepEqual(r, { tenantId: 'dono', modulosBloqueados: esperado, filiais: 1 });
  assert.deepEqual(fake.ler('usuarios/dono').modulosBloqueados, esperado);
  assert.deepEqual(fake.ler('configuracoes/dono').modulosBloqueados, esperado);
  assert.deepEqual(fake.ler('grupos/g1').modulosBloqueados, esperado, 'as filiais leem o plano do grupo');
  assert.equal(fake.ler('configuracoes/dono').grupoId, 'g1', 'a configuracao nao perde o resto');
});

test('liberar tudo tambem chega ao grupo', async () => {
  const fake = criarBancoFalso(comGrupo());
  await carregar(fake.db).salvarModulosBloqueados({ user: ADMIN, tenantId: 'dono', modulos: [] });
  assert.deepEqual(fake.ler('grupos/g1').modulosBloqueados, []);
  assert.deepEqual(fake.ler('usuarios/dono').modulosBloqueados, []);
});

test('pedido feito numa filial grava no plano da matriz', async () => {
  const fake = criarBancoFalso(comGrupo());
  const r = await carregar(fake.db).salvarModulosBloqueados({ user: ADMIN, tenantId: 'f20', modulos: ['crm.agenda'] });
  assert.equal(r.tenantId, 'dono');
  assert.deepEqual(fake.ler('usuarios/dono').modulosBloqueados, ['crm.agenda']);
  assert.deepEqual(fake.ler('grupos/g1').modulosBloqueados, ['crm.agenda']);
  assert.equal(fake.ler('usuarios/f20'), undefined, 'filial nao tem usuario proprio');
});

test('empresa sem filiais: grava no dono e cria a configuracao se faltar', async () => {
  const fake = criarBancoFalso({ 'usuarios/solo': { tenantId: 'solo', role: 'Master' } });
  const r = await carregar(fake.db).salvarModulosBloqueados({ user: ADMIN, tenantId: 'solo', modulos: ['fiscal.nfe'] });
  assert.equal(r.filiais, 0);
  assert.deepEqual(fake.ler('usuarios/solo').modulosBloqueados, ['fiscal.nfe']);
  assert.equal(fake.ler('configuracoes/solo').tenantId, 'solo');
});

test('lista invalida e empresa inexistente sao recusadas com mensagem em portugues', async () => {
  const fake = criarBancoFalso(comGrupo());
  const s = carregar(fake.db);
  await assert.rejects(s.salvarModulosBloqueados({ user: ADMIN, tenantId: 'dono', modulos: 'tudo' }), /Envie a lista/);
  await assert.rejects(s.salvarModulosBloqueados({ user: ADMIN, tenantId: 'dono', modulos: ['x'] }), /Módulo inválido/);
  await assert.rejects(s.salvarModulosBloqueados({ user: ADMIN, tenantId: 'nao-existe', modulos: [] }), /não foi encontrado/);
});
