const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Venda com entrega futura -- entregas (23/10/2026): listar pendentes, entregar
 * em partes (estoque e lotes FEFO), situacao do pedido, bloqueios, rota.
 * A remessa (Spedy) fica fora: sem chave da Spedy a entrega sai sem nota, com aviso.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/entregaFutura')[3];

const GESTOR = { uid: 'ger', tenantId: 'loja', email: 'g@loja', nome: 'GERENTE', permissoes: ['operacoes.entregas_futuras'] };

const pedido = (extra = {}) => ({
  tenantId: 'loja', numeroPedido: '0035', status: 'Finalizada', clienteId: 'cli1', clienteNome: 'MARIA', vendedorNome: 'ANA',
  dataVenda: '2026-10-20', valorTotal: 140, valorTotalCentavos: 14000, entregaFutura: true, estoqueReservado: true,
  previsaoEntrega: '2026-10-22', entregaFuturaSituacao: 'pendente', entregaFuturaEntregue: [0, 0],
  itens: [
    { id: 'p1', nome: 'RAÇÃO 15KG', quantidade: 10, precoUnitario: 10, desconto: 0, subtotal: 100, unidadeMedidaSigla: 'SC' },
    { id: 'p2', nome: 'VERMÍFUGO', quantidade: 2, precoUnitario: 20, desconto: 0, subtotal: 40, unidadeMedidaSigla: 'UN' },
  ],
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true, controlaFiscal: false },
  'pedidos_venda/v1': pedido(),
  'clientes/cli1': { tenantId: 'loja', nome: 'MARIA', endereco: 'RUA A', numero: '1', bairro: 'CENTRO', cidade: 'IPATINGA', estado: 'MG' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO 15KG', quantidade: 10, quantidadeReservada: 10 },
  'estoque/p2': { tenantId: 'loja', nome: 'VERMÍFUGO', quantidade: 3, quantidadeReservada: 2, controlarLote: true },
  'estoque_lotes/l1': { tenantId: 'loja', produtoId: 'p2', lote: 'A1', validade: '2027-01-01', quantidade: 1 },
  'estoque_lotes/l2': { tenantId: 'loja', produtoId: 'p2', lote: 'B2', validade: '2026-12-01', quantidade: 2 },
  ...extra,
});

test('lista os pendentes (atrasado primeiro) e o detalhe traz saldo, nota e rotas', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/v2': pedido({ numeroPedido: '0036', previsaoEntrega: '2099-01-01' }),
    'pedidos_venda/v3': pedido({ numeroPedido: '0037', entregaFuturaSituacao: 'entregue', entregaFuturaEntregue: [10, 2] }),
    'pedidos_venda/comum': pedido({ numeroPedido: '0038', entregaFutura: false }),
    'romaneios/r1': { tenantId: 'loja', numero: 4, nome: 'Daniela', status: 'montagem', entregas: [], pedidoIds: [] },
  }), { consultas: true });
  const s = carregar(fake.db);
  const lista = await s.listarPendentes({ tenantId: 'loja' });
  assert.deepEqual(lista.map((p) => p.numeroPedido), ['0035', '0036'], 'entregue e venda comum ficam fora; atrasado primeiro');
  assert.equal(lista[0].atrasada, true);
  assert.equal(lista[0].situacao, 'pendente');
  assert.deepEqual(lista[0].itens.map((i) => [i.nome, i.saldo]), [['RAÇÃO 15KG', 10], ['VERMÍFUGO', 2]]);
  const d = await s.detalhe({ tenantId: 'loja', pedidoId: 'v1' });
  assert.equal(d.notaFaturamento.situacao, 'nenhuma');
  assert.deepEqual(d.rotas.map((r) => r.titulo), ['Rota 04 DANIELA']);
  assert.equal(d.pedido.itens[1].controlaLote, true);
  await assert.rejects(() => s.detalhe({ tenantId: 'loja', pedidoId: 'comum' }), (e) => e.status === 409);
});

