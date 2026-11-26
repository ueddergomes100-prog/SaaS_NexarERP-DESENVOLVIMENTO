const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Computador do caixa + entrada com codigo e senha (22/11/2026): so' um
 * computador ativado por gerente aceita codigo e senha; a conta e' a do
 * proprio funcionario, que precisa ter acesso a Frente de Caixa.
 */
const crypto = require('node:crypto');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/** Senha curta de ANTES do bloco B (25/11/2026): definirPin nao aceita mais; grava o hash como o servidor gravava. */
const pinLegado = (fake, id, pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return fake.db.collection('usuarios_pin').doc(id).set({ tenantId: 'loja', pinHash, pinSalt: salt, canais: {} });
};

const carregar = (db) => {
  const [terminais, pin] = carregarComBancoFalso(db, 'services/terminaisCaixa', 'services/vendedorPin').slice(-2);
  return { terminais, pin };
};

const GERENTE = { uid: 'dono', tenantId: 'loja', homeTenantId: 'loja', dono: true, nome: 'Dono' };
const FUNCIONARIO = { uid: 'ana', tenantId: 'loja', homeTenantId: 'loja', dono: false, dono: false, nome: 'Ana' };

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
  return { fake, terminais, terminal, pin };
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
      (e) => e.status === 401 && /não está mais ativado para entrar com código/.test(e.message),
    );
  }
  assert.equal(JSON.stringify(fake.ler('usuarios_pin/ana')), pinAntes, 'nenhuma tentativa contada no funcionario');

  await terminais.desativarTerminal({ user: GERENTE, terminalId: terminal.terminalId });
  await assert.rejects(
    terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '07', pin: '4826' }),
    (e) => e.status === 401,
  );
});

test('entrar: administrador so com 6 digitos ou mais; sem acesso ao caixa e recusado; senha errada conta tentativa sem dizer quantas restam', async () => {
  const { fake, terminais, terminal, pin } = await preparar();
  const com = (codigo, senha = '4826') => terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin: senha });
  // Dono/administrador (bloco B, 25/11/2026): 4 digitos nao bastam; 6 entram, mesmo sem a permissao do PDV.
  await assert.rejects(com('09'), (e) => e.status === 403 && /6 dígitos ou mais/.test(e.message));
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'chefe', pin: '482613', autorId: 'dono' });
  const chefe = await com('09', '482613');
  assert.match(chefe.token, /^custom:chefe:/);
  await assert.rejects(com('08'), (e) => e.status === 403 && /BIA não tem acesso à Frente de Caixa/.test(e.message));
  await assert.rejects(com('07', '1111'), (e) => e.status === 401 && /Código ou senha inválidos/.test(e.message) && !/tentativa/.test(e.message));
  assert.equal(fake.ler('usuarios_pin/ana').canais.terminal.tentativasFalhas, 1, 'erro contado no canal do computador');
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

test('entrar no SISTEMA: senha de 4 digitos ou mais; sem exigir caixa; vendedor de balcao fica de fora', async () => {
  const { terminais, terminal } = await preparar();
  const comSistema = (codigo, pin) => terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin, destino: 'sistema' });
  // BIA nao opera o caixa, mas entra no sistema (as permissoes dela valem la dentro).
  const bia = await comSistema('08', '4826');
  assert.match(bia.token, /^custom:bia:/);
  assert.deepEqual(JSON.parse(bia.token.split(':').slice(2).join(':')), { viaTerminalCaixa: terminal.terminalId });
  await assert.rejects(comSistema('10', '4826'), (e) => e.status === 403 && /vendedor de balcão/.test(e.message));
  await assert.rejects(comSistema('09', '4826'), (e) => e.status === 403 && /6 dígitos ou mais/.test(e.message));
  // Senha curta de antes (bloco B): identifica a venda no balcao, mas nao entra no computador (nem caixa, nem sistema).
  const fake2 = criarBancoFalso(BASE, { consultas: true });
  const { terminais: t2, pin } = carregar(fake2.db);
  await pinLegado(fake2, 'ana', '73');
  const term2 = await t2.ativarTerminal({ user: GERENTE, nome: 'Caixa 2' });
  for (const destino of ['sistema', 'caixa']) {
    await assert.rejects(
      t2.entrarComCodigo({ terminalId: term2.terminalId, segredo: term2.segredo, codigo: '07', pin: '73', destino }),
      (e) => e.status === 400 && /menos de 4 dígitos não valem no computador do caixa/.test(e.message),
      destino,
    );
  }
  const noBalcao = await pin.validarPin({ tenantId: 'loja', codigo: '07', pin: '73', canal: 'balcao' });
  assert.equal(noBalcao.vendedorId, 'ana');
  assert.equal(fake2.ler('usuarios/ana').pinCurto, true, 'a tela de Usuarios avisa que a senha e curta');
});

