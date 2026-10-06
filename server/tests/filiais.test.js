const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const CNPJ_MATRIZ = '11222333000181';
const CNPJ_FILIAL = '11222333000262';
const carregar = (db) => carregarComBancoFalso(db, 'services/filiais')[3];

const configMatriz = {
  tenantId: 'dono', cnpj: CNPJ_MATRIZ, razaoSocial: 'SHOPPING RURAL LTDA', nomeOficina: 'Loja Centro', uf: 'ES', cidade: 'Vitória',
  inscricaoEstadual: '123', spedyApiKey: 'segredo', spedyEnabled: true, trabalhaComPreVenda: true, ordemFormasPagamento: ['pix'],
};

const semGrupo = (extra = {}) => ({
  'usuarios/dono': { tenantId: 'dono', role: 'Master', modulosBloqueados: ['producao'] },
  'usuarios/f1': { tenantId: 'dono', role: 'Funcionario', permissoes: [] },
  'configuracoes/dono': configMatriz,
  ...extra,
});

const novaFilial = (extra = {}) => ({
  codigo: '20', nome: 'Loja Baixada', tipo: 'cnpj_proprio', cnpj: '11.222.333/0002-62', razaoSocial: 'Shopping Rural Baixada Ltda',
  uf: 'ES', cidade: 'Serra', rua: 'Rua B', numero: '10', bairro: 'Centro', ...extra,
});

const DONO = { uid: 'dono', tenantId: 'dono' };

test('primeira filial: a empresa vira matriz 10, o grupo nasce e a configuracao e\' copiada sem a identidade', async () => {
  const fake = criarBancoFalso(semGrupo());
  const s = carregar(fake.db);
  const r = await s.criarFilial({ user: DONO, corpo: novaFilial() });

  const grupo = fake.ler(`grupos/${r.grupoId}`);
  assert.equal(grupo.matrizTenantId, 'dono');
  assert.equal(grupo.donoUid, 'dono');
  assert.deepEqual(grupo.filiais.map((f) => [f.codigo, f.nome, f.matriz]), [['10', 'LOJA CENTRO', true], ['20', 'LOJA BAIXADA', false]]);
  assert.deepEqual(grupo.modulosBloqueados, ['producao'], 'o plano (modulos) da matriz vale para as filiais');

  assert.equal(fake.ler('configuracoes/dono').grupoId, r.grupoId);
  assert.equal(fake.ler('configuracoes/dono').filialCodigo, '10');

  const config = fake.ler(`configuracoes/${r.tenantId}`);
  assert.equal(config.tenantId, r.tenantId);
  assert.equal(config.grupoId, r.grupoId);
  assert.equal(config.cnpj, CNPJ_FILIAL);
  assert.equal(config.nomeOficina, 'LOJA BAIXADA');
  assert.equal(config.inscricaoEstadual, '');
  assert.equal(config.spedyEnabled, false);
  assert.equal('spedyApiKey' in config, false);
  assert.equal(config.trabalhaComPreVenda, true);

  assert.equal(fake.ler(`cnpjs_cadastrados/${CNPJ_FILIAL}`).tenantId, r.tenantId, 'o CNPJ da filial fica reservado no sistema');
});

test('segunda filial entra no mesmo grupo; codigo e CNPJ repetidos sao recusados', async () => {
  const fake = criarBancoFalso(semGrupo());
  const s = carregar(fake.db);
  const primeira = await s.criarFilial({ user: DONO, corpo: novaFilial() });
  await assert.rejects(() => s.criarFilial({ user: DONO, corpo: novaFilial({ cnpj: '11.222.333/0003-43' }) }), /código 20 já é da filial/);
  await assert.rejects(() => s.criarFilial({ user: DONO, corpo: novaFilial({ codigo: '30' }) }), /já é da filial/);
  const deposito = await s.criarFilial({ user: DONO, corpo: novaFilial({ codigo: '30', nome: 'Depósito', tipo: 'mesmo_cnpj', cnpj: '' }) });
  assert.equal(deposito.grupoId, primeira.grupoId);
  assert.deepEqual(fake.ler(`grupos/${primeira.grupoId}`).filiais.map((f) => f.codigo), ['10', '20', '30']);
  assert.equal(fake.ler(`configuracoes/${deposito.tenantId}`).cnpj, CNPJ_MATRIZ);
});

test('CNPJ ja cadastrado como outra empresa do sistema e\' recusado', async () => {
  const fake = criarBancoFalso(semGrupo({ [`cnpjs_cadastrados/${CNPJ_FILIAL}`]: { tenantId: 'outra' } }));
  await assert.rejects(() => carregar(fake.db).criarFilial({ user: DONO, corpo: novaFilial() }), /já está cadastrado no sistema/);
});

