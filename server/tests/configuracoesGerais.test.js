const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Configuracoes Gerais (15/10/2026): os campos que valem para o grupo inteiro
 * sao gravados pelo servidor em todas as filiais. Firestore falso em memoria.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => {
  const servicos = carregarComBancoFalso(db, 'services/configuracoesGerais', 'services/filiais');
  return { gerais: servicos[3], filiais: servicos[4] };
};

const GERAIS = {
  planoContasReceitas: ['Serviços', 'Fretes'],
  planoContasDespesas: ['Aluguel'],
  validarCadastroProduto: true,
  modoValidacaoCliente: 'bloquear',
  trabalhaComLimiteCredito: true,
  transferenciaSemNota: false,
  transferenciaNfeTributacao: 'nao_incide',
};

const filial = (tenantId, codigo, matriz) => ({
  tenantId, codigo, nome: `LOJA ${codigo}`, cnpj: '', uf: 'ES', cidade: 'SERRA', tipo: 'cnpj_proprio', matriz, ativa: true,
});

const comGrupo = (extra = {}) => ({
  'grupos/g1': {
    nome: 'SHOPPING RURAL', donoUid: 'dono', matrizTenantId: 'dono',
    filiais: [filial('dono', '10', true), filial('f20', '20', false)], modulosBloqueados: [],
  },
  'usuarios/dono': { tenantId: 'dono', role: 'Master' },
  'usuarios/gerente': { tenantId: 'f20', role: 'Funcionario', permissoes: ['administrativo.config'] },
  'configuracoes/dono': { tenantId: 'dono', grupoId: 'g1', planoContasReceitas: ['Serviços'], trabalhaComLimiteCredito: true, modoValidacaoCliente: 'bloquear', trabalhaComPreVenda: true },
  'configuracoes/f20': { tenantId: 'f20', grupoId: 'g1', planoContasReceitas: ['Serviços', 'Fretes'], trabalhaComLimiteCredito: false, trabalhaComPreVenda: false },
  ...extra,
});

const DONO = { uid: 'dono', tenantId: 'dono', role: 'Master', isTenantManager: true, permissoes: [] };

test('salvar com filiais: o mesmo valor vai para todas, sem mexer no que e\' de cada uma', async () => {
  const fake = criarBancoFalso(comGrupo());
  const { gerais } = carregar(fake.db);
  const r = await gerais.salvarConfiguracoesGerais({ user: DONO, corpo: GERAIS });
  assert.equal(r.filiais, 2);
  assert.equal(r.grupo, 'SHOPPING RURAL');
  for (const t of ['dono', 'f20']) {
    const c = fake.ler(`configuracoes/${t}`);
    assert.deepEqual(c.planoContasReceitas, ['Serviços', 'Fretes'], t);
    assert.equal(c.trabalhaComLimiteCredito, true, t);
    assert.equal(c.modoValidacaoCliente, 'bloquear', t);
    assert.equal(c.tenantId, t);
  }
  assert.equal(fake.ler('configuracoes/dono').trabalhaComPreVenda, true, 'pre-venda e\' da filial e nao muda');
  assert.equal(fake.ler('configuracoes/f20').trabalhaComPreVenda, false, 'pre-venda e\' da filial e nao muda');
});

test('salvar com filiais: quem nao e\' dono/administrador do grupo e\' recusado, mesmo com a permissao de Configuracoes', async () => {
  const fake = criarBancoFalso(comGrupo());
  const { gerais } = carregar(fake.db);
  const gerente = { uid: 'gerente', tenantId: 'f20', role: 'Funcionario', isTenantManager: false, permissoes: ['administrativo.config'] };
  await assert.rejects(
    gerais.salvarConfiguracoesGerais({ user: gerente, corpo: GERAIS }),
    (erro) => erro.status === 403 && /valem para todas as filiais/.test(erro.message),
  );
  assert.deepEqual(fake.ler('configuracoes/f20').planoContasReceitas, ['Serviços', 'Fretes']);
});

