const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Filial padrao (15/10/2026): no login o usuario comeca na filial padrao
 * (quem usa outras filiais) ou na de cadastro. Firestore falso em memoria.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/filiais')[3];

const filial = (tenantId, codigo, matriz, ativa = true) => ({
  tenantId, codigo, nome: `LOJA ${codigo}`, cnpj: '', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', matriz, ativa,
});

const cenario = (extra = {}) => ({
  'grupos/g1': {
    nome: 'SHOPPING RURAL', donoUid: 'dono', matrizTenantId: 'dono',
    filiais: [filial('dono', '10', true), filial('f20', '20', false), filial('f30', '30', false, false)], modulosBloqueados: [],
  },
  'configuracoes/dono': { tenantId: 'dono', grupoId: 'g1' },
  'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1' },
  'usuarios/dono': { tenantId: 'dono', role: 'Master' },
  'usuarios/vend': { tenantId: 'dono', role: 'Funcionario', nome: 'JOAO', permissoes: ['filiais.utilizar'] },
  'usuarios/caixa': { tenantId: 'f20', role: 'Funcionario', nome: 'MARIA', permissoes: [] },
  ...extra,
});

const DONO = { uid: 'dono', tenantId: 'dono' };

test('login: quem usa outras filiais cai na padrao, mesmo tendo saido de outra', async () => {
  const fake = criarBancoFalso(cenario({
    'usuarios/vend': { tenantId: 'dono', role: 'Funcionario', permissoes: ['filiais.utilizar'], filialPadrao: 'f20' },
  }));
  const s = carregar(fake.db);
  const r = await s.entrarNaFilialPadrao({ user: { uid: 'vend' } });
  assert.equal(r.mudou, true);
  assert.equal(r.filial.codigo, '20');
  assert.equal(fake.ler('usuarios/vend').filialAtiva, 'f20');

  const deNovo = await s.entrarNaFilialPadrao({ user: { uid: 'vend' } });
  assert.equal(deNovo.mudou, false, 'ja esta na padrao: nao grava de novo');
});

test('login: sem a permissao, volta sempre para a filial de cadastro', async () => {
  const fake = criarBancoFalso(cenario({
    'usuarios/caixa': { tenantId: 'f20', role: 'Funcionario', permissoes: [], filialAtiva: 'dono', filialPadrao: 'dono' },
  }));
  const s = carregar(fake.db);
  const r = await s.entrarNaFilialPadrao({ user: { uid: 'caixa' } });
  assert.equal(r.mudou, true);
  assert.equal(r.filial.codigo, '20');
  assert.equal('filialAtiva' in fake.ler('usuarios/caixa'), false, 'a de cadastro nao precisa de filialAtiva');
});

test('login: empresa sem filiais nao mexe em nada', async () => {
  const fake = criarBancoFalso({ 'usuarios/u1': { tenantId: 'emp', role: 'Master' }, 'configuracoes/emp': { tenantId: 'emp' } });
  const r = await carregar(fake.db).entrarNaFilialPadrao({ user: { uid: 'u1' } });
  assert.deepEqual(r, { mudou: false, filial: null });
});

test('gravar a filial padrao: so\' dono/administrador, com a regra da permissao', async () => {
  const fake = criarBancoFalso(cenario());
  const s = carregar(fake.db);

  const r = await s.definirFilialPadrao({ user: DONO, usuarioId: 'vend', destino: 'f20' });
  assert.equal(r.filial.codigo, '20');
  assert.equal(fake.ler('usuarios/vend').filialPadrao, 'f20');

  await s.definirFilialPadrao({ user: DONO, usuarioId: 'vend', destino: 'dono' });
  assert.equal('filialPadrao' in fake.ler('usuarios/vend'), false, 'igual a de cadastro: o campo sai');

  await assert.rejects(
    s.definirFilialPadrao({ user: DONO, usuarioId: 'caixa', destino: 'dono' }),
    (erro) => erro.status === 400 && /Utiliza outras filiais/.test(erro.message),
  );
  await assert.rejects(
    s.definirFilialPadrao({ user: DONO, usuarioId: 'vend', destino: 'f30' }),
    (erro) => erro.status === 400 && /inativa/.test(erro.message),
  );
  await assert.rejects(
    s.definirFilialPadrao({ user: { uid: 'vend', tenantId: 'dono' }, usuarioId: 'caixa', destino: 'f20' }),
    (erro) => erro.status === 403,
  );
});
