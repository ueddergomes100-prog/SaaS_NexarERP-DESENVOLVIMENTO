const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * TROCA DO ADMINISTRADOR (item 15 da Embala Minas, 25/11/2026). Decisao do
 * dono: "o dono sempre pode; o resto so' com a permissao marcada". O
 * administrador (Master/Admin que nao e' o dono) passa pelas permissoes:
 * enquanto o dono nao salvar as dele (marcador `pacote.administrador-1`),
 * tem todas -- ninguem perde acesso no deploy; depois, so' as marcadas.
 * Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const { podePelasEfetivas } = require('../services/permissoesFinanceiro');
const pa = require('../services/permissoesAdministracao');
const pv = require('../services/permissoesVendas');
const nd = require('../domain/permissoesNovasDomain');
const { hasModuleAccess, hasTenantFullAccess } = require('../domain/roles');
const filialDominio = require('../domain/filialDomain');
const { podeTransferirSemNota } = require('../domain/transferenciaDomain');

/** O que o auth.js monta para o administrador (nao dono): efetivas com o papel e o nivel que vale. */
const administrador = (permissoes = [], extra = {}) => {
  const nivelAcesso = nd.nivelAcessoEfetivo(extra.nivelAcesso || 'funcionario', 'Admin', permissoes);
  return {
    uid: 'adm', tenantId: 'loja', role: 'Admin', dono: false, isAdministrador: true,
    permissoes: nd.permissoesEfetivasDoUsuario(permissoes, nivelAcesso, { papel: 'Admin' }),
    nivelAcesso,
    ...extra,
  };
};
const ADM_SEM_PACOTE = administrador([]);
const ADM_SALVO = administrador(nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Admin'), { nivelAcesso: 'supervisor' });
const DONO = { uid: 'loja', tenantId: 'loja', role: 'Master', dono: true, permissoes: [] };
const PLATAFORMA = { uid: 'sup', tenantId: 'loja', role: 'SuperAdmin', isPlatformAdmin: true, permissoes: [] };

/** Chama um middleware express com req/res falsos. */
const passar = (middleware, user, body = {}) => new Promise((resolve) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json(corpo) { resolve({ status, corpo }); return this; } };
  Promise.resolve(middleware({ user, body }, res, () => resolve({ status: 'passou' }))).catch((e) => resolve({ status: 500, corpo: e }));
});

test('administrador sem o pacote salvo passa em tudo (todas as permissoes do catalogo, menos as que restringem)', () => {
  for (const id of nd.PERMISSOES_DO_ADMINISTRADOR) {
    assert.equal(podePelasEfetivas(ADM_SEM_PACOTE, id), true, id);
  }
  assert.ok(nd.PERMISSOES_DO_ADMINISTRADOR.includes('dashboard.valores'));
  assert.ok(nd.PERMISSOES_DO_ADMINISTRADOR.includes('cadastros.vendedores_liberadores'));
  assert.ok(nd.PERMISSOES_DO_ADMINISTRADOR.includes('administrativo.comissao_usuario'));
  assert.ok(nd.PERMISSOES_DO_ADMINISTRADOR.includes('fiscal.tabelas_ativar'));
  assert.equal(ADM_SEM_PACOTE.permissoes.includes('vendas.so_caixa'), false, '"So a Frente de Caixa" restringe: nao entra');
  assert.equal(ADM_SEM_PACOTE.nivelAcesso, 'gerente', 've as vendas de todos, como via pelo papel');
  // Cadastro cru (lido do banco, sem as efetivas): o papel basta para as efetivas.
  assert.equal(podePelasEfetivas({ uid: 'adm', role: 'Admin', permissoes: [] }, 'financeiro.receber_baixar'), true);
});

