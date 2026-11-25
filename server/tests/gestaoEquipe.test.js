const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Quem gere um funcionario (26/10/2026): dono/administrador sempre; gerente com
 * "Admin: Equipe e Acessos" so' sobre funcionario comum -- nunca outro gerente,
 * administrador, o dono ou a si mesmo.
 */

const carregar = (db) => carregarComBancoFalso(db, 'middleware/gestaoEquipe')[3];

const GERENTE = { uid: 'g1', tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente', permissoes: ['administrativo.equipe'] };

const banco = () => criarBancoFalso({
  'usuarios/g1': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente' },
  'usuarios/g2': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente' },
  'usuarios/f1': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'funcionario' },
  'usuarios/s1': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'supervisor' },
  'usuarios/adm': { tenantId: 'loja', role: 'Admin' },
  'usuarios/fora': { tenantId: 'outra', role: 'Funcionario' },
});

const chamar = async (m, user, usuarioId) => {
  let status = 200;
  let passou = false;
  const res = { status(s) { status = s; return this; }, json() { return this; } };
  await m.podeGerirFuncionario({ user, body: { usuarioId } }, res, () => { passou = true; });
  return passou ? 'passou' : status;
};

test('gerente gere funcionario e supervisor comum; nao gerente, admin, ele mesmo, outra empresa', async () => {
  const m = carregar(banco().db);
  assert.equal(await chamar(m, GERENTE, 'f1'), 'passou');
  assert.equal(await chamar(m, GERENTE, 's1'), 'passou');
  assert.equal(await chamar(m, GERENTE, 'g2'), 403);
  assert.equal(await chamar(m, GERENTE, 'adm'), 403);
  assert.equal(await chamar(m, GERENTE, 'g1'), 403);
  assert.equal(await chamar(m, GERENTE, 'fora'), 403);
});

test('gerente sem Equipe e Acessos e funcionario comum nao gerem; administrador sim', async () => {
  const m = carregar(banco().db);
  assert.equal(await chamar(m, { ...GERENTE, permissoes: [] }, 'f1'), 403);
  assert.equal(await chamar(m, { ...GERENTE, nivelAcesso: 'funcionario' }, 'f1'), 403);
  assert.equal(await chamar(m, { uid: 'adm', tenantId: 'loja', role: 'Admin', isTenantManager: true }, 'g2'), 'passou');
});

test('bloco B (25/11/2026): dados do dono so o proprio dono; de administrador, so o dono; plataforma pode tudo', async () => {
  const db = criarBancoFalso({
    'usuarios/loja': { tenantId: 'loja', role: 'Master' },
    'usuarios/adm': { tenantId: 'loja', role: 'Admin' },
    'usuarios/adm2': { tenantId: 'loja', role: 'Admin' },
    'usuarios/f1': { tenantId: 'loja', role: 'Funcionario' },
  }).db;
  const m = carregar(db);
  const DONO = { uid: 'loja', tenantId: 'loja', role: 'Master', isTenantManager: true, dono: true };
  const ADM = { uid: 'adm', tenantId: 'loja', role: 'Admin', isTenantManager: true, dono: false };
  const PLATAFORMA = { uid: 'p1', tenantId: 'p1', role: 'SuperAdmin', isPlatformAdmin: true };
  assert.equal(await chamar(m, ADM, 'loja'), 403, 'administrador nao mexe no dono');
  assert.equal(await chamar(m, ADM, 'adm2'), 403, 'administrador nao mexe em outro administrador');
  assert.equal(await chamar(m, ADM, 'adm'), 'passou', 'administrador mexe na propria ficha');
  assert.equal(await chamar(m, ADM, 'f1'), 'passou');
  assert.equal(await chamar(m, DONO, 'adm'), 'passou', 'o dono mexe no administrador');
  assert.equal(await chamar(m, DONO, 'loja'), 'passou', 'o dono mexe na propria ficha');
  assert.equal(await chamar(m, PLATAFORMA, 'loja'), 'passou');
  const motivo = await m.motivoGestorNaoPodeNoAlvo(ADM, 'loja');
  assert.match(motivo, /Só o próprio dono/);
});
