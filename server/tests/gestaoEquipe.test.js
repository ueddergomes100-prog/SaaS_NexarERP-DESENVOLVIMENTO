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