test('administrador salvo pelo dono: so o marcado; sem a permissao, barrado com a mensagem em portugues', async () => {
  assert.equal(podePelasEfetivas(ADM_SALVO, 'vendas.pedidos'), true);
  assert.equal(podePelasEfetivas(ADM_SALVO, 'administrativo.backup_baixar'), false);
  assert.equal(ADM_SALVO.nivelAcesso, 'supervisor', 'nivel escolhido pelo dono');
  const negado = await passar(pa.exigirPermissao(['administrativo.backup_baixar']), ADM_SALVO);
  assert.equal(negado.status, 403);
  assert.match(negado.corpo.error, /^Você não tem permissão para baixar o backup da empresa\. Peça a um responsável liberar "Admin: Backup — baixar a cópia da empresa inteira"/);
  assert.equal((await passar(pa.exigirPermissao(['administrativo.backup_baixar']), ADM_SEM_PACOTE)).status, 'passou');
  // Aplicar as efetivas de novo nao muda nada (o auth ja' entrega as efetivas).
  assert.deepEqual(
    [...nd.permissoesEfetivasDoUsuario(ADM_SALVO.permissoes, ADM_SALVO.nivelAcesso, { papel: 'Admin' })].sort(),
    [...ADM_SALVO.permissoes].sort(),
  );
});

test('dono e plataforma sempre passam, sem olhar permissao', async () => {
  for (const user of [DONO, PLATAFORMA]) {
    assert.equal(podePelasEfetivas(user, 'administrativo.backup_baixar'), true);
    assert.equal((await passar(pa.exigirPermissao(['administrativo.backup_gerar']), user)).status, 'passou');
  }
  assert.equal(hasTenantFullAccess('Master', true), true);
  assert.equal(hasTenantFullAccess('SuperAdmin', false), true);
  assert.equal(hasTenantFullAccess('Admin', false), false, 'o papel de administrador sozinho nao libera mais');
  assert.equal(hasTenantFullAccess('Master', false), false);
});

test('cadastro de outra pessoa lido do banco: administrador pelas efetivas do papel', () => {
  // Quem gravou a pre-venda: administrador sem o pacote podia dar desconto; salvo sem ela, nao.
  assert.equal(pv.cadastroPode('adm', { tenantId: 'loja', role: 'Admin', permissoes: [] }, 'vendas.desconto'), true);
  assert.equal(pv.cadastroPode('adm', { tenantId: 'loja', role: 'Admin', permissoes: ['pacote.administrador-1'] }, 'vendas.desconto'), false);
  assert.equal(pv.cadastroPode('loja', { tenantId: 'loja', role: 'Master', permissoes: ['pacote.administrador-1'] }, 'vendas.desconto'), true, 'o dono sempre');
  // Aprovar desconto (lista de quem libera): o administrador sem o pacote aparece.
  const pode = (registro) => hasModuleAccess({ role: registro.role, isOwner: false, permissions: registro.permissoes, requiredPermission: 'vendas.liberar_desconto' });
  assert.equal(pode({ role: 'Admin', permissoes: [] }), true);
  assert.equal(pode({ role: 'Admin', permissoes: ['pacote.administrador-1'] }), false);
  assert.equal(pode({ role: 'Admin', permissoes: ['pacote.administrador-1', 'vendas.liberar_desconto'] }), true);
  assert.equal(pode({ role: 'Funcionario', permissoes: [] }), false);
  assert.equal(hasModuleAccess({ role: 'Admin', isOwner: false, permissions: [], requiredPermission: 'vendas.so_caixa' }), false, 'restricao nunca vem sozinha');
  // temNoCadastro (servicos que leem o usuario): o papel entra.
  assert.equal(pa.temNoCadastro({ role: 'Admin', permissoes: [] }, 'filiais.cadastrar'), true);
  assert.equal(pa.temNoCadastro({ role: 'Admin', permissoes: ['pacote.administrador-1'] }, 'filiais.cadastrar'), false);
  // Transferencia sem nota: o papel nao libera sozinho.
  assert.equal(podeTransferirSemNota({ role: 'Admin', permissoes: [] }), true);
  assert.equal(podeTransferirSemNota({ role: 'Admin', permissoes: ['pacote.administrador-1'] }), false);
});

