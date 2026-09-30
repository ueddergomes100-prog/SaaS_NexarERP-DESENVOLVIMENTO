const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TENTATIVAS,
  BLOQUEIO_MINUTOS,
  reservarTentativa,
  duracaoDoBloqueioMinutos,
  formatarDuracao,
} = require('../services/vendedorPin');

const AGORA = Date.UTC(2026, 8, 29, 22, 0, 0);

test('bloqueio: o primeiro dura o mesmo de antes; os seguidos dobram ate 24h', () => {
  assert.equal(duracaoDoBloqueioMinutos(0), BLOQUEIO_MINUTOS);
  assert.equal(duracaoDoBloqueioMinutos(1), BLOQUEIO_MINUTOS * 2);
  assert.equal(duracaoDoBloqueioMinutos(3), BLOQUEIO_MINUTOS * 8);
  assert.equal(duracaoDoBloqueioMinutos(50), 24 * 60);
  // lixo gravado no banco nao pode virar bloqueio infinito nem negativo
  assert.equal(duracaoDoBloqueioMinutos(undefined), BLOQUEIO_MINUTOS);
  assert.equal(duracaoDoBloqueioMinutos(-3), BLOQUEIO_MINUTOS);
});

test('tentativa e contada ANTES de conferir: cada reserva ve a anterior', () => {
  let estado = { tentativasFalhas: 0, bloqueiosSeguidos: 0, bloqueadoAteMs: 0 };
  const permitidas = [];
  // 20 tentativas seguidas (como 20 pedidos simultaneos serializados pela
  // transacao): so' as MAX_TENTATIVAS primeiras podem conferir a senha.
  for (let i = 0; i < 20; i += 1) {
    const r = reservarTentativa(estado, AGORA);
    if (!r.permitida) continue;
    permitidas.push(r.tentativa);
    estado = r.seErrar;
  }
  assert.equal(permitidas.length, MAX_TENTATIVAS);
  assert.deepEqual(permitidas, [1, 2, 3, 4, 5]);
  assert.equal(estado.bloqueiosSeguidos, 1);
  assert.equal(estado.bloqueadoAteMs, AGORA + BLOQUEIO_MINUTOS * 60 * 1000);
});

test('bloqueado: recusa sem conferir e diz quanto falta', () => {
  const r = reservarTentativa({ tentativasFalhas: 0, bloqueadoAteMs: AGORA + 90 * 1000 }, AGORA);
  assert.equal(r.permitida, false);
  assert.equal(r.faltamMinutos, 2);
});

test('depois que o bloqueio vence, o proximo bloqueio seguido dura o dobro', () => {
  const vencido = { tentativasFalhas: 0, bloqueiosSeguidos: 1, bloqueadoAteMs: AGORA - 1 };
  let estado = vencido;
  let ultima;
  for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
    ultima = reservarTentativa(estado, AGORA);
    assert.equal(ultima.permitida, true);
    estado = ultima.seErrar;
  }
  assert.equal(ultima.bloqueiaSeErrar, true);
  assert.equal(ultima.minutosDeBloqueio, BLOQUEIO_MINUTOS * 2);
  assert.equal(estado.bloqueiosSeguidos, 2);
});

test('mensagem de duracao em portugues', () => {
  assert.equal(formatarDuracao(1), '1 minuto');
  assert.equal(formatarDuracao(5), '5 minutos');
  assert.equal(formatarDuracao(60), '1 hora');
  assert.equal(formatarDuracao(160), '2h40min');
  assert.equal(formatarDuracao(1440), '24 horas');
});
