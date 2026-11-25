const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Seguranca, bloco B (25/11/2026): PIN novo com 4 digitos ou mais; senha curta
 * antiga so' no balcao e na liberacao de desconto; contador de erros por canal;
 * resposta unica (sem dizer quantas tentativas restam); o acerto nao zera a
 * escada de bloqueios; inativo so' aparece depois da senha certa.
 */

const carregar = (db) => {
  const [pin, sessoes] = carregarComBancoFalso(db, 'services/vendedorPin', 'services/sessoes').slice(-2);
  return { pin, sessoes };
};

const BASE = {
  'usuarios/ana': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', codigoVendedor: '07', nome: 'ANA' },
  'usuarios/rui': { tenantId: 'loja', role: 'Funcionario', status: 'Inativo', codigoVendedor: '08', nome: 'RUI' },
  'usuarios/sem': { tenantId: 'loja', role: 'Funcionario', status: 'Ativo', codigoVendedor: '09', nome: 'SEM SENHA' },
};

const pinLegado = (fake, id, pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return fake.db.collection('usuarios_pin').doc(id).set({ tenantId: 'loja', pinHash, pinSalt: salt, canais: {} });
};

const preparar = async () => {
  const fake = criarBancoFalso(BASE, { consultas: true });
  const { pin, sessoes } = carregar(fake.db);
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'ana', pin: '4826', autorId: 'dono' });
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'rui', pin: '4826', autorId: 'dono' });
  return { fake, pin, sessoes };
};

const validar = (pin, codigo, senha, canal) => pin.validarPin({ tenantId: 'loja', codigo, pin: senha, canal });

test('senha nova so com 4 digitos ou mais', async () => {
  const { fake, pin } = await preparar();
  await assert.rejects(
    pin.definirPin({ tenantId: 'loja', usuarioId: 'ana', pin: '123', autorId: 'dono' }),
    (e) => e.status === 400 && /de 4 a 10 dígitos/.test(e.message),
  );
  await fake.db.collection('usuarios').doc('ana').update({ pinCurto: true });
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'ana', pin: '9081', autorId: 'dono' });
  assert.equal(fake.ler('usuarios/ana').pinCurto, undefined, 'senha nova tira o aviso de senha curta');
});

test('resposta unica: codigo inexistente, sem senha e senha errada dizem o mesmo, sem contar tentativas restantes', async () => {
  const { pin } = await preparar();
  const mensagens = [];
  for (const [codigo, senha] of [['55', '4826'], ['09', '4826'], ['07', '1111']]) {
    await assert.rejects(validar(pin, codigo, senha, 'app'), (e) => {
      mensagens.push(`${e.status} ${e.message}`);
      return true;
    });
  }
  assert.equal(new Set(mensagens).size, 1, mensagens.join('\n'));
  assert.match(mensagens[0], /^401 Código ou senha inválidos/);
  assert.ok(!/tentativa/.test(mensagens[0]));
});

test('inativo so aparece depois da senha certa', async () => {
  const { pin } = await preparar();
  await assert.rejects(validar(pin, '08', '1111', 'balcao'), (e) => e.status === 401 && /Código ou senha inválidos/.test(e.message));
  await assert.rejects(validar(pin, '08', '4826', 'balcao'), (e) => e.status === 403 && /inativo/.test(e.message));
});

test('cada canal tem o proprio contador: 5 erros pelo app nao travam o balcao', async () => {
  const { fake, pin } = await preparar();
  for (let i = 0; i < 5; i += 1) await assert.rejects(validar(pin, '07', '1111', 'app'));
  await assert.rejects(validar(pin, '07', '4826', 'app'), (e) => e.status === 429 && /bloqueado/.test(e.message));
  const noBalcao = await validar(pin, '07', '4826', 'balcao');
  assert.equal(noBalcao.vendedorId, 'ana');
  const canais = fake.ler('usuarios_pin/ana').canais;
  assert.equal(canais.app.bloqueiosSeguidos, 1);
  assert.equal(canais.balcao.tentativasFalhas, 0);
});

