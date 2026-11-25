const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Item 15 da Embala Minas, fase Administracao (25/11/2026): cada acao da
 * administracao que passa pelo servidor pede a SUA permissao -- backup (gerar
 * e baixar), computadores do caixa, numeracao, liberar trava, Equipe e
 * Acessos (criar, ficha, senha, inativar, permissoes, nivel, app), filiais e
 * Configuracoes Gerais por bloco. O nivel gerente traz, marcado, o que ele ja'
 * fazia; o que so' o administrador fazia nao vem com nada. Dono/administrador
 * segue liberado. Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const pa = require('../services/permissoesAdministracao');

const MARCADORES = ['pacote.financeiro-1', 'pacote.financeiro-2', 'pacote.vendas-1', 'pacote.estoque-1', 'pacote.administracao-1'];
const salvo = (uid, permissoes, extra = {}) => ({ uid, tenantId: 'loja', role: 'Funcionario', permissoes: [...permissoes, ...MARCADORES], ...extra });

/** Chama um middleware express com req/res falsos. */
const passar = (middleware, user, body = {}) => new Promise((resolve) => {
  let status = 200;
  const res = { status(s) { status = s; return this; }, json(corpo) { resolve({ status, corpo }); return this; } };
  Promise.resolve(middleware({ user, body }, res, () => resolve({ status: 'passou' }))).catch((e) => resolve({ status: 500, corpo: e }));
});

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('nivel gerente: libera trava pela permissao marcada; salvo sem ela, nao libera mais', () => {
  assert.equal(pa.podeNaAdministracao({ uid: 'g', permissoes: [], nivelAcesso: 'gerente' }, 'administrativo.liberar_trava'), true);
  assert.equal(pa.podeNaAdministracao({ uid: 'f', permissoes: [], nivelAcesso: 'funcionario' }, 'administrativo.liberar_trava'), false);
  assert.equal(pa.podeNaAdministracao(salvo('g', [], { nivelAcesso: 'gerente' }), 'administrativo.liberar_trava'), false);
  assert.equal(pa.podeNaAdministracao({ uid: 'a', permissoes: [], isTenantManager: true }, 'administrativo.backup_baixar'), true, 'administrador segue liberado');
});

test('backup, computadores e numeracao nao vem com nada (so o administrador fazia)', () => {
  const gerenteComTudo = { uid: 'g', permissoes: ['administrativo.equipe', 'administrativo.config', 'vendas.pdv'], nivelAcesso: 'gerente' };
  for (const p of ['administrativo.backup_gerar', 'administrativo.backup_baixar', 'vendas.caixa_computadores', 'administrativo.numeracao', 'fiscal.numeracao', 'administrativo.dados_empresa']) {
    assert.equal(pa.podeNaAdministracao(gerenteComTudo, p), false, p);
    assert.equal(pa.podeNaAdministracao(salvo('f', [p]), p), true, `${p} marcada vale`);
  }
});

test('mensagem em portugues cita o rotulo do cadastro do funcionario', () => {
  assert.match(pa.mensagemSemPermissao(['administrativo.backup_baixar']), /^Você não tem permissão para baixar o backup da empresa\. Peça a um responsável liberar "Admin: Backup — baixar a cópia da empresa inteira"/);
  assert.match(pa.mensagemSemPermissao(['administrativo.liberar_trava']), /peça para quem está com o documento aberto fechá-lo/);
  assert.equal(pa.nivelCabe('gerente', 'supervisor'), false);
  assert.equal(pa.nivelCabe('supervisor', 'gerente'), true);
});

test('exigirPermissao: o 403 sai antes de tocar em qualquer coisa; "qualquer" basta uma', async () => {
  const gerar = pa.exigirPermissao(['administrativo.backup_gerar']);
  assert.equal((await passar(gerar, salvo('f', ['administrativo.backup_gerar']))).status, 'passou');
  const negado = await passar(gerar, salvo('f', ['administrativo.backup_baixar']));
  assert.equal(negado.status, 403);
  assert.match(negado.corpo.error, /"Admin: Backup — gerar e ver o agendamento"/);
  const ver = pa.exigirPermissao(['administrativo.backup_gerar', 'administrativo.backup_baixar'], { qualquer: true });
  assert.equal((await passar(ver, salvo('f', ['administrativo.backup_baixar']))).status, 'passou');
  assert.equal((await passar(ver, salvo('f', []))).status, 403);
  assert.equal((await passar(gerar, { uid: 'a', isTenantManager: true })).status, 'passou');
  assert.equal((await passar(gerar, undefined)).status, 401);
});

test('computadores do caixa: dono/administrador ou a permissao propria', () => {
  const terminais = carregarComBancoFalso(criarBancoFalso({}).db, 'services/terminaisCaixa')[3];
  assert.equal(terminais.podeNosComputadores({ uid: 'd', dono: true }), true);
  assert.equal(terminais.podeNosComputadores(salvo('f', ['vendas.pdv'])), false);
  assert.equal(terminais.podeNosComputadores(salvo('f', ['vendas.caixa_computadores'])), true);
});

