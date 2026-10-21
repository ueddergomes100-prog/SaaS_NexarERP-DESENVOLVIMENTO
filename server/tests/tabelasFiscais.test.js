const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Tabelas fiscais (20/10/2026): CFOP ativo/desativado em todas as filiais do
 * grupo; base unica de NCM/CEST que cresce com o uso (so' o codigo) e com o
 * cadastro a mao (descricao; ja' descrito, so' o suporte troca).
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => {
  const servicos = carregarComBancoFalso(db, 'services/tabelasFiscais');
  const servico = servicos[servicos.length - 1];
  servico.limparCache();
  return servico;
};

const filial = (tenantId, codigo, matriz) => ({
  tenantId, codigo, nome: `LOJA ${codigo}`, cnpj: '', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', matriz, ativa: true,
});

const BASE = {
  'grupos/g1': {
    nome: 'SHOPPING RURAL', donoUid: 'dono', matrizTenantId: 'dono',
    filiais: [filial('dono', '10', true), filial('f20', '20', false)], modulosBloqueados: [],
  },
  'usuarios/dono': { tenantId: 'dono', role: 'Master' },
  'usuarios/vendedor': { tenantId: 'f20', role: 'Funcionario', permissoes: ['fiscal.tabelas'] },
  'configuracoes/dono': { tenantId: 'dono', grupoId: 'g1' },
  'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1', cfopsDesativados: ['5101'] },
};

const DONO = { uid: 'dono', tenantId: 'dono', role: 'Master', isTenantManager: true, permissoes: [] };
const VENDEDOR = { uid: 'vendedor', tenantId: 'f20', role: 'Funcionario', isTenantManager: false, permissoes: ['fiscal.tabelas'] };
const SEM_PERMISSAO = { uid: 'x', tenantId: 'f20', role: 'Funcionario', isTenantManager: false, permissoes: [] };
const SUPORTE = { uid: 'sup', tenantId: 'plataforma', role: 'SuperAdmin', isPlatformAdmin: true, permissoes: [] };

test('CFOP: o dono desativa e reativa em todas as filiais do grupo, sem repetir', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  const r = await s.definirCfopAtivo({ user: DONO, codigo: '5.102', ativo: false });
  assert.equal(r.filiais, 2);
  assert.deepEqual(fake.ler('configuracoes/dono').cfopsDesativados, ['5102']);
  assert.deepEqual(fake.ler('configuracoes/f20').cfopsDesativados, ['5101', '5102']);
  await s.definirCfopAtivo({ user: DONO, codigo: '5102', ativo: false });
  assert.deepEqual(fake.ler('configuracoes/f20').cfopsDesativados, ['5101', '5102'], 'sem repetir');
  await s.definirCfopAtivo({ user: DONO, codigo: '5101', ativo: true });
  assert.deepEqual(fake.ler('configuracoes/f20').cfopsDesativados, ['5102']);
});

test('CFOP: funcionario (mesmo com a permissao da tela) nao altera; CFOP fora da tabela e recusado', async () => {
  const fake = criarBancoFalso(BASE);
  const s = carregar(fake.db);
  await assert.rejects(s.definirCfopAtivo({ user: VENDEDOR, codigo: '5102', ativo: false }), (e) => e.status === 403 && /dono ou um administrador/.test(e.message));
  await assert.rejects(s.definirCfopAtivo({ user: DONO, codigo: '5999', ativo: false }), (e) => e.status === 400 && /não está na tabela/.test(e.message));
  await assert.rejects(s.definirCfopAtivo({ user: DONO, codigo: '5102', ativo: 'sim' }), (e) => e.status === 400);
  assert.deepEqual(fake.ler('configuracoes/f20').cfopsDesativados, ['5101']);
});

test('uso: cria so o codigo que falta (sem nome de produto) e liga o CEST aos NCMs', async () => {
  const fake = criarBancoFalso({ 'tabela_ncm/21069090': { codigo: '21069090', descricao: 'Preparações alimentícias' } });
  const s = carregar(fake.db);
  const r = await s.registrarUso({ itens: [
    { ncm: '2106.90.90', cest: '17.001.00', nome: 'FARINHA DA EMPRESA X' },
    { ncm: '11041200' },
    { ncm: '123', cest: '1' },
  ] });
  assert.deepEqual(r, { novosNcm: 1, novosCest: 1 });
  assert.equal(fake.ler('tabela_ncm/21069090').descricao, 'Preparações alimentícias', 'o que ja existe nao muda');
  const novo = fake.ler('tabela_ncm/11041200');
  assert.equal(novo.codigo, '11041200');
  assert.equal(novo.descricao, '');
  assert.ok(!JSON.stringify(novo).includes('FARINHA'), 'nome de produto nunca vai para a base');
  assert.deepEqual(fake.ler('tabela_cest/1700100').ncms, ['21069090']);
  await s.registrarUso({ itens: [{ ncm: '19059090', cest: '1700100' }] });
  assert.deepEqual(fake.ler('tabela_cest/1700100').ncms, ['21069090', '19059090']);
  assert.deepEqual(await s.registrarUso({ itens: 'lixo' }), { novosNcm: 0, novosCest: 0 });
});

