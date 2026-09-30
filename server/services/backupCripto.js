/**
 * Criptografia dos arquivos de backup.
 *
 * Formato NOVO (2026-09-30): AES-256-GCM. Alem de cifrar, o GCM autentica o
 * conteudo -- um arquivo alterado ou corrompido e' recusado na hora de
 * decifrar, em vez de virar lixo que so' o gunzip/JSON.parse pegaria depois.
 *
 *   "HENB2" (5 bytes) | iv (12) | tag (16) | ciphertext
 *
 * Formato ANTIGO: AES-256-CBC, iv (16) | ciphertext, sem autenticacao.
 * Continua sendo DECIFRADO (backups ja' gerados), nunca mais gerado.
 *
 * A chave e' derivada do segredo (BACKUP_ENCRYPTION_KEY) com scrypt e um sal
 * fixo -- o segredo e' longo e aleatorio por regra, scrypt so' torna a forca
 * bruta mais cara caso alguem cadastre uma frase curta. O formato antigo
 * usava SHA-256 puro; a derivacao antiga fica guardada so' pra ler esses
 * arquivos.
 */
const crypto = require('crypto');

const MAGICO = Buffer.from('HENB2', 'ascii');
const IV_GCM = 12;
const TAG_GCM = 16;
const IV_CBC = 16;
const SAL_SCRYPT = 'hennder-erp-backup-v2';

const derivarChaveV2 = (segredo) => crypto.scryptSync(String(segredo), SAL_SCRYPT, 32, { N: 16384, r: 8, p: 1 });
const derivarChaveLegado = (segredo) => crypto.createHash('sha256').update(String(segredo)).digest();

const cifrar = (buffer, segredo) => {
  const iv = crypto.randomBytes(IV_GCM);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivarChaveV2(segredo), iv);
  const conteudo = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([MAGICO, iv, cipher.getAuthTag(), conteudo]);
};

const ehFormatoNovo = (buffer) => buffer.length > MAGICO.length + IV_GCM + TAG_GCM
  && buffer.subarray(0, MAGICO.length).equals(MAGICO);

const decifrar = (buffer, segredo) => {
  if (ehFormatoNovo(buffer)) {
    const iv = buffer.subarray(MAGICO.length, MAGICO.length + IV_GCM);
    const tag = buffer.subarray(MAGICO.length + IV_GCM, MAGICO.length + IV_GCM + TAG_GCM);
    const conteudo = buffer.subarray(MAGICO.length + IV_GCM + TAG_GCM);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivarChaveV2(segredo), iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(conteudo), decipher.final()]);
    } catch {
      throw new Error('O arquivo de backup foi alterado ou a chave de criptografia não é a mesma que o gerou.');
    }
  }

  // Formato antigo (CBC): sem autenticacao -- chave errada costuma estourar
  // no padding, mas nem sempre; o checksum do conteudo (restore.js) cobre o resto.
  if (buffer.length <= IV_CBC) {
    throw new Error('Arquivo de backup vazio ou truncado.');
  }
  const iv = buffer.subarray(0, IV_CBC);
  const conteudo = buffer.subarray(IV_CBC);
  const decipher = crypto.createDecipheriv('aes-256-cbc', derivarChaveLegado(segredo), iv);
  try {
    return Buffer.concat([decipher.update(conteudo), decipher.final()]);
  } catch {
    throw new Error('Não foi possível decifrar o backup: a chave de criptografia não é a mesma que o gerou.');
  }
};

/** Cifra no formato ANTIGO -- so' pra teste garantir que ele continua legivel. */
const cifrarLegadoParaTeste = (buffer, segredo) => {
  const iv = crypto.randomBytes(IV_CBC);
  const cipher = crypto.createCipheriv('aes-256-cbc', derivarChaveLegado(segredo), iv);
  return Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
};

module.exports = { cifrar, decifrar, ehFormatoNovo, cifrarLegadoParaTeste, MAGICO };