test('entregar em partes: baixa estoque e reserva, lote que vence antes sai antes, situacao do pedido e bloqueios', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);

  await assert.rejects(() => s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 11 }] } }), (e) => e.status === 400 && /falta entregar 10/.test(e.message));
  await assert.rejects(() => s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [] } }), (e) => e.status === 400);

  const r1 = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 4 }], observacao: 'primeira parte' } });
  assert.equal(r1.numero, 1);
  assert.equal(r1.titulo, 'Pedido #0035 · entrega 1');
  assert.equal(r1.situacao, 'parcial');
  assert.equal(r1.nota, null, 'empresa sem fiscal: sem nota');
  assert.deepEqual(r1.avisos, []);
  const p1 = fake.ler('estoque/p1');
  assert.equal(p1.quantidade, 6);
  assert.equal(p1.quantidadeReservada, 6);
  const ped = fake.ler('pedidos_venda/v1');
  assert.deepEqual(ped.entregaFuturaEntregue, [4, 0]);
  assert.equal(ped.entregaFuturaSituacao, 'parcial');
  assert.equal(ped.estoqueReservado, true);
  const entrega1 = fake.ler(`entregas_futuras/${r1.entregaId}`);
  assert.equal(entrega1.valorCentavos, 4000);
  assert.equal(entrega1.observacao, 'primeira parte');
  assert.deepEqual(entrega1.itens.map((i) => [i.id, i.quantidade]), [['p1', 4]]);

  // Vermifugo controla lote: 2 saem do B2 (vence antes), A1 fica.
  const r2 = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 1, quantidade: 2 }] } });
  assert.equal(r2.numero, 2);
  assert.equal(fake.ler('estoque/p2').quantidade, 1);
  assert.equal(fake.ler('estoque/p2').quantidadeReservada, 0);
  assert.equal(fake.ler('estoque_lotes/l2').quantidade, 0);
  assert.equal(fake.ler('estoque_lotes/l1').quantidade, 1);
  const entrega2 = fake.ler(`entregas_futuras/${r2.entregaId}`);
  assert.deepEqual(entrega2.itens[0].lotes, [{ loteId: 'l2', lote: 'B2', validade: '2026-12-01', quantidade: 2 }]);

  // Falta estoque para o resto (6 reservados, so 6 em estoque -> ok); com 7 pedidos barra.
  await fake.db.collection('estoque').doc('p1').update({ quantidade: 5 });
  await assert.rejects(() => s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 6 }] } }), (e) => e.status === 409 && /Estoque insuficiente para entregar RAÇÃO 15KG/.test(e.message));
  await fake.db.collection('estoque').doc('p1').update({ quantidade: 6 });
  const r3 = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 6 }] } });
  assert.equal(r3.situacao, 'entregue');
  const fim = fake.ler('pedidos_venda/v1');
  assert.equal(fim.entregaFuturaSituacao, 'entregue');
  assert.equal(fim.estoqueReservado, false, 'tudo entregue: acabou a reserva');
  assert.equal(fim.entregaFuturaQuantidadeDeEntregas, 3);
  assert.equal(fake.ler('estoque/p1').quantidade, 0);
  await assert.rejects(() => s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 1 }] } }), (e) => e.status === 409 && /já foi entregue por completo/.test(e.message));
  assert.equal((await s.listarPendentes({ tenantId: 'loja' })).length, 0);
});

test('empresa com fiscal sem NF-e de faturamento: entrega sai sem nota e avisa; nota em transito barra', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true, controlaFiscal: true } }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 1 }] } });
  assert.equal(r.nota, null);
  assert.match(r.avisos[0], /SEM nota de remessa/);
  const emTransito = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true, controlaFiscal: true },
    'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'v1', tipo: 'NF-e', status: 'enqueued', finalidade: 'faturamento_entrega_futura' },
  }), { consultas: true });
  await assert.rejects(() => carregar(emTransito.db).entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 1 }] } }), (e) => e.status === 409 && /resposta da SEFAZ/.test(e.message));
  // Nota autorizada mas Spedy nao configurada: a entrega fica gravada e a nota "nao_emitida" com o motivo.
  const autorizada = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true, controlaFiscal: true, nfseCidadeEstado: 'MG', regimeTributario: 'simples_nacional' },
    'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'v1', tipo: 'NF-e', status: 'authorized', number: 120, accessKey: '3'.repeat(44), finalidade: 'faturamento_entrega_futura', data: '2026-10-20T12:00:00.000Z' },
  }), { consultas: true });
  const sa = carregar(autorizada.db);
  const ra = await sa.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 1 }] } });
  assert.equal(ra.nota.ok, false);
  assert.match(ra.avisos[0], /nota de remessa não saiu/);
  const entrega = autorizada.ler(`entregas_futuras/${ra.entregaId}`);
  assert.equal(entrega.notaFiscal.status, 'nao_emitida');
  assert.equal(entrega.notaFiscal.notaFaturamentoChave, '3'.repeat(44));
  assert.equal(autorizada.ler('estoque/p1').quantidade, 9, 'a entrega vale mesmo sem a nota');
});

test('rota: a entrega entra no romaneio em montagem como linha propria, com trava; rota liberada e recusada', async () => {
  const fake = criarBancoFalso(base({
    'romaneios/r1': { tenantId: 'loja', numero: 4, nome: 'Daniela', status: 'montagem', entregas: [], pedidoIds: [] },
    'romaneios/r2': { tenantId: 'loja', numero: 5, nome: '', status: 'em_rota', entregas: [], pedidoIds: [] },
  }), { consultas: true });
  const s = carregar(fake.db);
  const r = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 3 }], romaneioId: 'r1' } });
  assert.deepEqual(r.rota, { acao: 'colocado', rota: { id: 'r1', titulo: 'Rota 04 DANIELA' } });
  const rom = fake.ler('romaneios/r1');
  assert.deepEqual(rom.pedidoIds, [r.entregaId]);
  assert.equal(rom.entregas[0].numeroPedido, '0035/1');
  assert.equal(rom.entregas[0].clienteNome, 'MARIA');
  assert.equal(rom.entregas[0].valorTotalCentavos, 3000);
  assert.equal(rom.entregas[0].formaPagamento, 'Já faturado (entrega futura)');
  const trava = fake.ler(`romaneio_pedidos/${r.entregaId}`);
  assert.equal(trava.situacao, 'em_romaneio');
  assert.equal(trava.pedidoOrigemId, 'v1');
  assert.deepEqual(fake.ler(`entregas_futuras/${r.entregaId}`).romaneio, { id: 'r1', titulo: 'Rota 04 DANIELA' });
  // Rota que ja saiu: a entrega e gravada e o aviso diz para colocar pelo Romaneio.
  const r2 = await s.entregar({ user: GESTOR, tenantId: 'loja', pedidoId: 'v1', corpo: { itens: [{ indice: 0, quantidade: 1 }], romaneioId: 'r2' } });
  assert.equal(r2.rota, null);
  assert.match(r2.avisos[0], /não entrou na rota/);
  assert.equal(fake.ler('pedidos_venda/v1').entregaFuturaEntregue[0], 4);
});
