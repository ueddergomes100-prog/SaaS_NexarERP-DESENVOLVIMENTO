/*
 * Cashback (20/10/2026): gera na venda paga (uma vez so'), estorna no
 * cancelamento (o que ja' foi usado vira divida, abatida pelo proximo lote) e
 * na devolucao (proporcional). Ver services/cashback.js e domain/cashbackDomain.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const T = 'loja';
const USER = { uid: 'u1', email: 'dono@loja.com', tenantId: T };

const venda = (id, extra = {}) => ({
  tenantId: T, status: 'Finalizada', numeroPedido: id.toUpperCase(), clienteId: 'c1', clienteNome: 'MARIA',
  itens: [{ id: 'p1', nome: 'CAMISETA', quantidade: 2, precoUnitario: 50, desconto: 0, subtotal: 100 }],
  valorTotal: 100, valorTotalCentavos: 10000, descontoGeral: { valorAplicadoCentavos: 0 },
  pagamentos: [{ id: 'pg1', formaPagamento: 'Dinheiro', status: 'confirmado', valorCentavos: 10000 }],
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': { cashback: { ativo: true, modelo: 'reais', tipoPadrao: 'percentual', valorPadrao: 5, validadeDias: 90 } },
  'clientes/c1': { tenantId: T, nome: 'MARIA' },
  'estoque/p1': { tenantId: T, nome: 'CAMISETA', permitirCashback: true },
  'pedidos_venda/v1': venda('v1'),
  ...extra,
});

const carregar = (docs) => {
  const fake = criarBancoFalso(docs, { consultas: true });
  const [servico] = carregarComBancoFalso(fake.db, 'services/cashback').slice(3);
  return { fake, servico };
};

test('venda paga gera o lote uma vez so\'; o resumo do cliente acompanha', async () => {
  const { fake, servico } = carregar(base());
  const r = await servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' });
  assert.equal(r.gerado, true);
  assert.equal(r.centavos, 500);
  const lote = fake.ler('cashback_movimentos/gerado_v1');
  assert.equal(lote.restanteCentavos, 500);
  assert.equal(lote.clienteId, 'c1');
  assert.ok(lote.validade, 'tem validade (90 dias)');
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, 500);
  assert.equal(fake.ler('clientes/c1').cashback.dividaCentavos, 0);
  const deNovo = await servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' });
  assert.equal(deNovo.gerado, false);
  assert.equal(deNovo.jaGerado, true);
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, 500, 'nao gerou em dobro');
});

test('nao gera: venda com parcela pendente, consumidor final, cashback desligado, produto sem a marca', async () => {
  const pendente = carregar(base({ 'pedidos_venda/v1': venda('v1', { pagamentos: [{ id: 'pg1', formaPagamento: 'Pagamento a Prazo', status: 'pendente', valorCentavos: 10000 }] }) }));
  assert.equal((await pendente.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' })).gerado, false);
  const consumidorFinal = carregar(base({ 'clientes/c1': { tenantId: T, nome: 'CONSUMIDOR FINAL', isPadrao: true } }));
  assert.match((await consumidorFinal.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' })).motivo, /consumidor final/i);
  const desligado = carregar(base({ 'configuracoes/loja': { cashback: { ativo: false } } }));
  assert.match((await desligado.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' })).motivo, /desligado/);
  const semMarca = carregar(base({ 'estoque/p1': { tenantId: T, nome: 'CAMISETA', permitirCashback: false } }));
  assert.match((await semMarca.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' })).motivo, /nenhum item/);
});

test('desconto geral e pagamento com cashback reduzem a base; modelo em pontos', async () => {
  const comDesconto = carregar(base({ 'pedidos_venda/v1': venda('v1', {
    descontoGeral: { valorAplicadoCentavos: 2000 },
    pagamentos: [{ id: 'pg1', formaPagamento: 'Cashback', status: 'confirmado', valorCentavos: 1000 }, { id: 'pg2', formaPagamento: 'Pix', status: 'confirmado', valorCentavos: 7000 }],
  }) }));
  // base = 10000 - 2000 (desconto geral) - 1000 (pago com cashback) = 7000 -> 5% = 350
  assert.equal((await comDesconto.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' })).centavos, 350);

  const pontos = carregar(base({ 'configuracoes/loja': { cashback: { ativo: true, modelo: 'pontos', pontosPorReal: 2, faixas: [{ pontos: 100, descontoPercentual: 5 }] } } }));
  const r = await pontos.servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' });
  assert.equal(r.pontos, 200);
  assert.equal(pontos.fake.ler('clientes/c1').cashback.saldoPontos, 200);
});

test('cancelamento estorna o lote; o que ja\' foi usado vira divida e o proximo lote abate', async () => {
  const { fake, servico } = carregar(base({ 'pedidos_venda/v2': venda('v2') }));
  await servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' });
  // Simula uso de 300 do lote (a venda que usa e' a fatia 2; aqui so' o saldo restante e o usado).
  await fake.db.collection('cashback_movimentos').doc('gerado_v1').update({ restanteCentavos: 200, usadoCentavos: 300 });
  const r = await servico.estornarVenda({ user: USER, tenantId: T, pedidoId: 'v1' });
  assert.equal(r.estornado, true);
  assert.deepEqual(r.viraramDivida, { centavos: 300, pontos: 0 });
  assert.equal(fake.ler('cashback_movimentos/gerado_v1').estornado, true);
  assert.equal(fake.ler('cashback_movimentos/estornado_v1').tipo, 'estornado');
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, -300);
  assert.equal(fake.ler('clientes/c1').cashback.dividaCentavos, 300);
  assert.equal((await servico.estornarVenda({ user: USER, tenantId: T, pedidoId: 'v1' })).estornado, false, 'nao estorna em dobro');
  // Proxima venda paga (500) abate a divida de 300: sobra 200 de saldo.
  const r2 = await servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v2' });
  assert.equal(r2.gerado, true);
  assert.equal(fake.ler('cashback_movimentos/gerado_v2').restanteCentavos, 200);
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, 200);
  assert.equal(fake.ler('clientes/c1').cashback.dividaCentavos, 0);
});

test('devolucao estorna a parte proporcional; baixa estornada devolve o lote inteiro', async () => {
  const { fake, servico } = carregar(base({ 'devolucoes_venda/d1': { tenantId: T, pedidoVendaId: 'v1', valorTotalDevolvidoCentavos: 5000 } }));
  await servico.gerarSeDevido({ user: USER, tenantId: T, pedidoId: 'v1' });
  const r = await servico.estornarDevolucao({ user: USER, tenantId: T, devolucaoId: 'd1' });
  assert.equal(r.estornado, true);
  assert.equal(r.centavos, 250);
  assert.equal(fake.ler('cashback_movimentos/gerado_v1').restanteCentavos, 250);
  assert.equal(fake.ler('cashback_movimentos/gerado_v1').estornado, false);
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, 250);
  // A venda continua paga: revisar nao faz nada.
  assert.equal((await servico.revisarAposEstorno({ user: USER, tenantId: T, pedidoId: 'v1' })).estornado, false);
  // Baixa estornada: a venda volta a pendente -> o que sobrava do lote (250) sai; o que saiu
  // pela devolucao nao foi gasto pelo cliente, entao nada vira divida.
  await fake.db.collection('pedidos_venda').doc('v1').update({ pagamentos: [{ id: 'pg1', formaPagamento: 'Pagamento a Prazo', status: 'pendente', valorCentavos: 10000 }] });
  const r2 = await servico.revisarAposEstorno({ user: USER, tenantId: T, pedidoId: 'v1' });
  assert.equal(r2.estornado, true);
  assert.equal(r2.centavos, 250);
  assert.equal(fake.ler('cashback_movimentos/gerado_v1').estornado, true);
  assert.equal(fake.ler('clientes/c1').cashback.saldoCentavos, 0);
  assert.equal(fake.ler('clientes/c1').cashback.dividaCentavos, 0);
});
