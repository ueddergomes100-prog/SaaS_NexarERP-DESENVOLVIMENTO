const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Compras (22/10/2026): cotacao com link por fornecedor (token + codigo),
 * resposta pelo link, comparativo -> pedidos de compra, pedido a mao e status.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/compras')[3];

const USER = { uid: 'u1', email: 'u1@loja', tenantId: 'loja', permissoes: ['compras.cotacoes', 'compras.pedidos'] };
const HOJE = '2026-10-22';

const base = () => ({ 'configuracoes/loja': { tenantId: 'loja', nomeOficina: 'LOJA DEMO' } });

const PEDIDO = {
  titulo: 'Reposição',
  itens: [
    { produtoId: 'p1', codigo: '10', nome: 'ÓLEO 1L', unidade: 'UN', quantidade: 100 },
    { produtoId: 'p2', codigo: '11', nome: 'FILTRO', unidade: 'UN', quantidade: 20 },
  ],
  fornecedores: [{ fornecedorId: 'f1', nome: 'ACME', email: 'a@acme', celular: '27 9' }, { fornecedorId: 'f2', nome: 'BETA' }],
  responderAte: '2026-10-29',
  observacao: 'Entrega na loja',
};

test('criar cotacao: numero sequencial, um link e um codigo por fornecedor', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const r1 = await s.criarCotacao({ user: USER, tenantId: 'loja', corpo: PEDIDO });
  const r2 = await s.criarCotacao({ user: USER, tenantId: 'loja', corpo: PEDIDO });
  assert.equal(r1.numero, 1);
  assert.equal(r2.numero, 2);
  const d = fake.ler(`cotacoes_compra/${r1.id}`);
  assert.equal(d.status, 'aberta');
  assert.equal(d.fornecedores.length, 2);
  assert.match(d.fornecedores[0].token, /^[A-Za-z0-9_-]{20,}$/);
  assert.match(d.fornecedores[0].codigoAcesso, /^\d{6}$/);
  assert.notEqual(d.fornecedores[0].token, d.fornecedores[1].token);
  assert.deepEqual(d.tokens, d.fornecedores.map((f) => f.token));
  await assert.rejects(() => s.criarCotacao({ user: USER, tenantId: 'loja', corpo: { ...PEDIDO, itens: [] } }), (e) => e.status === 400);
});

