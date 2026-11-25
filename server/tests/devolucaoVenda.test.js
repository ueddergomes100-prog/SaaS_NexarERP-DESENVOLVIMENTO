const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-11-24';
const T = 'emp1';
const ID_APP = '0123456789abcdef0123456789abcdef';
const VENDEDOR = { uid: 'vend1', email: 'vend1@app', nome: 'CARLOS', tenantId: T, permissoes: [] };
const carregar = (db) => carregarComBancoFalso(db, 'services/devolucaoVenda')[3];

const pedido = (extra = {}) => ({
  tenantId: T,
  numeroPedido: '0154',
  clienteId: 'c1',
  clienteNome: 'BOA SAFRA',
  status: 'Finalizada',
  dataVenda: '2026-11-20',
  criadoPor: 'vend1',
  vendedorId: 'vend1',
  vendedorNome: 'CARLOS',
  itens: [
    { id: 'p1', nome: 'RACAO 20KG', precoUnitario: 100, quantidade: 3, desconto: 30, fatorConversao: 20, unidadeMedidaSigla: 'SC' },
    { id: 'p2', nome: 'COLEIRA', precoUnitario: 30, quantidade: 2, desconto: 0, lotes: [{ loteId: 'L1', lote: 'A', validade: null, quantidade: 2 }] },
  ],
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/emp1': { appDevolucaoPermitida: true },
  [`pedidos_venda/${ID_APP}`]: pedido(),
  'pedidos_venda/zWWih8mhQhkL8y0XDnmy': pedido(),
  'estoque/p1': { tenantId: T, nome: 'RACAO', quantidade: 100 },
  'estoque/p2': { tenantId: T, nome: 'COLEIRA', quantidade: 10 },
  'estoque_lotes/L1': { tenantId: T, quantidade: 5 },
  'bancos/b1': { tenantId: T, nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  ...extra,
});

const corpo = (extra = {}) => ({
  pedidoId: ID_APP,
  itens: [{ indice: 0, quantidade: 1 }, { indice: 1, quantidade: 1 }],
  motivo: 'Produto com defeito',
  destino: 'credito',
  observacao: 'cliente devolveu na visita',
  idDocumento: 'dev00000001',
  ...extra,
});

test('pedir: nasce "Aguardando confirmação" e nada mexe em estoque, pedido ou dinheiro', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE });
  assert.equal(r.status, 'aguardando_confirmacao');
  const d = fake.ler('devolucoes_venda/dev00000001');
  assert.equal(d.status, 'aguardando_confirmacao');
  assert.equal(d.origem, 'app');
  assert.equal(d.solicitadoPorId, 'vend1');
  assert.equal(d.valorTotalDevolvido, 120); // 100 - 30/3 + 30
  assert.equal(d.itensDevolvidos[0].indice, 0);
  assert.ok(Object.values(d).every((v) => v !== undefined));
  assert.equal(fake.ler('estoque/p1').quantidade, 100);
  assert.equal(fake.ler('estoque_lotes/L1').quantidade, 5);
  assert.equal(fake.ler(`pedidos_venda/${ID_APP}`).itens[0].quantidadeJaDevolvida, undefined);
  assert.equal(fake.listar('creditos_cliente/').length, 0);
  assert.equal(fake.listar('empresas/emp1/logs/').length, 1, 'historico do pedido');
});

test('reenviar o mesmo envio devolve o que ja existe, sem duplicar', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE });
  const r = await s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE });
  assert.equal(r.jaEnviada, true);
  assert.equal(fake.listar('devolucoes_venda/').length, 1);
});

test('dono do pedido: outro vendedor nao devolve', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).solicitarPeloApp({ user: { ...VENDEDOR, uid: 'vend2' }, tenantId: T, corpo: corpo(), hoje: HOJE }),
    (e) => e.status === 409 && /outro vendedor/.test(e.message),
  );
  assert.equal(fake.listar('devolucoes_venda/').length, 0);
});

test('pedido que nao e do app, nao faturado ou de outra empresa e recusado', async () => {
  const fake = criarBancoFalso(base({ 'pedidos_venda/ffffffffffffffffffffffffffffffff': pedido({ tenantId: 'emp2' }) }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(() => s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo({ pedidoId: 'zWWih8mhQhkL8y0XDnmy' }), hoje: HOJE }), /feito no aplicativo/);
  await assert.rejects(() => s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo({ pedidoId: 'ffffffffffffffffffffffffffffffff' }), hoje: HOJE }), (e) => e.status === 404);
  const preVenda = criarBancoFalso(base({ [`pedidos_venda/${ID_APP}`]: pedido({ status: 'Pré-venda' }) }), { consultas: true });
  await assert.rejects(() => carregar(preVenda.db).solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE }), /faturado/);
});

test('quantidade acima do disponivel (contando a que ja esta aguardando) e recusada', async () => {
  const fake = criarBancoFalso(base({
    'devolucoes_venda/antiga': { tenantId: T, pedidoVendaId: ID_APP, status: 'aguardando_confirmacao', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 2 }] },
    'devolucoes_venda/recusada': { tenantId: T, pedidoVendaId: ID_APP, status: 'recusada', itensDevolvidos: [{ indice: 0, quantidadeDevolvida: 1 }] },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo({ itens: [{ indice: 0, quantidade: 2 }] }), hoje: HOJE }),
    /no máximo 1.*aguardando confirmação/,
  );
  // A recusada nao segura nada: 1 ainda cabe.
  const r = await s.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo({ itens: [{ indice: 0, quantidade: 1 }] }), hoje: HOJE });
  assert.equal(r.status, 'aguardando_confirmacao');
});

