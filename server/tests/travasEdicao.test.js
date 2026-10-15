const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Trava de edicao (15/10/2026): um documento aberto por vez. Firestore falso
 * em memoria; o tempo e' passado pelo teste (agoraMs).
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/travasEdicao')[3];

const T0 = Date.UTC(2026, 9, 15, 14, 0, 0);
const MIN = 60 * 1000;
const MARIA = { uid: 'maria', tenantId: 'emp', email: 'maria@x' };
const JOAO = { uid: 'joao', tenantId: 'emp', email: 'joao@x' };
const PEDIDO = { tipo: 'conferencia', registroId: 'p83' };
const banco = () => criarBancoFalso({
  'usuarios/maria': { tenantId: 'emp', nome: 'MARIA' },
  'usuarios/joao': { tenantId: 'emp', nome: 'JOAO' },
});
const chave = 'travas_edicao/emp__conferencia__p83';

test('quem abre pega a vez; outra pessoa e\' barrada com o nome e o aparelho', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  const r = await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1', aparelho: 'celular' }, agoraMs: T0 });
  assert.equal(r.trava.usuarioNome, 'MARIA');
  assert.equal(fake.ler(chave).aparelho, 'celular');

  await assert.rejects(
    s.pegarTrava({ user: JOAO, corpo: { ...PEDIDO, sessaoId: 'sessao-joao-1' }, agoraMs: T0 + MIN }),
    (erro) => erro.status === 409 && /Em edição por MARIA no celular/.test(erro.message) && erro.extra.trava.usuarioId === 'maria',
  );
});

test('o mesmo usuario em outro aparelho assume a vez; a tela antiga fica sabendo no proximo aviso', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'computador-maria' }, agoraMs: T0 });
  const r = await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'celular-maria', aparelho: 'celular' }, agoraMs: T0 + MIN });
  assert.equal(r.assumiuDeOutraTela, true);
  const sinal = await s.renovarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'computador-maria', mexeu: true }, agoraMs: T0 + MIN + 1000 });
  assert.equal(sinal.estado, 'perdeu');
});

test('sem aviso por 2 minutos (tela fechada, celular desligado) a vez fica livre', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1' }, agoraMs: T0 });
  const r = await s.pegarTrava({ user: JOAO, corpo: { ...PEDIDO, sessaoId: 'sessao-joao-1' }, agoraMs: T0 + 2 * MIN + 1 });
  assert.equal(r.trava.usuarioId, 'joao');
});

test('tela aberta e parada por 10 minutos: a vez e\' liberada mesmo com os avisos chegando', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1' }, agoraMs: T0 });
  // Avisos a cada 30 s, sem ninguem mexer.
  let ultimo;
  for (let t = T0 + 30_000; t <= T0 + 10 * MIN; t += 30_000) {
    ultimo = await s.renovarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1', mexeu: false }, agoraMs: t });
  }
  assert.equal(ultimo.estado, 'venceu');
  assert.equal(fake.ler(chave), undefined, 'trava apagada');
  const joao = await s.pegarTrava({ user: JOAO, corpo: { ...PEDIDO, sessaoId: 'sessao-joao-1' }, agoraMs: T0 + 10 * MIN + 1 });
  assert.equal(joao.trava.usuarioId, 'joao');
});

test('mexendo na tela, a vez continua por mais de 10 minutos', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1' }, agoraMs: T0 });
  for (let t = T0 + 30_000; t <= T0 + 15 * MIN; t += 30_000) {
    const r = await s.renovarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1', mexeu: true }, agoraMs: t });
    assert.equal(r.estado, 'ok');
  }
  await assert.rejects(s.pegarTrava({ user: JOAO, corpo: { ...PEDIDO, sessaoId: 'sessao-joao-1' }, agoraMs: T0 + 15 * MIN + 1000 }), (erro) => erro.status === 409);
});

test('soltar: so\' a propria sessao solta; liberar: so\' quem pode', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1' }, agoraMs: T0 });

  assert.deepEqual(await s.soltarTrava({ uid: 'joao', tenantId: 'emp', corpo: { ...PEDIDO, sessaoId: 'sessao-maria-1' } }), { soltou: false });
  assert.ok(fake.ler(chave));

  await assert.rejects(s.liberarTrava({ user: JOAO, corpo: PEDIDO, podeLiberar: false, agoraMs: T0 }), (erro) => erro.status === 403);
  const liberada = await s.liberarTrava({ user: JOAO, corpo: PEDIDO, podeLiberar: true, agoraMs: T0 + MIN });
  assert.deepEqual(liberada, { liberou: true, de: 'MARIA' });
  assert.equal(fake.ler(chave), undefined);

  await s.pegarTrava({ user: MARIA, corpo: { ...PEDIDO, sessaoId: 'sessao-maria-2' }, agoraMs: T0 + 2 * MIN });
  assert.deepEqual(await s.soltarTrava({ uid: 'maria', tenantId: 'emp', corpo: { ...PEDIDO, sessaoId: 'sessao-maria-2' } }), { soltou: true });
  assert.equal(fake.ler(chave), undefined);
});

test('pedido invalido: mensagem em portugues', async () => {
  const s = carregar(banco().db);
  await assert.rejects(s.pegarTrava({ user: MARIA, corpo: { tipo: 'xyz', registroId: 'p1', sessaoId: 'sessao-123' } }), /Tipo de documento desconhecido/);
  await assert.rejects(s.pegarTrava({ user: MARIA, corpo: { tipo: 'conferencia', registroId: 'a/b', sessaoId: 'sessao-123' } }), /Documento inválido/);
  await assert.rejects(s.pegarTrava({ user: MARIA, corpo: { tipo: 'conferencia', registroId: 'p1', sessaoId: 'x' } }), /Sessão inválida/);
});