test('link publico: abre com token + codigo, responde, e o comparativo gera os pedidos', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const { id } = await s.criarCotacao({ user: USER, tenantId: 'loja', corpo: PEDIDO });
  const [acme, beta] = fake.ler(`cotacoes_compra/${id}`).fornecedores;

  await assert.rejects(() => s.abrirPublica({ token: acme.token, codigo: '000000', hoje: HOJE }), (e) => e.status === 403 || acme.codigoAcesso === '000000');
  await assert.rejects(() => s.abrirPublica({ token: 'nao-existe-token-xxxxxxxx', codigo: acme.codigoAcesso, hoje: HOJE }), (e) => e.status === 404);
  const aberta = await s.abrirPublica({ token: acme.token, codigo: acme.codigoAcesso, hoje: HOJE });
  assert.equal(aberta.empresa, 'LOJA DEMO');
  assert.equal(aberta.fornecedorNome, 'ACME');
  assert.equal(aberta.itens.length, 2);
  assert.equal(aberta.bloqueio, null);
  assert.equal(aberta.respostaAnterior, null);

  await s.responderPublica({ token: acme.token, codigo: acme.codigoAcesso, corpo: { precos: { p1: 1000, p2: 5000 }, prazoEntregaDias: 5, condicaoPagamento: '28 dias' }, hoje: HOJE });
  await s.responderPublica({ token: beta.token, codigo: beta.codigoAcesso, corpo: { precos: { p1: 900 }, prazoEntregaDias: 2 }, hoje: HOJE });
  const depois = fake.ler(`cotacoes_compra/${id}`);
  assert.equal(depois.fornecedores[0].status, 'respondida');
  assert.deepEqual(depois.fornecedores[0].precos, { p1: 1000, p2: 5000 });
  assert.equal((await s.abrirPublica({ token: acme.token, codigo: acme.codigoAcesso, hoje: HOJE })).respostaAnterior.prazoEntregaDias, 5);
  // Fora do prazo nao responde mais.
  await assert.rejects(() => s.responderPublica({ token: acme.token, codigo: acme.codigoAcesso, corpo: { precos: { p1: 1 } }, hoje: '2026-11-01' }), (e) => e.status === 409 && /prazo/.test(e.message));
  // Com resposta, os itens nao mudam mais.
  await assert.rejects(() => s.editarCotacao({ user: USER, tenantId: 'loja', id, corpo: { ...PEDIDO, itens: [PEDIDO.itens[0]] } }), (e) => e.status === 409);
  await s.editarCotacao({ user: USER, tenantId: 'loja', id, corpo: { ...PEDIDO, titulo: 'Reposição outubro' } });
  assert.equal(fake.ler(`cotacoes_compra/${id}`).fornecedores[0].token, acme.token, 'fornecedor que ja estava mantem o link');

  const gerados = await s.gerarPedidosDaCotacao({ user: USER, tenantId: 'loja', id, corpo: { escolhas: { p1: 'f2', p2: 'f1' } } });
  assert.equal(gerados.pedidos.length, 2);
  assert.deepEqual(gerados.pedidos.map((p) => p.numero), [1, 2]);
  const cot = fake.ler(`cotacoes_compra/${id}`);
  assert.equal(cot.status, 'fechada');
  assert.equal(cot.pedidosGerados.length, 2);
  const pedidoBeta = fake.ler(`pedidos_compra/${gerados.pedidos.find((p) => p.fornecedorId === 'f2').pedidoId}`);
  assert.equal(pedidoBeta.totalCentavos, 90000);
  assert.equal(pedidoBeta.cotacaoNumero, cot.numero);
  assert.equal(pedidoBeta.status, 'aberto');
  await assert.rejects(() => s.gerarPedidosDaCotacao({ user: USER, tenantId: 'loja', id, corpo: { escolhas: { p1: 'f2' } } }), (e) => e.status === 409);
});

test('pedido de compra a mao: cria, altera so aberto, status enviado -> recebido; cancelar', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  const corpo = { fornecedorId: 'f1', fornecedorNome: 'ACME', itens: [{ produtoId: 'p1', codigo: '10', nome: 'ÓLEO 1L', unidade: 'UN', quantidade: 10, precoUnitarioCentavos: 1000 }], prazoEntregaDias: 3, condicaoPagamento: 'à vista' };
  const r = await s.criarPedido({ user: USER, tenantId: 'loja', corpo });
  assert.equal(r.numero, 1);
  assert.equal(r.totalCentavos, 10000);
  await s.editarPedido({ user: USER, tenantId: 'loja', id: r.id, corpo: { ...corpo, itens: [{ ...corpo.itens[0], quantidade: 20 }] } });
  assert.equal(fake.ler(`pedidos_compra/${r.id}`).totalCentavos, 20000);
  await assert.rejects(() => s.mudarStatusPedido({ user: USER, tenantId: 'loja', id: r.id, status: 'recebido' }), (e) => e.status === 409);
  await s.mudarStatusPedido({ user: USER, tenantId: 'loja', id: r.id, status: 'enviado' });
  assert.ok(fake.ler(`pedidos_compra/${r.id}`).enviadoEmIso);
  await assert.rejects(() => s.editarPedido({ user: USER, tenantId: 'loja', id: r.id, corpo }), (e) => e.status === 409);
  await s.mudarStatusPedido({ user: USER, tenantId: 'loja', id: r.id, status: 'recebido' });
  assert.equal(fake.ler(`pedidos_compra/${r.id}`).status, 'recebido');
  await assert.rejects(() => s.mudarStatusPedido({ user: USER, tenantId: 'loja', id: r.id, status: 'cancelado' }), (e) => e.status === 409);
  const r2 = await s.criarPedido({ user: USER, tenantId: 'loja', corpo });
  assert.equal(r2.numero, 2);
  await s.mudarStatusPedido({ user: USER, tenantId: 'loja', id: r2.id, status: 'cancelado' });
  assert.equal(fake.ler(`pedidos_compra/${r2.id}`).status, 'cancelado');
});
