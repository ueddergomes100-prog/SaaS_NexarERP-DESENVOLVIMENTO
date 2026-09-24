import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactarXml, descompactarXml } from '../src/utils/xmlCompactoDomain';

test('XML compacta e volta idêntico, com acento e caractere especial', async () => {
  const xml = `<?xml version="1.0"?><nfeProc>${'<det><xProd>AÇÚCAR & CIA — 1kg</xProd></det>'.repeat(200)}</nfeProc>`;
  const compacto = await compactarXml(xml);
  assert.ok(compacto);
  assert.ok(compacto.length < xml.length / 3, 'ocupa bem menos que o original');
  assert.equal(await descompactarXml(compacto), xml);
});

test('conteúdo corrompido dá erro em português', async () => {
  await assert.rejects(() => descompactarXml('isto-nao-e-gzip'), /corrompido/);
});

test('XML enorme (acima do limite) não é guardado em vez de estourar o documento', async () => {
  // Texto aleatorio nao comprime: passa do limite.
  let aleatorio = '';
  for (let i = 0; i < 900_000; i += 1) aleatorio += String.fromCharCode(33 + Math.floor(Math.random() * 90));
  assert.equal(await compactarXml(aleatorio), null);
});
