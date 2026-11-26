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
  'usuarios/adm2': { tenantId: 'loja', role: 'Master' },
  'usuarios/loja': { tenantId: 'loja', role: 'Master' },
  'usuarios/fora': { tenantId: 'outra', role: 'Funcionario' },
});

const chamar = async (m, user, usuarioId, permissao = 'administrativo.equipe_editar') => {
  let status = 200;
  let passou = false;
  let erro = '';
  const res = { status(s) { status = s; return this; }, json(corpo) { erro = corpo && corpo.error; return this; } };
  await m.podeGerirFuncionario(permissao)({ user, body: { usuarioId } }, res, () => { passou = true; });
  chamar.ultimoErro = erro;
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
  assert.equal(await chamar(m, { uid: 'loja', tenantId: 'loja', role: 'Master', dono: true }, 'g2'), 'passou');
});

/*
 * Troca do administrador (25/11/2026): o dono mexe em todos (inclusive no
 * administrador); o administrador, com a permissao da acao, em funcionario e
 * gerente -- nunca no dono nem em outro administrador; ele mesmo, so' ficha e senha.
 */
const ADM = { uid: 'adm', tenantId: 'loja', role: 'Admin', isAdministrador: true, permissoes: [] };
const ADM_SALVO_SEM_EQUIPE = { ...ADM, permissoes: ['pacote.administrador-1', 'vendas.pedidos'] };

test('administrador sem o pacote salvo (= todas) gere funcionario e gerente; nao o dono nem outro administrador', async () => {
  const m = carregar(banco().db);
  assert.equal(await chamar(m, ADM, 'f1'), 'passou');
  assert.equal(await chamar(m, ADM, 'g2'), 'passou');
  assert.equal(await chamar(m, ADM, 'adm2'), 403);
  assert.match(chamar.ultimoErro, /só o dono da empresa altera/);
  assert.equal(await chamar(m, ADM, 'loja'), 403);
  assert.equal(await chamar(m, ADM, 'fora'), 403);
  // Ele mesmo: a ficha e a senha sim; inativar ou permissoes, nao.
  assert.equal(await chamar(m, ADM, 'adm'), 'passou');
  assert.equal(await chamar(m, ADM, 'adm', 'administrativo.equipe_senha'), 'passou');
  assert.equal(await chamar(m, ADM, 'adm', 'administrativo.equipe_inativar'), 403);
  assert.equal(await chamar(m, ADM, 'adm', 'administrativo.equipe_permissoes'), 403);
});

test('administrador salvo pelo dono sem a permissao de Equipe e barrado com a mensagem em portugues', async () => {
  const m = carregar(banco().db);
  assert.equal(await chamar(m, ADM_SALVO_SEM_EQUIPE, 'f1'), 403);
  assert.match(chamar.ultimoErro, /Você não tem permissão para alterar a ficha do funcionário/);
  assert.equal(await chamar(m, { ...ADM_SALVO_SEM_EQUIPE, permissoes: [...ADM_SALVO_SEM_EQUIPE.permissoes, 'administrativo.equipe_editar'] }, 'f1'), 'passou');
});

test('dono e plataforma mexem em todos, inclusive no administrador', async () => {
  const m = carregar(banco().db);
  assert.equal(await chamar(m, { uid: 'loja', tenantId: 'loja', role: 'Master', dono: true }, 'adm'), 'passou');
  assert.equal(await chamar(m, { uid: 'loja', tenantId: 'loja', role: 'Master', dono: true }, 'adm', 'administrativo.equipe_permissoes'), 'passou');
  assert.equal(await chamar(m, { uid: 'sup', tenantId: 'loja', role: 'SuperAdmin', isPlatformAdmin: true }, 'adm'), 'passou');
});

test('bloco B (25/11/2026): dados do dono so o proprio dono; de administrador, so o dono; plataforma pode tudo', async () => {
  const db = criarBancoFalso({
    'usuarios/loja': { tenantId: 'loja', role: 'Master' },
    'usuarios/adm': { tenantId: 'loja', role: 'Admin' },
    'usuarios/adm2': { tenantId: 'loja', role: 'Admin' },
    'usuarios/f1': { tenantId: 'loja', role: 'Funcionario' },
  }).db;
  const m = carregar(db);
  // Formato do req.user depois da troca do administrador (auth.js): dono pelo campo
  // `dono`; administrador com `isAdministrador` e as permissoes (sem pacote = todas).
  const DONO = { uid: 'loja', tenantId: 'loja', role: 'Master', dono: true };
  const ADM = { uid: 'adm', tenantId: 'loja', role: 'Admin', isAdministrador: true, dono: false, permissoes: [] };
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