test('cadastro a mao: descreve o novo ou o sem descricao; ja descrito so o suporte troca', async () => {
  const fake = criarBancoFalso({
    'tabela_ncm/11041200': { codigo: '11041200', descricao: '' },
    'tabela_ncm/21069090': { codigo: '21069090', descricao: 'Preparações alimentícias' },
  });
  const s = carregar(fake.db);
  const r1 = await s.cadastrarNcm({ user: VENDEDOR, corpo: { codigo: '1104.12.00', descricao: '  Grãos  esmagados de aveia ' } });
  assert.equal(r1.novo, false);
  assert.equal(fake.ler('tabela_ncm/11041200').descricao, 'Grãos esmagados de aveia');
  const r2 = await s.cadastrarNcm({ user: VENDEDOR, corpo: { codigo: '19059090', descricao: 'Outros produtos de padaria' } });
  assert.equal(r2.novo, true);
  assert.equal(fake.ler('tabela_ncm/19059090').origem, 'manual');
  await assert.rejects(
    s.cadastrarNcm({ user: VENDEDOR, corpo: { codigo: '21069090', descricao: 'Outra coisa' } }),
    (e) => e.status === 409 && /Só o suporte/.test(e.message),
  );
  await s.cadastrarNcm({ user: SUPORTE, corpo: { codigo: '21069090', descricao: 'Preparações alimentícias não especificadas' } });
  assert.equal(fake.ler('tabela_ncm/21069090').descricao, 'Preparações alimentícias não especificadas');
  await assert.rejects(s.cadastrarNcm({ user: SEM_PERMISSAO, corpo: { codigo: '19059090', descricao: 'x' } }), (e) => e.status === 403);
  await assert.rejects(s.cadastrarNcm({ user: VENDEDOR, corpo: { codigo: '123', descricao: 'x' } }), (e) => e.status === 400 && /8 números/.test(e.message));
  await assert.rejects(s.cadastrarNcm({ user: VENDEDOR, corpo: { codigo: '19059091', descricao: '' } }), (e) => e.status === 400 && /descrição/.test(e.message));
});

test('CEST a mao com NCM; busca por codigo, por descricao e CEST pelo NCM', async () => {
  const fake = criarBancoFalso({
    'tabela_ncm/21069090': { codigo: '21069090', descricao: 'Preparações alimentícias' },
    'tabela_ncm/11041200': { codigo: '11041200', descricao: 'Grãos de aveia' },
  });
  const s = carregar(fake.db);
  await s.cadastrarCest({ user: VENDEDOR, corpo: { codigo: '17.031.00', descricao: 'Massas alimentícias', ncm: '19021900' } });
  assert.deepEqual(fake.ler('tabela_cest/1703100').ncms, ['19021900']);
  await assert.rejects(s.cadastrarCest({ user: VENDEDOR, corpo: { codigo: '1703101', descricao: 'x', ncm: '123' } }), (e) => e.status === 400 && /8 números/.test(e.message));
  assert.deepEqual((await s.buscar({ tipo: 'ncm', busca: '2106' })).linhas.map((l) => l.codigo), ['21069090']);
  assert.deepEqual((await s.buscar({ tipo: 'ncm', busca: 'aveia' })).linhas.map((l) => l.codigo), ['11041200']);
  assert.equal((await s.buscar({ tipo: 'ncm', busca: '' })).total, 2);
  assert.deepEqual((await s.buscar({ tipo: 'cest', ncm: '1902.19.00' })).linhas.map((l) => l.codigo), ['1703100']);
  assert.deepEqual((await s.buscar({ tipo: 'cest', ncm: '21069090' })).linhas, []);
  // Gravou: a memoria limpa e a busca ja ve o novo.
  await s.registrarUso({ itens: [{ ncm: '19059090' }] });
  assert.equal((await s.buscar({ tipo: 'ncm', busca: '' })).total, 3);
});