test('salvar sem filiais: grava so\' a empresa; vale a permissao de Configuracoes', async () => {
  const fake = criarBancoFalso({
    'usuarios/u2': { tenantId: 'emp', role: 'Funcionario', permissoes: ['administrativo.config'] },
    'configuracoes/emp': { tenantId: 'emp', nomeOficina: 'LOJA' },
  });
  const { gerais } = carregar(fake.db);
  const comPermissao = { uid: 'u2', tenantId: 'emp', role: 'Funcionario', isTenantManager: false, permissoes: ['administrativo.config'] };
  const r = await gerais.salvarConfiguracoesGerais({ user: comPermissao, corpo: GERAIS });
  assert.equal(r.filiais, 1);
  assert.equal(fake.ler('configuracoes/emp').validarCadastroProduto, true);
  assert.equal(fake.ler('configuracoes/emp').nomeOficina, 'LOJA');

  const semPermissao = { ...comPermissao, permissoes: [] };
  await assert.rejects(gerais.salvarConfiguracoesGerais({ user: semPermissao, corpo: GERAIS }), (erro) => erro.status === 403);
});

test('salvar recusa dado invalido antes de gravar', async () => {
  const fake = criarBancoFalso(comGrupo());
  const { gerais } = carregar(fake.db);
  await assert.rejects(
    gerais.salvarConfiguracoesGerais({ user: DONO, corpo: { ...GERAIS, modoValidacaoCliente: 'talvez' } }),
    (erro) => erro.status === 400 && /cliente não cadastrado/.test(erro.message),
  );
});

test('unificar: simular nao grava; aplicar iguala pela matriz e junta o plano; desfazer volta', async () => {
  const fake = criarBancoFalso(comGrupo());
  const { gerais } = carregar(fake.db);

  const simulado = await gerais.unificarConfiguracoesGerais({ aplicar: false, desfazer: false });
  assert.equal(simulado.gruposLidos, 1);
  assert.equal(simulado.filiaisAlteradas, 2);
  assert.deepEqual(simulado.grupos[0].filiais.map((f) => f.filial), ['10 - LOJA 10', '20 - LOJA 20']);
  assert.equal(fake.ler('configuracoes/f20').trabalhaComLimiteCredito, false, 'simular nao grava');

  await gerais.unificarConfiguracoesGerais({ aplicar: true, desfazer: false });
  const f20 = fake.ler('configuracoes/f20');
  assert.equal(f20.trabalhaComLimiteCredito, true);
  assert.equal(f20.modoValidacaoCliente, 'bloquear');
  assert.deepEqual(f20.planoContasReceitas, ['Serviços', 'Fretes']);
  assert.deepEqual(fake.ler('configuracoes/dono').planoContasReceitas, ['Serviços', 'Fretes'], 'a matriz ganha a categoria que so\' a filial tinha');
  assert.equal(f20.unificacaoGeraisAnterior.campos.trabalhaComLimiteCredito, false);
  assert.deepEqual(f20.unificacaoGeraisAnterior.ausentes, ['modoValidacaoCliente']);

  const deNovo = await gerais.unificarConfiguracoesGerais({ aplicar: false, desfazer: false });
  assert.equal(deNovo.filiaisAlteradas, 0, 'depois de aplicar, nada fica diferente');

  await gerais.unificarConfiguracoesGerais({ aplicar: true, desfazer: true });
  const voltou = fake.ler('configuracoes/f20');
  assert.equal(voltou.trabalhaComLimiteCredito, false);
  assert.equal('modoValidacaoCliente' in voltou, false);
  assert.equal('unificacaoGeraisAnterior' in voltou, false);
  assert.deepEqual(fake.ler('configuracoes/dono').planoContasReceitas, ['Serviços']);
});

test('Filiais sem grupo: a propria empresa aparece como Matriz (10)', async () => {
  const fake = criarBancoFalso({
    'usuarios/dono': { tenantId: 'dono', role: 'Master' },
    'configuracoes/dono': { tenantId: 'dono', nomeOficina: 'Loja Centro', cnpj: '11.222.333/0001-81', uf: 'es', cidade: 'Vitória' },
  });
  const { filiais } = carregar(fake.db);
  const r = await filiais.listarFiliais({ user: { uid: 'dono', tenantId: 'dono' } });
  assert.equal(r.grupo, null);
  assert.deepEqual(
    { codigo: r.matrizSemFiliais.codigo, nome: r.matrizSemFiliais.nome, matriz: r.matrizSemFiliais.matriz, uf: r.matrizSemFiliais.uf },
    { codigo: '10', nome: 'LOJA CENTRO', matriz: true, uf: 'ES' },
  );

  const comGrupoFake = criarBancoFalso(comGrupo());
  const comGrupoServico = carregar(comGrupoFake.db).filiais;
  const r2 = await comGrupoServico.listarFiliais({ user: { uid: 'dono', tenantId: 'dono' } });
  assert.equal(r2.matrizSemFiliais, null);
});
