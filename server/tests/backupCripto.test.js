const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { cifrar, decifrar, ehFormatoNovo, cifrarLegadoParaTeste, MAGICO } = require('../services/backupCripto');

const SEGREDO = 'segredo-de-teste-bem-longo-2026';
const CONTEUDO = Buffer.from(JSON.stringify({ metadata: { companyId: 'abc' }, data: { pedidos_venda: [{ id: 1 }] } }));
// O formato antigo sempre cifrou o backup ja' compactado (backup.js: JSON -> gzip -> cifra).
const CONTEUDO_GZIP = zlib.gzipSync(CONTEUDO);

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
  const legado = cifrarLegadoParaTeste(CONTEUDO_GZIP, SEGREDO);
  assert.ok(!ehFormatoNovo(legado));
  const claro = decifrar(legado, SEGREDO);
  assert.ok(claro.equals(CONTEUDO_GZIP));
  assert.ok(zlib.gunzipSync(claro).equals(CONTEUDO));
});

test('formato antigo com chave errada nao devolve lixo como se fosse dado', () => {
  const legado = cifrarLegadoParaTeste(CONTEUDO_GZIP, SEGREDO);
  assert.throws(() => decifrar(legado, 'outra-chave'), /chave de criptografia/);
});

test('formato antigo com chave errada que passa no padding por acaso tambem e recusado', () => {
  // Sem autenticacao, a chave errada acerta o padding ~1 vez em 256 (era o que fazia o teste acima falhar as vezes).
  // Procura um arquivo assim de proposito, com a derivacao antiga (SHA-256 do segredo), e confere que e' recusado.
  const chaveErrada = crypto.createHash('sha256').update('outra-chave').digest();
  const passaNoPadding = (legado) => {
    const decipher = crypto.createDecipheriv('aes-256-cbc', chaveErrada, legado.subarray(0, 16));
    try {
      Buffer.concat([decipher.update(legado.subarray(16)), decipher.final()]);
      return true;
    } catch {
      return false;
    }
  };
  let legado;
  for (let i = 0; i < 20000 && !legado; i++) {
    const candidato = cifrarLegadoParaTeste(CONTEUDO_GZIP, SEGREDO);
    if (passaNoPadding(candidato)) legado = candidato;
  }
  assert.ok(legado, 'nao achei um arquivo em que a chave errada passa no padding');
  assert.throws(() => decifrar(legado, 'outra-chave'), /chave de criptografia não é a mesma/);
});

test('arquivo truncado', () => {
  assert.throws(() => decifrar(Buffer.alloc(5), SEGREDO), /vazio ou truncado/);
});
