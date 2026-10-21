const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Rota na pre-venda (21/10/2026): a pre-venda entra na rota em montagem (ou
 * fica anotada e entra ao faturar), com a trava por pedido; rota liberada
 * nao recebe mais; sem rota em montagem fica sem rota.
 */

const carregar = (db) => {
  const [, , , servico] = carregarComBancoFalso(db, 'services/rotaPreVenda');
  return servico;
};

const VENDEDOR = { uid: 'ven', tenantId: 'loja', email: 'v@loja', permissoes: ['vendas.pre_venda_criar'] };
const SEM_PERMISSAO = { uid: 'x', tenantId: 'loja', email: 'x@loja', permissoes: [] };

const base = (modo, extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', rotaNaPreVenda: modo },
  'clientes/c1': { tenantId: 'loja', codigo: '12', nome: 'JOÃO', endereco: 'RUA A', numero: '10', bairro: 'CENTRO', cidade: 'VITÓRIA', estado: 'ES', celular: '27999' },
  'pedidos_venda/p1': { tenantId: 'loja', numeroPedido: '0231', status: 'Pré-venda', dataVenda: '2026-10-21', clienteId: 'c1', clienteNome: 'JOÃO', vendedorNome: 'ANA', valorTotalCentavos: 10000 },
  'romaneios/r1': { tenantId: 'loja', numero: 1, nome: 'DANIELA', status: 'montagem', entregas: [], pedidoIds: [] },
  'romaneios/r2': { tenantId: 'loja', numero: 2, nome: 'MARCOS', status: 'montagem', entregas: [], pedidoIds: [] },
  ...extra,
});

const colocar = (s, extra = {}) => s.colocarPedidoNaRota({ user: VENDEDOR, tenantId: 'loja', pedidoId: 'p1', ...extra });

test('configuracao desligada: nao faz nada', async () => {
  const fake = criarBancoFalso(base('nao'), { consultas: true });
  assert.deepEqual(await colocar(carregar(fake.db), { romaneioId: 'r2' }), { acao: 'desligado' });
  assert.equal(fake.ler('romaneio_pedidos/p1'), undefined);
});

test('na pre-venda: entra na rota escolhida, com trava, retrato e anotacao no pedido', async () => {
  const fake = criarBancoFalso(base('na_pre_venda'), { consultas: true });
  const s = carregar(fake.db);
  const r = await colocar(s, { romaneioId: 'r2' });
  assert.deepEqual(r, { acao: 'colocado', rota: { id: 'r2', titulo: 'Rota 02 MARCOS' } });
  const rota = fake.ler('romaneios/r2');
  assert.deepEqual(rota.pedidoIds, ['p1']);
  assert.equal(rota.entregas[0].clienteNome, 'JOÃO');
  assert.equal(rota.entregas[0].endereco, 'RUA A, 10 - CENTRO');
  assert.equal(rota.entregas[0].valorTotalCentavos, 10000);
  assert.equal(fake.ler('romaneio_pedidos/p1').situacao, 'em_romaneio');
  assert.equal(fake.ler('romaneio_pedidos/p1').romaneioTitulo, 'Rota 02 MARCOS');
  assert.deepEqual(fake.ler('pedidos_venda/p1').romaneioDestino, { id: 'r2', titulo: 'Rota 02 MARCOS' });
  // Repetir (reenvio do app) nao duplica.
  assert.equal((await colocar(s, { romaneioId: 'r2' })).acao, 'ja_estava');
  assert.equal(fake.ler('romaneios/r2').entregas.length, 1);
});

