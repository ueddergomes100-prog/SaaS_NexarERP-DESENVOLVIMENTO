const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Ronda do backup automatico (12/11/2026): toda empresa e filial, ligado por
 * padrao; quem desligou no painel fica de fora; no maximo 3 por passada.
 * O backup de verdade e' trocado por um falso que so' anota quem foi chamado.
 */

const br = (iso) => Date.parse(`${iso}:00-03:00`);
const chamados = [];
let falhar = new Set();

const caminhoBackup = require.resolve(path.join(__dirname, '..', 'services/backup'));
require.cache[caminhoBackup] = {
  id: caminhoBackup, filename: caminhoBackup, loaded: true,
  exports: {
    getEncryptionKey: () => 'teste',
    generateCompanyBackup: async (companyId) => {
      chamados.push(companyId);
      if (falhar.has(companyId)) throw new Error('falha simulada');
      return { id: `b-${companyId}`, companyId, createdAt: new Date(br('2026-11-12T02:10')).toISOString(), status: 'enviado', filename: 'backup.json.gz', sizeBytes: 10, externo: { status: 'enviado' } };
    },
  },
};

const carregar = (db) => carregarComBancoFalso(db, 'services/scheduler').pop();
const assentar = () => new Promise((r) => setImmediate(r));

const base = (extra = {}) => ({
  'configuracoes/matriz': { tenantId: 'matriz', nomeOficina: 'LOJA MATRIZ', email: 'dono@loja' },
  'configuracoes/filial': { tenantId: 'filial', nomeOficina: 'LOJA', filialCodigo: '20' },
  'configuracoes/desligada': { tenantId: 'desligada', nomeOficina: 'EMPRESA QUE DESLIGOU' },
  'usuarios/matriz': { tenantId: 'matriz', role: 'Master', nomeOficina: 'LOJA MATRIZ', email: 'dono@loja' },
  // Dono sem configuracao gravada ainda: tambem e' empresa.
  'usuarios/nova': { tenantId: 'nova', role: 'Master', nomeOficina: 'EMPRESA NOVA', email: 'nova@loja' },
  'usuarios/func': { tenantId: 'matriz', role: 'Funcionario', nome: 'JOAO' },
  'backups_configuracoes/desligada': { enabled: false, frequency: 'diario', time: '02:00' },
  ...extra,
});

test('empresas do backup: matriz, FILIAL e dono sem configuracao; funcionario nao e empresa', async () => {
  const s = carregar(criarBancoFalso(base(), { consultas: true }).db);
  const empresas = await s.listarEmpresas();
  assert.deepEqual(empresas.map((e) => e.id).sort(), ['desligada', 'filial', 'matriz', 'nova']);
  assert.equal(empresas.find((e) => e.id === 'filial').nome, 'LOJA (filial 20)');
  assert.equal(empresas.find((e) => e.id === 'nova').nome, 'EMPRESA NOVA');
});

test('ronda: faz backup de quem esta devendo, pula quem desligou e quem ja tem o de hoje; nao repete na passada seguinte', async () => {
  chamados.length = 0;
  falhar = new Set();
  const fake = criarBancoFalso(base({
    'backups_historico/h1': { companyId: 'matriz', status: 'enviado', createdAt: new Date(br('2026-11-12T02:05')).toISOString(), filename: 'a.gz', sizeBytes: 5 },
    // Backup com erro nao conta como feito.
    'backups_historico/h2': { companyId: 'filial', status: 'erro', createdAt: new Date(br('2026-11-12T02:05')).toISOString() },
  }), { consultas: true });
  const s = carregar(fake.db);
  const agora = br('2026-11-12T02:10');
  assert.deepEqual((await s.ronda(agora)).sort(), ['filial', 'nova']);
  await assentar();
  assert.deepEqual(chamados.sort(), ['filial', 'nova']);
  assert.deepEqual(await s.ronda(agora + 10 * 60 * 1000), [], 'ja feito nesta rodada');
  // No dia seguinte todo mundo que esta ligado vence de novo.
  assert.deepEqual((await s.ronda(br('2026-11-13T02:10'))).sort(), ['filial', 'matriz', 'nova']);
  await assentar();
});

test('ronda: no maximo 3 por passada; o resto vai na proxima', async () => {
  chamados.length = 0;
  falhar = new Set();
  const muitas = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [`configuracoes/${id}`, { tenantId: id, nomeOficina: `EMPRESA ${id.toUpperCase()}` }]));
  const s = carregar(criarBancoFalso(muitas, { consultas: true }).db);
  const agora = br('2026-11-12T02:10');
  assert.equal((await s.ronda(agora)).length, 3);
  await assentar();
  assert.equal((await s.ronda(agora + 10 * 60 * 1000)).length, 2);
  await assentar();
  assert.deepEqual(chamados.slice().sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('ronda: backup que falha so e tentado de novo depois de 1 hora', async () => {
  chamados.length = 0;
  falhar = new Set(['a']);
  const s = carregar(criarBancoFalso({ 'configuracoes/a': { tenantId: 'a', nomeOficina: 'A' } }, { consultas: true }).db);
  const agora = br('2026-11-12T02:10');
  assert.deepEqual(await s.ronda(agora), ['a']);
  await assentar();
  assert.deepEqual(await s.ronda(agora + 10 * 60 * 1000), [], 'espera 1 hora');
  falhar = new Set();
  assert.deepEqual(await s.ronda(agora + 61 * 60 * 1000), ['a']);
  await assentar();
});

test('resumo do painel: situacao de cada empresa e contagem', async () => {
  const fake = criarBancoFalso(base({
    'backups_historico/h1': { companyId: 'matriz', status: 'enviado', createdAt: new Date(br('2026-11-12T02:05')).toISOString(), filename: 'a.gz', sizeBytes: 5, externo: { status: 'enviado' } },
    'backups_historico/h2': { companyId: 'filial', status: 'enviado', createdAt: new Date(br('2026-11-08T02:05')).toISOString(), filename: 'b.gz', sizeBytes: 5 },
  }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.resumoDosBackups(br('2026-11-12T15:00'));
  const de = (id) => r.empresas.find((e) => e.id === id);
  assert.equal(de('matriz').situacao, 'em_dia');
  assert.equal(de('matriz').ultimoBackup.externo, 'enviado');
  assert.equal(de('filial').situacao, 'atrasado');
  assert.equal(de('filial').diasSemBackup, 4);
  assert.equal(de('filial').ultimoBackup.externo, 'nao_configurado');
  assert.equal(de('nova').situacao, 'nunca');
  assert.equal(de('desligada').situacao, 'desligado');
  assert.equal(de('desligada').automatico.padrao, false);
  assert.equal(de('matriz').automatico.padrao, true);
  assert.deepEqual(r.contagem, { total: 4, emDia: 1, atrasados: 1, nunca: 1, desligados: 1 });
  assert.equal(r.externoConfigurado, false);
});