test('dono/administrador com senha curta nao entra por codigo; gestor da plataforma nunca', async () => {
  const fake = criarBancoFalso({
    ...BASE,
    'usuarios/chefe': { ...BASE['usuarios/chefe'], role: 'Master' },
    'usuarios/plataforma': { tenantId: 'loja', role: 'SuperAdmin', status: 'Ativo', codigoVendedor: '11', permissoes: [], nome: 'PLATAFORMA' },
  }, { consultas: true });
  const { terminais, pin } = carregar(fake.db);
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'chefe', pin: '48261', autorId: 'dono' });
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'plataforma', pin: '482613', autorId: 'dono' });
  const t = await terminais.ativarTerminal({ user: GERENTE, nome: 'Caixa 3' });
  const entrar = (codigo, senha, destino) => terminais.entrarComCodigo({ terminalId: t.terminalId, segredo: t.segredo, codigo, pin: senha, destino });
  await assert.rejects(entrar('09', '48261'), (e) => e.status === 403 && /6 dígitos ou mais/.test(e.message));
  await assert.rejects(entrar('09', '48261', 'sistema'), (e) => e.status === 403 && /6 dígitos ou mais/.test(e.message));
  await assert.rejects(entrar('11', '482613', 'sistema'), (e) => e.status === 403 && /não entra com código/.test(e.message));
});

test('entrar: cadastro com o id de uma filial ou de uma conta da plataforma nao recebe login (auditoria de 24/11/2026)', async () => {
  const fake = criarBancoFalso({
    ...BASE,
    // A filial e' um id de `configuracoes` sem ficha em `usuarios`: o cadastro abaixo foi criado pela tela com esse id.
    'configuracoes/filial-alheia': { cnpj: '98.765.432/0001-10', nomeFantasia: 'Filial de outra empresa' },
    'usuarios/filial-alheia': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', tipoRegistro: 'vendedor', codigoVendedor: '20', permissoes: ['vendas.pdv'], nome: 'PLANTADO' },
    'usuarios/uid-da-plataforma': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', tipoRegistro: 'vendedor', codigoVendedor: '21', permissoes: ['vendas.pdv'], nome: 'PLANTADO 2' },
  }, { consultas: true });
  fake.db.__contasDoAuth = new Map([['uid-da-plataforma', { customClaims: { role: 'SuperAdmin' }, email: 'equipe@hennder.test' }]]);
  const { terminais, pin } = carregar(fake.db);
  for (const id of ['filial-alheia', 'uid-da-plataforma', 'ana']) {
    await pin.definirPin({ tenantId: 'loja', usuarioId: id, pin: '4826', autorId: 'dono' });
  }
  const terminal = await terminais.ativarTerminal({ user: GERENTE, nome: 'Caixa 1' });
  const com = (codigo) => terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo, pin: '4826' });

  await assert.rejects(com('20'), (e) => e.status === 403 && /identificador dele pertence a outra conta/.test(e.message));
  await assert.rejects(com('21'), (e) => e.status === 403 && /identificador dele pertence a outra conta/.test(e.message));
  // O funcionario de verdade continua entrando.
  const r = await com('07');
  assert.match(r.token, /^custom:ana:/);
});

test('computador parado ha mais de 180 dias precisa ser ativado de novo', async () => {
  const { fake, terminais, terminal } = await preparar();
  await fake.db.collection('terminais_caixa').doc(terminal.terminalId).update({ ultimoUsoEm: new Date(Date.now() - terminais.VALIDADE_SEM_USO_MS - 60000) });
  await assert.rejects(
    terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '07', pin: '4826' }),
    (e) => e.status === 401 && /mais de 6 meses/.test(e.message),
  );
});

test('desativar o computador encerra a sessao de quem entrou por ele', async () => {
  const { fake, terminais, terminal } = await preparar();
  await terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '07', pin: '4826' });
  await terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '10', pin: '4826' });
  const d = await terminais.desativarTerminal({ user: GERENTE, terminalId: terminal.terminalId });
  assert.equal(d.sessoesEncerradas, 2);
  assert.deepEqual(fake.db.__sessoesEncerradas.sort(), ['ana', 'balcao']);
  assert.ok(fake.ler('usuarios/ana').sessaoValidaApos instanceof Date, 'o servidor recusa o login de antes');
  assert.equal(fake.ler('usuarios/bia').sessaoValidaApos, undefined, 'quem nao entrou por ele segue');
});

test('revisao de 25/11: o segredo do computador NAO troca a cada entrada (resposta perdida ou duas abas nao travam o caixa)', async () => {
  const { fake, terminais, terminal } = await preparar();
  const antes = fake.ler(`terminais_caixa/${terminal.terminalId}`).segredoHash;
  for (let i = 0; i < 3; i += 1) {
    const r = await terminais.entrarComCodigo({ terminalId: terminal.terminalId, segredo: terminal.segredo, codigo: '07', pin: '4826' });
    assert.equal(r.novoSegredo, undefined);
  }
  assert.equal(fake.ler(`terminais_caixa/${terminal.terminalId}`).segredoHash, antes);
});
