import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, montarZip, nomeDeArquivoSeguro, nomesSemRepetir } from '../src/utils/zipDomain';

/** Le o zip de volta pelo diretorio central (como os programas de unzip fazem). */
const lerZip = (zip: Uint8Array) => {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const fim = zip.length - 22;
  assert.equal(v.getUint32(fim, true), 0x06054b50, 'registro final');
  const quantos = v.getUint16(fim + 10, true);
  let pos = v.getUint32(fim + 16, true);
  const arquivos: Array<{ nome: string; texto: string; crcOk: boolean }> = [];
  for (let i = 0; i < quantos; i += 1) {
    assert.equal(v.getUint32(pos, true), 0x02014b50, 'entrada do diretorio central');
    const crc = v.getUint32(pos + 16, true);
    const tamanho = v.getUint32(pos + 24, true);
    const tamNome = v.getUint16(pos + 28, true);
    const local = v.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(zip.slice(pos + 46, pos + 46 + tamNome));
    assert.equal(v.getUint32(local, true), 0x04034b50, 'cabecalho local');
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const dados = zip.slice(inicio, inicio + tamanho);
    arquivos.push({ nome, texto: new TextDecoder().decode(dados), crcOk: crc32(dados) === crc });
    pos += 46 + tamNome;
  }
  return arquivos;
};

test('CRC-32 bate com o valor conhecido', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('zip: arquivos voltam iguais, com nome em UTF-8 e CRC certo', () => {
  const enc = new TextEncoder();
  const zip = montarZip([
    { nome: 'emitidas/NF-e 123.xml', dados: enc.encode('<nfe>ção</nfe>') },
    { nome: 'recebidas/Fornecedor Ação 9.xml', dados: enc.encode('<nfe>outra</nfe>') },
    { nome: 'emitidas/NF-e 123.xml', dados: enc.encode('<nfe>repetida</nfe>') },
  ], new Date(2026, 9, 20, 10, 30, 0));
  const lidos = lerZip(zip);
  assert.deepEqual(lidos.map((a) => a.nome), ['emitidas/NF-e 123.xml', 'recebidas/Fornecedor Ação 9.xml', 'emitidas/NF-e 123 (2).xml']);
  assert.deepEqual(lidos.map((a) => a.texto), ['<nfe>ção</nfe>', '<nfe>outra</nfe>', '<nfe>repetida</nfe>']);
  assert.ok(lidos.every((a) => a.crcOk));
});

test('zip vazio ainda e um zip valido', () => {
  assert.deepEqual(lerZip(montarZip([])), []);
});

test('nomes: sem repetir e sem caracteres que o Windows recusa', () => {
  assert.deepEqual(nomesSemRepetir(['a.xml', 'A.xml', 'b', 'b']), ['a.xml', 'A (2).xml', 'b', 'b (2)']);
  assert.equal(nomeDeArquivoSeguro('NF 12: "X/Y"?  *'), 'NF 12 XY');
});
