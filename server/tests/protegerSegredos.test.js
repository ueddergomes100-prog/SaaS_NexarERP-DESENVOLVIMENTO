const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, DEL } = require('./helpers/firestoreFalso');
const { protegerSegredos, separarCscDaNumeracao, segredosNoPublico } = require('../services/protegerSegredos');

/*
 * Segredos fiscais (19/10/2026): CSC da NFC-e e chave antiga da Spedy saem do
 * documento de configuracoes que todo usuario da empresa le.
 */

const apagar = () => DEL;

test('numeracao: o publico fica sem o CSC e o privado guarda', () => {
  const { publico, nfceCsc } = separarCscDaNumeracao({ productInvoice: { series: 1 }, consumerInvoice: { series: 2, csc: 'ABC', tokenId: '000001' } }, apagar);
  assert.deepEqual(nfceCsc, { csc: 'ABC', tokenId: '000001' });
  assert.equal(publico.consumerInvoice.series, 2);
  assert.equal(publico.consumerInvoice.csc, DEL);
  assert.equal(publico.productInvoice.series, 1);
  const semNfce = separarCscDaNumeracao({ productInvoice: { series: 1 } }, apagar);
  assert.equal(semNfce.nfceCsc, null);
});

test('simular so\' lista; aplicar move para o privado e apaga do comum', async () => {
  const fake = criarBancoFalso({
    'configuracoes/a': { tenantId: 'a', nomeOficina: 'LOJA A', spedyApiKey: 'chave-antiga', spedyNumeracao: { consumerInvoice: { series: 1, csc: 'CSC-A', tokenId: '01' } } },
    'configuracoes/b': { tenantId: 'b', nomeOficina: 'LOJA B', spedyNumeracao: { productInvoice: { series: 1 } } },
    'configuracoes_privadas/a': { tenantId: 'a', smtpSenha: 'x' },
  });
  const simulado = await protegerSegredos({ db: fake.db, apagar, aplicar: false });
  assert.deepEqual(simulado.empresas.map((e) => [e.tenantId, e.chaveSpedy, e.csc]), [['a', true, true]]);
  assert.equal(fake.ler('configuracoes/a').spedyApiKey, 'chave-antiga', 'simular nao grava');

  await protegerSegredos({ db: fake.db, apagar, aplicar: true });
  const publico = fake.ler('configuracoes/a');
  assert.equal('spedyApiKey' in publico, false);
  assert.equal('csc' in publico.spedyNumeracao.consumerInvoice, false);
  assert.equal(publico.spedyNumeracao.consumerInvoice.series, 1, 'o resto da numeracao fica');
  const privado = fake.ler('configuracoes_privadas/a');
  assert.equal(privado.spedyApiKey, 'chave-antiga');
  assert.deepEqual(privado.nfceCsc, { csc: 'CSC-A', tokenId: '01' });
  assert.equal(privado.smtpSenha, 'x', 'o que ja estava no privado fica');

  const deNovo = await protegerSegredos({ db: fake.db, apagar, aplicar: false });
  assert.equal(deNovo.empresas.length, 0, 'rodar de novo nao acha mais nada');
});

test('chave nova no privado nao e\' trocada pela antiga do comum', async () => {
  const fake = criarBancoFalso({
    'configuracoes/a': { tenantId: 'a', spedyApiKey: 'antiga' },
    'configuracoes_privadas/a': { tenantId: 'a', spedyApiKey: 'nova' },
  });
  await protegerSegredos({ db: fake.db, apagar, aplicar: true });
  assert.equal(fake.ler('configuracoes_privadas/a').spedyApiKey, 'nova');
  assert.equal(segredosNoPublico(fake.ler('configuracoes/a')).temChave, false);
});