test('acertar a senha zera a rodada mas nao a escada de bloqueios', async () => {
  const { pin } = await preparar();
  const s = pin;
  const registro = { tentativasFalhas: 3, bloqueiosSeguidos: 2, bloqueadoAteMs: 0, ultimaFalhaMs: 1000 };
  assert.deepEqual(s.depoisDoAcerto(registro), { tentativasFalhas: 0, bloqueadoAteMs: null, bloqueiosSeguidos: 2, ultimaFalhaMs: 1000 });
  // Proximo bloqueio continua dobrando (escada 2 -> 20 minutos).
  let estado = s.depoisDoAcerto(registro);
  let r;
  for (let i = 0; i < s.MAX_TENTATIVAS; i += 1) {
    r = s.reservarTentativa(estado, 5000);
    estado = r.seErrar;
  }
  assert.equal(r.minutosDeBloqueio, s.BLOQUEIO_MINUTOS * 4);
  // 24 h sem errar: volta ao comeco.
  const umDiaDepois = 5000 + 24 * 60 * 60 * 1000 + 1;
  const novo = s.reservarTentativa({ tentativasFalhas: 4, bloqueiosSeguidos: 6, bloqueadoAteMs: 0, ultimaFalhaMs: 5000 }, umDiaDepois);
  assert.equal(novo.tentativa, 1);
  assert.equal(novo.seErrar.bloqueiosSeguidos, 0);
});

test('senha curta de antes: vale no balcao e no desconto, nao no app; a tela de Usuarios fica sabendo', async () => {
  const { fake, pin } = await preparar();
  await pinLegado(fake, 'ana', '73');
  await assert.rejects(validar(pin, '07', '73', 'app'), (e) => e.status === 400 && /menos de 4 dígitos não valem no aplicativo/.test(e.message));
  assert.equal(fake.ler('usuarios_pin/ana').canais.app, undefined, 'senha curta no app nem conta tentativa');
  assert.equal((await validar(pin, '07', '73', 'balcao')).vendedorId, 'ana');
  assert.equal((await validar(pin, '07', '73', 'desconto')).vendedorId, 'ana');
  assert.equal(fake.ler('usuarios/ana').pinCurto, true);
  await pin.definirPin({ tenantId: 'loja', usuarioId: 'ana', pin: '4826', autorId: 'dono' });
  assert.equal((await validar(pin, '07', '4826', 'app')).vendedorId, 'ana');
  assert.equal(fake.ler('usuarios/ana').pinCurto, undefined);
});

test('sessao encerrada: login de antes da marca nao vale; o de depois vale', async () => {
  const { sessoes } = await preparar();
  const marca = new Date('2026-11-25T12:00:00Z');
  const perfil = { sessaoValidaApos: marca };
  assert.equal(sessoes.sessaoEncerrada(perfil, marca.getTime() / 1000 - 60), true);
  assert.equal(sessoes.sessaoEncerrada(perfil, marca.getTime() / 1000 + 60), false);
  assert.equal(sessoes.sessaoEncerrada({}, 1), false);
});

test('encerrar sessoes: revoga o login e marca a ficha; conta sem login no Auth tambem marca', async () => {
  const { fake, sessoes } = await preparar();
  const n = await sessoes.encerrarSessoes(['ana', 'ana', 'rui', '', 'x/y'], 'teste');
  assert.equal(n, 2);
  assert.deepEqual(fake.db.__sessoesEncerradas, ['ana', 'rui']);
  assert.ok(fake.ler('usuarios/ana').sessaoValidaApos instanceof Date);
});

test('revisao de 25/11: no balcao o acerto zera a escada de bloqueios; no app a escada fica', async () => {
  const { fake, pin } = await preparar();
  const escada = { tentativasFalhas: 2, bloqueiosSeguidos: 3, bloqueadoAte: null, ultimaFalhaEm: new Date() };
  await fake.db.collection('usuarios_pin').doc('ana').update({ 'canais.balcao': escada, 'canais.app': escada });
  await validar(pin, '07', '4826', 'balcao');
  await validar(pin, '07', '4826', 'app');
  const canais = fake.ler('usuarios_pin/ana').canais;
  assert.equal(canais.balcao.bloqueiosSeguidos, 0);
  assert.equal(canais.balcao.tentativasFalhas, 0);
  assert.equal(canais.app.bloqueiosSeguidos, 3);
  assert.equal(canais.app.tentativasFalhas, 0);
});

test('revisao de 25/11: a marca de sessao encerrada usa o horario do Firebase (tokensValidAfterTime)', async () => {
  const fake = criarBancoFalso(BASE, { consultas: true });
  fake.db.__contasDoAuth = new Map([['ana', { tokensValidAfterTime: 'Wed, 25 Nov 2026 12:00:00 GMT' }]]);
  const { sessoes } = carregar(fake.db);
  await sessoes.encerrarSessoes(['ana'], 'teste');
  assert.equal(fake.ler('usuarios/ana').sessaoValidaApos.getTime(), Date.parse('Wed, 25 Nov 2026 12:00:00 GMT'));
});