test('rota escolhida ja liberada: cai na unica que sobrou; sem nenhuma, fica sem rota; duas sem escolha tambem', async () => {
  const fake = criarBancoFalso(base('na_pre_venda', { 'romaneios/r1': { tenantId: 'loja', numero: 1, nome: 'DANIELA', status: 'em_rota', entregas: [], pedidoIds: [] } }), { consultas: true });
  const r = await colocar(carregar(fake.db), { romaneioId: 'r1' });
  assert.equal(r.acao, 'colocado');
  assert.equal(r.rota.id, 'r2');

  const semRota = criarBancoFalso(base('na_pre_venda', { 'romaneios/r1': { tenantId: 'loja', status: 'fechado' }, 'romaneios/r2': { tenantId: 'loja', status: 'cancelado' } }), { consultas: true });
  assert.deepEqual(await colocar(carregar(semRota.db)), { acao: 'sem_rota' });
  assert.equal(semRota.ler('romaneio_pedidos/p1'), undefined);

  const duas = criarBancoFalso(base('na_pre_venda'), { consultas: true });
  assert.deepEqual(await colocar(carregar(duas.db)), { acao: 'sem_rota' });
});

test('ao faturar: a pre-venda so fica anotada; faturada, entra na rota anotada', async () => {
  const fake = criarBancoFalso(base('ao_faturar'), { consultas: true });
  const s = carregar(fake.db);
  assert.deepEqual(await colocar(s, { romaneioId: 'r1' }), { acao: 'anotada', rota: { id: 'r1', titulo: 'Rota 01 DANIELA' } });
  assert.equal(fake.ler('romaneio_pedidos/p1'), undefined);
  assert.deepEqual(fake.ler('pedidos_venda/p1').romaneioDestino, { id: 'r1', titulo: 'Rota 01 DANIELA' });

  // Faturou (valor mudou com o frete) e o fechamento chama sem escolher rota.
  fake.db.collection('pedidos_venda').doc('p1').set({ status: 'Finalizada', valorTotalCentavos: 11000, formaPagamento: 'Pix' }, { merge: true });
  const r = await s.colocarAoFaturarSemFalhar({ user: VENDEDOR, tenantId: 'loja', pedidoId: 'p1' });
  assert.equal(r.acao, 'colocado');
  assert.equal(r.rota.id, 'r1');
  assert.equal(fake.ler('romaneios/r1').entregas[0].valorTotalCentavos, 11000);
  assert.equal(fake.ler('romaneio_pedidos/p1').situacao, 'em_romaneio');
});

test('pre-venda que ja estava na rota e foi faturada: o retrato na rota acompanha', async () => {
  const fake = criarBancoFalso(base('na_pre_venda'), { consultas: true });
  const s = carregar(fake.db);
  await colocar(s, { romaneioId: 'r1' });
  fake.db.collection('pedidos_venda').doc('p1').set({ status: 'Finalizada', valorTotalCentavos: 9500, formaPagamento: 'Dinheiro' }, { merge: true });
  const r = await s.colocarAoFaturarSemFalhar({ user: VENDEDOR, tenantId: 'loja', pedidoId: 'p1' });
  assert.equal(r.acao, 'ja_estava');
  const entrega = fake.ler('romaneios/r1').entregas[0];
  assert.equal(entrega.valorTotalCentavos, 9500);
  assert.equal(entrega.formaPagamento, 'Dinheiro');
  assert.equal(entrega.status, 'pendente');
});

test('sem permissao, pedido de outra empresa e pedido cancelado', async () => {
  const fake = criarBancoFalso(base('na_pre_venda', {
    'pedidos_venda/fora': { tenantId: 'outra', numeroPedido: '9', status: 'Pré-venda' },
    'pedidos_venda/canc': { tenantId: 'loja', numeroPedido: '0240', status: 'Cancelada' },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.colocarPedidoNaRota({ user: SEM_PERMISSAO, tenantId: 'loja', pedidoId: 'p1' }), (e) => e.status === 403);
  await assert.rejects(() => colocar(s, { pedidoId: 'fora' }), (e) => e.status === 404);
  await assert.rejects(() => colocar(s, { pedidoId: 'canc', romaneioId: 'r1' }), (e) => e.status === 409 && /cancelado/.test(e.message));
  assert.deepEqual((await s.rotasAbertas('loja')).map((r) => r.titulo), ['Rota 01 DANIELA', 'Rota 02 MARCOS']);
});
