const test = require('node:test');
const assert = require('node:assert/strict');
const { cifrar, decifrar, ehFormatoNovo, cifrarLegadoParaTeste, MAGICO } = require('../services/backupCripto');

const SEGREDO = 'segredo-de-teste-bem-longo-2026';
const CONTEUDO = Buffer.from(JSON.stringify({ metadata: { companyId: 'abc' }, data: { pedidos_venda: [{ id: 1 }] } }));

test('formato novo (GCM): cifra e decifra de volta ao mesmo conteudo', () => {
  const cifrado = cifrar(CONTEUDO, SEGREDO);
  assert.ok(ehFormatoNovo(cifrado));
  assert.ok(cifrado.subarray(0, MAGICO.length).equals(MAGICO));
  assert.ok(!cifrado.includes(CONTEUDO), 'conteudo nao pode aparecer em claro');
  assert.ok(decifrar(cifrado, SEGREDO).equals(CONTEUDO));
});

test('dois backups do mesmo conteudo nunca dao o mesmo arquivo (IV aleatorio)', () => {
  assert.ok(!cifrar(CONTEUDO, SEGREDO).equals(cifrar(CONTEUDO, SEGREDO)));
});

test('arquivo alterado e recusado com mensagem em portugues', () => {
  const cifrado = cifrar(CONTEUDO, SEGREDO);
  const alterado = Buffer.from(cifrado);
  alterado[alterado.length - 1] ^= 0x01;
  assert.throws(() => decifrar(alterado, SEGREDO), /alterado ou a chave de criptografia/);
});

test('chave errada e recusada', () => {
  const cifrado = cifrar(CONTEUDO, SEGREDO);
  assert.throws(() => decifrar(cifrado, 'outra-chave'), /alterado ou a chave de criptografia/);
});

test('backup no formato antigo (CBC) continua legivel', () => {
  const legado = cifrarLegadoParaTeste(CONTEUDO, SEGREDO);
  assert.ok(!ehFormatoNovo(legado));
  assert.ok(decifrar(legado, SEGREDO).equals(CONTEUDO));
});

test('formato antigo com chave errada nao devolve lixo como se fosse dado', () => {
  const legado = cifrarLegadoParaTeste(CONTEUDO, SEGREDO);
  assert.throws(() => decifrar(legado, 'outra-chave'), /chave de criptografia/);
});

test('arquivo truncado', () => {
  assert.throws(() => decifrar(Buffer.alloc(5), SEGREDO), /vazio ou truncado/);
});