test('chave da filial desligada: o servidor recusa mesmo que o app mande', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/emp1': {} }), { consultas: true });
  await assert.rejects(() => carregar(fake.db).solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE }), (e) => e.status === 403 && /desligada/.test(e.message));
});

test('prazo da filial com "bloquear": fora do prazo nao entra', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/emp1': { appDevolucaoPermitida: true, parametrosVenda: { devolucao: { prazoDias: 2, acao: 'bloquear' } } } }), { consultas: true });
  await assert.rejects(() => carregar(fake.db).solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE }), /prazo/);
});

test('confirmar (filial com "ja entra confirmada"): estoque na unidade base, lote, pedido e credito, como no sistema', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/emp1': { appDevolucaoPermitida: true, appDevolucaoJaConfirmada: true } }), { consultas: true });
  const r = await carregar(fake.db).solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: corpo(), hoje: HOJE });
  assert.equal(r.status, 'concluida');
  const d = fake.ler('devolucoes_venda/dev00000001');
  assert.equal(d.status, 'concluida');
  assert.equal(d.confirmadaAutomaticamente, true);
  assert.deepEqual(d.lotesDevolvidos.map((l) => [l.loteId, l.quantidade]), [['L1', 1]]);
  assert.equal(fake.ler('estoque/p1').quantidade, 120, '1 saco de 20 kg volta como 20');
  assert.equal(fake.ler('estoque/p2').quantidade, 11);
  assert.equal(fake.ler('estoque_lotes/L1').quantidade, 6);
  const itens = fake.ler(`pedidos_venda/${ID_APP}`).itens;
  assert.equal(itens[0].quantidadeJaDevolvida, 1);
  assert.equal(itens[1].quantidadeJaDevolvida, 1);
  const credito = fake.ler('creditos_cliente/devolucao_dev00000001');
  assert.equal(credito.saldoDisponivel, 120);
  assert.equal(credito.clienteId, 'c1');
  assert.equal(fake.listar('transacoes/').length, 0);
});

test('confirmar com saida pelo banco: lancamento "Devolução de Venda" e saldo debitado', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/emp1': { appDevolucaoPermitida: true, appDevolucaoJaConfirmada: true } }), { consultas: true });
  // Escolher o destino no app exige a permissao propria (25/11/2026); sem ela vira credito.
  const comPermissao = { ...VENDEDOR, permissoes: ['app.devolucao_destino'] };
  await carregar(fake.db).solicitarPeloApp({ user: comPermissao, tenantId: T, corpo: corpo({ destino: 'banco', bancoId: 'b1', formaBancaria: 'Pix' }), hoje: HOJE });
  const t = fake.ler('transacoes/devolucao_dev00000001');
  assert.equal(t.categoria, 'Devolução de Venda');
  assert.equal(t.tipo, 'saida');
  assert.equal(t.naturezaFinanceira, 'bancario_digital');
  assert.equal(t.data, HOJE);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000 - 12000);
  assert.equal(fake.ler('devolucoes_venda/dev00000001').bancoNome, 'SICOOB');
});

test('recusada pelo escritorio: o vendedor ve a situacao e o motivo na lista dele', async () => {
  const fake = criarBancoFalso(base({
    'devolucoes_venda/r1': { tenantId: T, pedidoVendaId: ID_APP, numeroPedidoOriginal: '0154', solicitadoPorId: 'vend1', status: 'recusada', motivoRecusa: 'Mercadoria aberta', destinoValor: 'credito', valorTotalDevolvido: 30, itensDevolvidos: [{ nome: 'COLEIRA', quantidadeDevolvida: 1 }] },
    'devolucoes_venda/outro': { tenantId: T, pedidoVendaId: ID_APP, solicitadoPorId: 'vend2', status: 'aguardando_confirmacao' },
  }), { consultas: true });
  const lista = await carregar(fake.db).listarDoVendedor({ user: VENDEDOR, tenantId: T });
  assert.equal(lista.length, 1);
  assert.equal(lista[0].status, 'recusada');
  assert.equal(lista[0].motivoRecusa, 'Mercadoria aberta');
});

test('tela do app: so com a chave ligada e mostra o disponivel de cada linha', async () => {
  const fake = criarBancoFalso(base({
    'devolucoes_venda/antiga': { tenantId: T, pedidoVendaId: ID_APP, status: 'aguardando_confirmacao', itensDevolvidos: [{ indice: 1, quantidadeDevolvida: 1 }] },
  }), { consultas: true });
  const dados = await carregar(fake.db).dadosParaDevolver({ user: VENDEDOR, tenantId: T, pedidoId: ID_APP, hoje: HOJE });
  assert.equal(dados.itens[0].disponivel, 3);
  assert.equal(dados.itens[1].disponivel, 1);
  assert.equal(dados.itens[1].emAguardo, 1);
  assert.deepEqual(dados.bancos, [{ id: 'b1', nome: 'SICOOB' }]);
});

test('cashback: devolucao aguardando confirmacao nao estorna nada', async () => {
  const fake = criarBancoFalso(base({ 'devolucoes_venda/p1': { tenantId: T, pedidoVendaId: ID_APP, status: 'aguardando_confirmacao' } }), { consultas: true });
  const [, , , cashback] = carregarComBancoFalso(fake.db, 'services/cashback');
  const r = await cashback.estornarDevolucao({ user: VENDEDOR, tenantId: T, devolucaoId: 'p1' });
  assert.equal(r.estornado, false);
});