// ---------------------------------------------------------------------------
// Equipe e Acessos
// ---------------------------------------------------------------------------

const bancoDaEquipe = () => criarBancoFalso({
  'usuarios/f1': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'funcionario', permissoes: ['vendas.pedidos', ...MARCADORES] },
  'usuarios/g2': { tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente' },
  'configuracoes/loja': { tenantId: 'loja' },
});

test('equipe: cada acao pela sua permissao; o gerente com a Equipe ja vem com criar/ficha/senha/inativar', async () => {
  const m = carregarComBancoFalso(bancoDaEquipe().db, 'middleware/gestaoEquipe')[3];
  const gerenteAntigo = { uid: 'g1', tenantId: 'loja', role: 'Funcionario', nivelAcesso: 'gerente', permissoes: ['administrativo.equipe'] };
  for (const p of ['administrativo.equipe_editar', 'administrativo.equipe_senha', 'administrativo.equipe_inativar', 'administrativo.equipe_permissoes']) {
    assert.equal((await passar(m.podeGerirFuncionario(p), gerenteAntigo, { usuarioId: 'f1' })).status, 'passou', p);
  }
  // Nivel e aplicativo: so o administrador fazia -- nao vem.
  const nivel = await passar(m.podeGerirFuncionario('administrativo.equipe_app'), gerenteAntigo, { usuarioId: 'f1' });
  assert.equal(nivel.status, 403);
  assert.match(nivel.corpo.error, /"Admin: Equipe — liberar o aplicativo mobile/);
  // Funcionario comum com a permissao marcada (sem ser gerente) inativa funcionario comum...
  const comInativar = salvo('s1', ['administrativo.equipe_inativar'], { nivelAcesso: 'supervisor' });
  assert.equal((await passar(m.podeGerirFuncionario('administrativo.equipe_inativar'), comInativar, { usuarioId: 'f1' })).status, 'passou');
  // ...mas nunca um gerente.
  const alvoGerente = await passar(m.podeGerirFuncionario('administrativo.equipe_inativar'), comInativar, { usuarioId: 'g2' });
  assert.equal(alvoGerente.status, 403);
  assert.match(alvoGerente.corpo.error, /só altera funcionário comum/);
  // Gerente salvo sem "inativar": nao inativa mais.
  const salvoSem = salvo('g1', ['administrativo.equipe', 'administrativo.equipe_editar'], { nivelAcesso: 'gerente' });
  assert.equal((await passar(m.podeGerirFuncionario('administrativo.equipe_inativar'), salvoSem, { usuarioId: 'f1' })).status, 403);
});

test('permissoes pelo servidor: nivel so com a permissao propria e ate o nivel de quem altera', async () => {
  const fake = bancoDaEquipe();
  const s = carregarComBancoFalso(fake.db, 'services/limitesDoPlano')[3];
  const comNivel = salvo('s1', ['vendas.pedidos', 'administrativo.equipe_permissoes', 'administrativo.equipe_nivel'], { nivelAcesso: 'supervisor' });
  await s.salvarPermissoes({ user: comNivel, tenantId: 'loja', corpo: { usuarioId: 'f1', permissoes: ['vendas.pedidos'], nivelAcesso: 'supervisor' }, gerente: true });
  assert.equal(fake.ler('usuarios/f1').nivelAcesso, 'supervisor');
  await assert.rejects(
    () => s.salvarPermissoes({ user: comNivel, tenantId: 'loja', corpo: { usuarioId: 'f1', permissoes: ['vendas.pedidos'], nivelAcesso: 'gerente' }, gerente: true }),
    (e) => e.status === 403 && /até o seu/.test(e.message),
  );
  // Sem a permissao do nivel: o nivel pedido e' ignorado (fica o gravado).
  const semNivel = salvo('s2', ['vendas.pedidos', 'administrativo.equipe_permissoes'], { nivelAcesso: 'gerente' });
  await s.salvarPermissoes({ user: semNivel, tenantId: 'loja', corpo: { usuarioId: 'f1', permissoes: ['vendas.pedidos'], nivelAcesso: 'funcionario' }, gerente: true });
  assert.equal(fake.ler('usuarios/f1').nivelAcesso, 'supervisor');
  // Fora do alcance: cita o rotulo, nao o id.
  await assert.rejects(
    () => s.salvarPermissoes({ user: semNivel, tenantId: 'loja', corpo: { usuarioId: 'f1', permissoes: ['vendas.pedidos', 'financeiro.pagar'] }, gerente: true }),
    (e) => e.status === 403 && /"Financeiro: Contas a Pagar"/.test(e.message) && !/financeiro\.pagar/.test(e.message),
  );
});

// ---------------------------------------------------------------------------
// Configuracoes Gerais e filiais
// ---------------------------------------------------------------------------

const GERAIS = {
  planoContasReceitas: ['Serviços'],
  planoContasDespesas: ['Aluguel'],
  validarCadastroProduto: false,
  modoValidacaoCliente: 'permitir',
  trabalhaComLimiteCredito: false,
  transferenciaSemNota: false,
  transferenciaNfeTributacao: 'nao_incide',
  usaGradeDeProdutos: false,
  cashback: { ativo: false },
};

test('configuracoes gerais: cada bloco pela sua permissao; o que nao pode fica como estava', async () => {
  const banco = () => criarBancoFalso({
    'usuarios/u1': { tenantId: 'emp', role: 'Funcionario' },
    'configuracoes/emp': { tenantId: 'emp', ...GERAIS },
  });
  const so = (permissoes) => ({ uid: 'u1', tenantId: 'emp', role: 'Funcionario', isTenantManager: false, permissoes: [...permissoes, ...MARCADORES] });
  // So' o plano de contas: muda o plano; o resto fica (e mudar o resto e' recusado).
  let fake = banco();
  let gerais = carregarComBancoFalso(fake.db, 'services/configuracoesGerais')[3];
  await gerais.salvarConfiguracoesGerais({ user: so(['financeiro.plano_contas']), corpo: { ...GERAIS, planoContasReceitas: ['Serviços', 'Fretes'] } });
  assert.deepEqual(fake.ler('configuracoes/emp').planoContasReceitas, ['Serviços', 'Fretes']);
  await assert.rejects(
    gerais.salvarConfiguracoesGerais({ user: so(['financeiro.plano_contas']), corpo: { ...GERAIS, trabalhaComLimiteCredito: true } }),
    (e) => e.status === 403 && /"Admin: Configurações gerais/.test(e.message),
  );
  assert.equal(fake.ler('configuracoes/emp').trabalhaComLimiteCredito, false);
  // Nenhuma das tres: recusa.
  fake = banco();
  gerais = carregarComBancoFalso(fake.db, 'services/configuracoesGerais')[3];
  await assert.rejects(gerais.salvarConfiguracoesGerais({ user: so(['administrativo.config']), corpo: GERAIS }), (e) => e.status === 403);
  // "Admin: Configuracoes" antes de salvar de novo (sem o marcador): empresa sem filiais ja' tinha.
  const antigo = { uid: 'u1', tenantId: 'emp', role: 'Funcionario', isTenantManager: false, permissoes: ['administrativo.config'] };
  await gerais.salvarConfiguracoesGerais({ user: antigo, corpo: { ...GERAIS, trabalhaComLimiteCredito: true } });
  assert.equal(fake.ler('configuracoes/emp').trabalhaComLimiteCredito, true);
});

test('filiais: funcionario com "Filiais: Cadastrar filial" cadastra; sem ela, a mensagem diz o que pedir', async () => {
  const fake = criarBancoFalso({
    'usuarios/dono': { tenantId: 'dono', role: 'Master', limiteFiliais: 3 },
    'usuarios/f1': { tenantId: 'dono', role: 'Funcionario', permissoes: ['filiais.cadastrar', ...MARCADORES] },
    'usuarios/f2': { tenantId: 'dono', role: 'Funcionario', permissoes: ['filiais.utilizar', ...MARCADORES] },
    'configuracoes/dono': { tenantId: 'dono', cnpj: '11222333000181', razaoSocial: 'LOJA LTDA', nomeOficina: 'Loja', uf: 'ES', cidade: 'Vitória' },
  });
  const s = carregarComBancoFalso(fake.db, 'services/filiais')[3];
  const nova = {
    codigo: '20', nome: 'Loja Baixada', tipo: 'cnpj_proprio', cnpj: '11.222.333/0002-62', razaoSocial: 'Loja Baixada Ltda',
    uf: 'ES', cidade: 'Serra', rua: 'Rua B', numero: '10', bairro: 'Centro',
  };
  await assert.rejects(() => s.criarFilial({ user: { uid: 'f2' }, corpo: nova }), /"Filiais: Cadastrar filial"/);
  const r = await s.criarFilial({ user: { uid: 'f1' }, corpo: nova });
  assert.ok(r.tenantId);
  // Alterar pede a sua; o resumo tambem.
  await assert.rejects(() => s.editarFilial({ user: { uid: 'f1' }, tenantId: r.tenantId, corpo: { ativa: false } }), /"Filiais: Alterar e inativar filial"/);
  await assert.rejects(() => s.resumoDoGrupo({ user: { uid: 'f1' }, inicio: '2026-11-01', fim: '2026-11-30' }), /"Filiais: Resumo do grupo/);
});
