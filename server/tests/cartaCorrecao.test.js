const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CARTAS_POR_NOTA,
  normalizarTexto,
  validarCarta,
  motivoQueImpedeCarta,
} = require('../services/cartaCorrecao');

test('normaliza: tira quebra de linha, espaco repetido e espaco nas pontas', () => {
  assert.equal(normalizarTexto('  Correcao   do\nnumero\t da   casa  '), 'Correcao do numero da casa');
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto(undefined), '');
});

test('texto curto demais e recusado, dizendo quantos caracteres tem', () => {
  const r = validarCarta('Curto');
  assert.equal(r.ok, false);
  assert.match(r.erro, /pelo menos 15/);
  assert.match(r.erro, /tem 5/);
});

test('o tamanho e medido DEPOIS de normalizar (espacos nao contam)', () => {
  assert.equal(validarCarta('a                    b').ok, false); // 3 caracteres de verdade
  assert.equal(validarCarta('  ' + 'x'.repeat(15) + '  ').ok, true);
});

test('15 caracteres passa, 14 nao', () => {
  assert.equal(validarCarta('x'.repeat(14)).ok, false);
  assert.equal(validarCarta('x'.repeat(15)).ok, true);
});

test('1000 caracteres passa, 1001 nao', () => {
  assert.equal(validarCarta('x'.repeat(1000)).ok, true);
  const r = validarCarta('x'.repeat(1001));
  assert.equal(r.ok, false);
  assert.match(r.erro, /no máximo 1000/);
});

test('devolve o texto ja normalizado', () => {
  const r = validarCarta('Onde consta rua A leia rua B,\n  numero 10.');
  assert.equal(r.ok, true);
  assert.equal(r.texto, 'Onde consta rua A leia rua B, numero 10.');
});

test('so NF-e recebe carta: NFC-e e NFS-e sao barradas com orientacao', () => {
  assert.match(motivoQueImpedeCarta({ tipo: 'NFC-e', status: 'authorized' }), /só para NF-e/);
  assert.match(motivoQueImpedeCarta({ tipo: 'NFS-e', status: 'authorized' }), /só para NF-e/);
});

test('so nota autorizada recebe carta', () => {
  for (const status of ['rejected', 'denied', 'canceled', 'processing', 'enqueued']) {
    assert.match(motivoQueImpedeCarta({ tipo: 'NF-e', status }), /autorizada/, status);
  }
  assert.equal(motivoQueImpedeCarta({ tipo: 'NF-e', status: 'authorized' }), null);
});

test('limite de 20 cartas por nota', () => {
  const cartas = (n) => Array.from({ length: n }, (_, i) => ({ eventId: `e${i}` }));
  assert.equal(motivoQueImpedeCarta({ tipo: 'NF-e', status: 'authorized', cartasCorrecao: cartas(MAX_CARTAS_POR_NOTA - 1) }), null);
  assert.match(motivoQueImpedeCarta({ tipo: 'NF-e', status: 'authorized', cartasCorrecao: cartas(MAX_CARTAS_POR_NOTA) }), /limite da SEFAZ/);
});

test('nota inexistente tem mensagem propria', () => {
  assert.match(motivoQueImpedeCarta(null), /não encontrada/);
});