test('filiais: so o dono do grupo e gestor; o administrador vai pelas permissoes de Filiais', () => {
  const grupo = { id: 'g1', donoUid: 'loja', matrizTenantId: 'loja', filiais: [{ tenantId: 'loja', ativa: true }, { tenantId: 'f20', ativa: true }] };
  assert.equal(filialDominio.ehGestorDoGrupo(grupo, { uid: 'loja', role: 'Master', tenantId: 'loja' }), true);
  assert.equal(filialDominio.ehGestorDoGrupo(grupo, { uid: 'adm', role: 'Admin', tenantId: 'loja' }), false);
  assert.equal(filialDominio.ehGestorDoGrupo({ ...grupo, donoUid: '' }, { uid: 'loja', role: 'Master', tenantId: 'loja' }), true, 'grupo antigo: o dono da matriz');
  // Trocar de filial: o administrador sem o pacote ainda entra em todas.
  assert.equal(filialDominio.podeUsarOutrasFiliais(grupo, { uid: 'adm', role: 'Admin', tenantId: 'loja', permissoes: [] }), true);
  assert.equal(filialDominio.podeUsarOutrasFiliais(grupo, { uid: 'adm', role: 'Admin', tenantId: 'loja', permissoes: ['pacote.administrador-1'] }), false);
  assert.equal(filialDominio.podeUsarOutrasFiliais(grupo, { uid: 'adm', role: 'Admin', tenantId: 'loja', permissoes: ['pacote.administrador-1', 'filiais.utilizar'] }), true);
});

test('CFOP (tabelas fiscais, vale para todas as filiais): o dono; o administrador pela permissao', async () => {
  const filial = (tenantId, codigo, matriz) => ({ tenantId, codigo, nome: `LOJA ${codigo}`, cnpj: '', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', matriz, ativa: true });
  const banco = () => criarBancoFalso({
    'grupos/g1': { nome: 'GRUPO', donoUid: 'loja', matrizTenantId: 'loja', filiais: [filial('loja', '10', true), filial('f20', '20', false)], modulosBloqueados: [] },
    'usuarios/loja': { tenantId: 'loja', role: 'Master' },
    'usuarios/adm': { tenantId: 'loja', role: 'Admin', permissoes: [] },
    'usuarios/adm2': { tenantId: 'loja', role: 'Admin', permissoes: ['pacote.administrador-1', 'fiscal.tabelas'] },
    'configuracoes/loja': { tenantId: 'loja', grupoId: 'g1' },
    'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1' },
  });
  const carregar = (db) => {
    const servicos = carregarComBancoFalso(db, 'services/tabelasFiscais');
    const servico = servicos[servicos.length - 1];
    servico.limparCache();
    return servico;
  };
  const fake = banco();
  const s = carregar(fake.db);
  const r = await s.definirCfopAtivo({ user: ADM_SEM_PACOTE, codigo: '5102', ativo: false });
  assert.equal(r.filiais, 2);
  const salvoSemCfop = administrador(['pacote.administrador-1', 'fiscal.tabelas'], { uid: 'adm2' });
  await assert.rejects(
    s.definirCfopAtivo({ user: salvoSemCfop, codigo: '5102', ativo: true }),
    (e) => e.status === 403 && /ativar ou desativar CFOP nas Tabelas Fiscais/.test(e.message),
  );
  await s.definirCfopAtivo({ user: DONO, codigo: '5102', ativo: true });
  assert.deepEqual(fake.ler('configuracoes/f20').cfopsDesativados, []);
});

test('salvar: so o administrador leva o marcador dele; o dono nunca', () => {
  assert.ok(nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Admin').includes('pacote.administrador-1'));
  assert.ok(!nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Funcionario').includes('pacote.administrador-1'));
  assert.ok(!nd.permissoesParaGravarDoUsuario(['vendas.pedidos']).includes('pacote.administrador-1'));
  // Historico: o dono salvou o administrador e tirou tudo menos Pedidos -> o resto "saiu".
  const { entraram, sairam } = nd.mudancasDePermissoes([], nd.permissoesParaGravarDoUsuario(['vendas.pedidos'], 'Admin'), undefined, { papel: 'Admin' });
  assert.deepEqual(entraram, []);
  assert.ok(sairam.includes('financeiro.pagar'));
  assert.ok(!sairam.includes('vendas.pedidos'));
});
