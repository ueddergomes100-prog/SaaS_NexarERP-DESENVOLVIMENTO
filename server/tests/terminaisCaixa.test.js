const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Computador do caixa + entrada com codigo e senha (22/11/2026): so' um
 * computador ativado por gerente aceita codigo e senha; a conta e' a do
 * proprio funcionario, que precisa ter acesso a Frente de Caixa.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => {
  const [terminais, pin] = carregarComBancoFalso(db, 'services/terminaisCaixa', 'services/vendedorPin').slice(-2);
  return { terminais, pin };
};

const GERENTE = { uid: 'dono', tenantId: 'loja', homeTenantId: 'loja', dono: true, nome: 'Dono' };
const FUNCIONARIO = { uid: 'ana', tenantId: 'loja', homeTenantId: 'loja', dono: false, isTenantManager: false, nome: 'Ana' };

const BASE = {
  'configuracoes/loja': { cnpj: '12.345.678/0001-90', nomeFantasia: 'Loja Teste' },
  'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', codigoVendedor: '07', permissoes: ['vendas.so_caixa'], nome: 'ANA' },
  'usuarios/bia': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', codigoVendedor: '08', permissoes: ['cadastros.clientes'], nome: 'BIA' },
  'usuarios/chefe': { tenantId: 'loja', role: 'Admin', status: 'Ativo', codigoVendedor: '09', permissoes: [], nome: 'CHEFE' },
  'usuarios/balcao': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', tipoRegistro: 'vendedor', codigoVendedor: '10', permissoes: ['vendas.pdv'], nome: 'BALCAO' },
};

const preparar = async () => {
  const fake = criarBancoFalso(BASE, { consultas: true });
  const { terminais, pin } = carregar(fake.db);
  for (const id of ['ana', 'bia', 'chefe', 'balcao']) {
    await pin.definirPin({ tenantId: 'loja', usuarioId: id, pin: '4826', autorId: 'dono' });
  }
  const terminal = await terminais.ativarTerminal({ user: GERENTE, nome: '  Caixa   1 ' });
  return { fake, terminais, terminal };
};

test('ativar: so dono/administrador; nome obrigatorio; guarda so o hash do segredo', async () => {
  const { fake, terminais, terminal } = await preparar();
  assert.equal(terminal.nome, 'Caixa 1');
  assert.equal(terminal.cnpj, '12345678000190');
  assert.equal(terminal.empresa, 'Loja Teste');
  assert.equal(terminal.segredo.length, 64);
  const gravado = fake.ler(`terminais_caixa/${terminal.terminalId}`);
  assert.equal(gravado.tenantId, 'loja');
  assert.equal(gravado.ativo, true);
  assert.equal(gravado.segredoHash, terminais.hashDoSegredo(terminal.segredo));
  assert.ok(!JSON.stringify(gravado).includes(terminal.segredo), 'o segredo em si nao fica no banco');
  await assert.rejects(terminais.ativarTerminal({ user: FUNCIONARIO, nome: 'Caixa 2' }), (e) => e.status === 403);
  await assert.rejects(terminais.ativarTerminal({ user: GERENTE, nome: '   ' }), (e) => e.status === 400);
});

test('entrar: codigo + senha certos no computador ativado devolvem a conta do proprio funcionario', async () => {
  const { fake, terminais, terminal } = await preparar();
  const r = await terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '7', pin: '4826' });
  assert.equal(r.operadorNome, 'ANA');
  assert.equal(r.tenantId, 'loja');
  assert.match(r.token, /^custom:ana:/);
  assert.deepEqual(JSON.parse(r.token.split(':').slice(2).join(':')), { viaTerminalCaixa: terminal.terminalId });
  assert.equal(fake.ler(`terminais_caixa/${terminal.terminalId}`).ultimoOperadorNome, 'ANA');
});

test('entrar: segredo errado, computador desconhecido ou desativado nao deixa nem tentar a senha', async () => {
  const { fake, terminais, terminal } = await preparar();
  const pinAntes = JSON.stringify(fake.ler('usuarios_pin/ana'));
  for (const tentativa of [
    { terminalId: terminal.terminalId, segredo: 'b'.repeat(64) },
    { terminalId: 'nao-existe', segredo: terminal.segredo },
    { terminalId: terminal.terminalId, segredo: '' },
  ]) {
    await assert.rejects(
      terminais.entrarComCodigo({ ...tentativa, codigo: '07', pin: '4826' }),
      (e) => e.status === 401 && /não está mais ativado/.test(e.message),
    );
  }
  assert.equal(JSON.stringify(fake.ler('usuarios_pin/ana')), pinAntes, 'nenhuma tentativa contada no funcionario');

  await terminais.desativarTerminal({ user: GERENTE, terminalId: terminal.terminalId });
  await assert.rejects(
    terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '07', pin: '4826' }),
    (e) => e.status === 401,
  );
});

test('entrar: administrador nunca entra por senha curta; sem acesso ao caixa e recusado; senha errada conta tentativa', async () => {
  const { terminais, terminal } = await preparar();
  const com = (codigo, pin = '4826') => terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin });
  await assert.rejects(com('09'), (e) => e.status === 403 && /administrador/.test(e.message));
  await assert.rejects(com('08'), (e) => e.status === 403 && /BIA não tem acesso à Frente de Caixa/.test(e.message));
  await assert.rejects(com('07', '1111'), (e) => e.status === 401 && /tentativa/.test(e.message));
  // Vendedor de balcao com permissao do PDV: entra, com a marca que o middleware exige.
  const balcao = await com('10');
  assert.deepEqual(JSON.parse(balcao.token.split(':').slice(2).join(':')), { viaTerminalCaixa: terminal.terminalId, isVendedorBalcao: true });
});

test('listar e desativar: so gerente, so da propria empresa', async () => {
  const { fake, terminais, terminal } = await preparar();
  const lista = await terminais.listarTerminais({ user: GERENTE });
  assert.deepEqual(lista.map((t) => [t.nome, t.ativo]), [['Caixa 1', true]]);
  assert.equal(JSON.stringify(lista).includes('segredo'), false, 'a lista nao leva hash nem segredo');
  await assert.rejects(terminais.listarTerminais({ user: FUNCIONARIO }), (e) => e.status === 403);
  await assert.rejects(terminais.desativarTerminal({ user: { ...GERENTE, tenantId: 'outra' }, terminalId: terminal.terminalId }), (e) => e.status === 404);
  await terminais.desativarTerminal({ user: GERENTE, terminalId: terminal.terminalId });
  assert.equal(fake.ler(`terminais_caixa/${terminal.terminalId}`).ativo, false);
});