test('so\' dono ou administrador cadastra filial', async () => {
  const fake = criarBancoFalso(semGrupo());
  await assert.rejects(() => carregar(fake.db).criarFilial({ user: { uid: 'f1' }, corpo: novaFilial() }), /Só o dono ou um administrador/);
});

test('trocar de filial: grava a filial ativa, volta para casa apagando, e funcionario precisa da permissao', async () => {
  const fake = criarBancoFalso(semGrupo());
  const s = carregar(fake.db);
  const { tenantId } = await s.criarFilial({ user: DONO, corpo: novaFilial() });

  const lista = await s.listarFiliais({ user: DONO });
  assert.deepEqual(lista.filiais.map((f) => f.codigo), ['10', '20']);
  assert.equal(lista.podeTrocar, true);
  assert.equal(lista.filialAtiva, 'dono');

  await s.ativarFilial({ user: DONO, destino: tenantId });
  assert.equal(fake.ler('usuarios/dono').filialAtiva, tenantId);
  await s.ativarFilial({ user: DONO, destino: 'dono' });
  assert.equal('filialAtiva' in fake.ler('usuarios/dono'), false, 'voltar para a casa apaga o campo');

  const funcionario = { uid: 'f1' };
  assert.deepEqual((await s.listarFiliais({ user: funcionario })).filiais.map((f) => f.codigo), ['10']);
  await assert.rejects(() => s.ativarFilial({ user: funcionario, destino: tenantId }), /Utiliza outras filiais/);
});

test('funcionario com "Utiliza outras filiais" entra; filial de outro grupo nao', async () => {
  const fake = criarBancoFalso(semGrupo({ 'usuarios/f1': { tenantId: 'dono', role: 'Funcionario', permissoes: ['filiais.utilizar'] } }));
  const s = carregar(fake.db);
  const { tenantId } = await s.criarFilial({ user: DONO, corpo: novaFilial() });
  await s.ativarFilial({ user: { uid: 'f1' }, destino: tenantId });
  assert.equal(fake.ler('usuarios/f1').filialAtiva, tenantId);
  assert.equal(fake.ler('usuarios/f1').tenantId, 'dono', 'a filial "casa" do funcionario nao muda');
  await assert.rejects(() => s.ativarFilial({ user: { uid: 'f1' }, destino: 'empresa-de-outro' }), /não faz parte/);
});

test('editar: nome e codigo, sem inativar a matriz nem a filial em que o proprio usuario esta', async () => {
  const fake = criarBancoFalso(semGrupo());
  const s = carregar(fake.db);
  const { tenantId, grupoId } = await s.criarFilial({ user: DONO, corpo: novaFilial() });
  await s.editarFilial({ user: DONO, tenantId, corpo: { nome: 'Baixada Sul', codigo: '25' } });
  const filial = fake.ler(`grupos/${grupoId}`).filiais.find((f) => f.tenantId === tenantId);
  assert.equal(filial.nome, 'BAIXADA SUL');
  assert.equal(filial.codigo, '25');
  assert.equal(fake.ler(`configuracoes/${tenantId}`).filialCodigo, '25');
  assert.equal(fake.ler(`configuracoes/${tenantId}`).nomeOficina, 'BAIXADA SUL');

  await s.editarFilial({ user: DONO, tenantId, corpo: { rua: 'Av. Central', numero: '500', inscricaoMunicipal: '9988', contato: 'Vinicios', cnpj: '00000000000000' } });
  const config = fake.ler(`configuracoes/${tenantId}`);
  assert.equal(config.rua, 'AV. CENTRAL');
  assert.equal(config.nfseInscricaoMunicipal, '9988');
  assert.equal(config.nomeUsuario, 'VINICIOS');
  assert.equal(config.cnpj, CNPJ_FILIAL, 'CNPJ nao muda na edicao');
  const cadastro = await s.lerCadastroDaFilial({ user: DONO, tenantId });
  assert.equal(cadastro.dados.rua, 'AV. CENTRAL');
  assert.equal(cadastro.dados.cidade, 'SERRA');
  await assert.rejects(() => s.lerCadastroDaFilial({ user: { uid: 'f1' }, tenantId }), /Só o dono ou um administrador/);

  await assert.rejects(() => s.editarFilial({ user: DONO, tenantId: 'dono', corpo: { ativa: false } }), /matriz não pode ser inativada/);
  await s.ativarFilial({ user: DONO, destino: tenantId });
  await assert.rejects(() => s.editarFilial({ user: DONO, tenantId, corpo: { ativa: false } }), /Entre em outra antes/);
  await s.ativarFilial({ user: DONO, destino: 'dono' });
  await s.editarFilial({ user: DONO, tenantId, corpo: { ativa: false } });
  assert.equal(fake.ler(`grupos/${grupoId}`).filiais.find((f) => f.tenantId === tenantId).ativa, false);
  await assert.rejects(() => s.ativarFilial({ user: DONO, destino: tenantId }), /inativa/);
});

