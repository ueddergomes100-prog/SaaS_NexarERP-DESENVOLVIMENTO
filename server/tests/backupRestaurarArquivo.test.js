const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');
const { cifrar } = require('../services/backupCripto');

/*
 * Restaurar a partir de um arquivo ENVIADO pelo painel (12/11/2026): o arquivo
 * e' conferido (chave, empresa, integridade) ANTES de gerar o backup de
 * emergencia e de tocar em qualquer dado.
 */

const CHAVE = 'chave-de-teste';
const emergencias = [];
const caminhoBackup = require.resolve(path.join(__dirname, '..', 'services/backup'));
require.cache[caminhoBackup] = {
  id: caminhoBackup, filename: caminhoBackup, loaded: true,
  exports: {
    getEncryptionKey: () => CHAVE,
    generateCompanyBackup: async (companyId) => { emergencias.push(companyId); return { filename: 'emergencia.json.gz' }; },
  },
};

const carregar = (db) => carregarComBancoFalso(db, 'services/restore').pop();

/** Monta um arquivo de backup como o backup.js monta: JSON -> gzip -> cifra. */
const arquivoDeBackup = (companyId, data, { chave = CHAVE, checksum } = {}) => {
  const metadata = { companyId, companyName: 'LOJA', createdAt: '2026-11-12T05:00:00.000Z', checksum: checksum || crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') };
  return cifrar(zlib.gzipSync(Buffer.from(JSON.stringify({ metadata, data }), 'utf8')), chave);
};

const DADOS = { configuracoes: { id: 'loja', nomeOficina: 'LOJA' }, usuarios: [], clientes: [{ id: 'c1', tenantId: 'loja', nome: 'CLIENTE' }] };

test('arquivo de backup valido abre: decifra, descompacta, e da empresa e o checksum confere', async () => {
  const s = carregar(criarBancoFalso({}, { consultas: true }).db);
  const aberto = await s.abrirArquivoDeBackup(arquivoDeBackup('loja', DADOS), 'loja', 'LOJA');
  assert.equal(aberto.metadata.companyId, 'loja');
  assert.deepEqual(aberto.data.clientes, DADOS.clientes);
});

test('arquivo de OUTRA empresa, alterado, de outra chave ou que nao e backup: recusa em portugues', async () => {
  const s = carregar(criarBancoFalso({}, { consultas: true }).db);
  await assert.rejects(() => s.abrirArquivoDeBackup(arquivoDeBackup('outra', DADOS), 'loja', 'LOJA'), /pertence à empresa ID \(outra/);
  await assert.rejects(() => s.abrirArquivoDeBackup(arquivoDeBackup('loja', DADOS, { checksum: 'x'.repeat(64) }), 'loja', 'LOJA'), /Erro de Integridade/);
  await assert.rejects(() => s.abrirArquivoDeBackup(arquivoDeBackup('loja', DADOS, { chave: 'outra-chave' }), 'loja', 'LOJA'), /Chave inválida ou arquivo corrompido/);
  await assert.rejects(() => s.abrirArquivoDeBackup(Buffer.from('isto nao e um backup'), 'loja', 'LOJA'), /Chave inválida ou arquivo corrompido/);
});

test('arquivo enviado errado e barrado ANTES do backup de emergencia e de qualquer gravacao', async () => {
  emergencias.length = 0;
  const fake = criarBancoFalso({ 'clientes/c9': { tenantId: 'loja', nome: 'ATUAL' } }, { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.restoreCompanyBackup('loja', 'LOJA', 'arquivo.json.gz', 'suporte@hennder', arquivoDeBackup('outra', DADOS)),
    /pertence à empresa ID \(outra/,
  );
  assert.deepEqual(emergencias, [], 'nem o backup de emergencia foi gerado');
  assert.equal(fake.ler('clientes/c9').nome, 'ATUAL', 'dados atuais intactos');
});
