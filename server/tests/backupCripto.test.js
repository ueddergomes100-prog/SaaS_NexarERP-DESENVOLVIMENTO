const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
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

// O backup cifra sempre o JSON compactado (backup.js): o formato antigo tambem.
const COMPACTADO = zlib.gzipSync(CONTEUDO);

test('backup no formato antigo (CBC) continua legivel', () => {
  const legado = cifrarLegadoParaTeste(COMPACTADO, SEGREDO);
  assert.ok(!ehFormatoNovo(legado));
  assert.ok(decifrar(legado, SEGREDO).equals(COMPACTADO));
});

test('formato antigo com chave errada nao devolve lixo como se fosse dado', () => {
  // Sem autenticacao, ~1 em 256 chaves erradas passa no padding do CBC. Antes
  // de 16/10/2026 isso devolvia lixo e este teste falhava de vez em quando;
  // 300 tentativas pegariam o defeito em ~70% das execucoes.
  for (let i = 0; i < 300; i += 1) {
    const legado = cifrarLegadoParaTeste(COMPACTADO, SEGREDO);
    assert.throws(() => decifrar(legado, `outra-chave-${i}`), /chave de criptografia/);
  }
});

test('arquivo truncado', () => {
  assert.throws(() => decifrar(Buffer.alloc(5), SEGREDO), /vazio ou truncado/);
});
