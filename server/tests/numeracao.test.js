const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/numeracao').pop();
const GESTOR = { uid: 'dono', tenantId: 'emp1', isTenantManager: true, email: 'dono@teste' };
const FUNCIONARIO = { uid: 'f1', tenantId: 'emp1', isTenantManager: false, permissoes: ['administrativo.config'] };

const base = () => ({
  'contadores/emp1': { tenantId: 'emp1', pedidos_venda: 67, ordens_de_servico: 9 },
  'contadores/emp1/sequencias/pedidos_venda': { tenantId: 'emp1', chave: 'pedidos_venda', valor: 79 },
  'contadores/emp1/sequencias/orcamentos': { tenantId: 'emp1', chave: 'orcamentos', valor: 4 },
});

test('listar: ultimo = maior entre sequencia e legado; sequencia sem documento = 0; so\' gestor', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.listarNumeracao({ user: GESTOR });
  const porChave = Object.fromEntries(r.sequencias.map((x) => [x.chave, x]));
  assert.deepEqual([porChave.pedidos_venda.ultimo, porChave.pedidos_venda.proximo], [79, 80]);
  assert.deepEqual([porChave.ordens_de_servico.ultimo, porChave.ordens_de_servico.proximo], [9, 10], 'so\' o legado');
  assert.deepEqual([porChave.trocas.ultimo, porChave.trocas.proximo], [0, 1]);
  assert.equal(r.sequencias.some((x) => /boleto/.test(x.chave)), false);
  await assert.rejects(() => s.listarNumeracao({ user: FUNCIONARIO }), /Só o dono ou um administrador/);
});

test('ajustar: adianta e registra quem foi; voltar ou repetir e\' recusado em portugues', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.ajustarNumeracao({ user: GESTOR, chave: 'pedidos_venda', proximo: '75.713', nomeUsuario: 'DONO' });
  assert.deepEqual([r.antes, r.agora, r.proximo], [79, 75712, 75713]);
  const seq = fake.ler('contadores/emp1/sequencias/pedidos_venda');
  assert.equal(seq.valor, 75712);
  assert.equal(seq.ajustadoPorNome, 'DONO');
  assert.equal(seq.ajustadoDe, 79);
  await assert.rejects(() => s.ajustarNumeracao({ user: GESTOR, chave: 'pedidos_venda', proximo: '100', nomeUsuario: 'DONO' }), /nunca volta/);
  await assert.rejects(() => s.ajustarNumeracao({ user: GESTOR, chave: 'ordens_de_servico', proximo: '9', nomeUsuario: 'DONO' }), /precisa ser 10 ou maior/);
  await assert.rejects(() => s.ajustarNumeracao({ user: GESTOR, chave: 'boleto_remessa_x', proximo: '1', nomeUsuario: 'DONO' }), /Documento desconhecido/);
  await assert.rejects(() => s.ajustarNumeracao({ user: FUNCIONARIO, chave: 'pedidos_venda', proximo: '90000', nomeUsuario: 'F' }), /Só o dono ou um administrador/);
  // Sequencia que ainda nao tinha documento: nasce com o ajuste.
  const t = await s.ajustarNumeracao({ user: GESTOR, chave: 'trocas', proximo: '500', nomeUsuario: 'DONO' });
  assert.equal(t.proximo, 500);
  assert.equal(fake.ler('contadores/emp1/sequencias/trocas').valor, 499);
});
