const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Cancelar venda, cancelar pre-venda e alterar a forma de pagamento pelo
 * servidor (item 8, fatia 3b -- 19/10/2026). Estoque, lotes, lancamentos,
 * saldo do banco e credito do cliente sao lidos e gravados aqui.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/vendaFechamento', 'services/vendaCancelamento')[4];

const GERENTE = { uid: 'ger1', tenantId: 'loja', email: 'g@loja', nome: 'GERENTE', permissoes: ['vendas.alterar', 'vendas.pre_venda_cancelar', 'vendas.alterar_pagamento_finalizada'] };

const venda = (extra = {}) => ({
  tenantId: 'loja',
  numeroPedido: '0154',
  status: 'Finalizada',
  clienteId: 'cli1',
  clienteNome: 'MARIA',
  vendedorId: 'vend1',
  vendedorNome: 'ANA',
  dataVenda: '2026-10-19',
  valorTotal: 20,
  valorTotalCentavos: 2000,
  formaPagamento: 'Dinheiro',
  itens: [{ id: 'p1', nome: 'RAÇÃO', quantidade: 2, precoUnitario: 10, subtotal: 20 }],
  pagamentos: [{ indice: 1, formaPagamento: 'Dinheiro', valorCentavos: 2000, valor: 20, status: 'confirmado', transactionId: 'v1' }],
  comissao: { vendedorId: 'vend1', valorOriginalCentavos: 100, valorAtualCentavos: 100, status: 'ativa' },
  ...extra,
});

const titulo = (extra = {}) => ({
  tenantId: 'loja', pedidoId: 'v1', status: 'Paga', formaPagamento: 'Dinheiro', valor: 20, valorCentavos: 2000, movimentaCaixaFisico: true, descricao: 'Venda Direta #0154 - Dinheiro', ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja', alterarPagamentoVendaFinalizada: true },
  'pedidos_venda/v1': venda(),
  'transacoes/v1': titulo(),
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 8, quantidadeReservada: 0 },
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  ...extra,
});

const pagamento = (extra = {}) => ({
  id: 'pg1', forma: 'Pix', valor: '20', prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: 'b1', bancoNome: 'SICOOB', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '', ...extra,
});

// ------------------------------------------------------------- cancelar venda

test('cancelar venda em dinheiro: estoque volta, titulo estornado, comissao cancelada e o motivo gravado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } });
  assert.equal(r.numeroPedido, '0154');
  const pedido = fake.ler('pedidos_venda/v1');
  assert.equal(pedido.status, 'Cancelada');
  assert.equal(pedido.motivoCancelamento, 'cliente desistiu');
  assert.equal(pedido.canceladaPor, 'ger1');
  assert.equal(pedido.comissao.valorAtualCentavos, 0);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
  assert.equal(fake.ler('transacoes/v1').estornada, true);
  const estorno = fake.ler('transacoes/estorno_cancelamento_v1');
  assert.equal(estorno.tipo, 'saida');
  assert.equal(estorno.valorCentavos, 2000);
  assert.equal(estorno.naturezaFinanceira, 'caixa_fisico');
});

test('cancelar duas vezes: a segunda e recusada e nada volta em dobro', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } });
  await assert.rejects(
    () => s.cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'de novo aqui' } }),
    (erro) => erro.status === 409 && /já foi cancelada/.test(erro.message),
  );
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('sem motivo nao cancela', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: '' } }),
    (erro) => erro.status === 400 && /motivo/.test(erro.message),
  );
  assert.equal(fake.ler('pedidos_venda/v1').status, 'Finalizada');
});

test('Pix: o saldo do banco volta; lotes voltam ao mesmo lote; orcamento reabre', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/v1': venda({
      orcamentoId: 'orc1',
      itens: [{ id: 'p1', nome: 'RAÇÃO', quantidade: 2, precoUnitario: 10, subtotal: 20, lotes: [{ loteId: 'L1', lote: 'A1', validade: null, quantidade: 2 }] }],
      pagamentos: [{ indice: 1, formaPagamento: 'Pix', valorCentavos: 2000, valor: 20, status: 'confirmado', bancoId: 'b1', transactionId: 'v1' }],
    }),
    'transacoes/v1': titulo({ formaPagamento: 'Pix', movimentaCaixaFisico: false, naturezaFinanceira: 'bancario_digital', bancoId: 'b1' }),
    'estoque_lotes/L1': { tenantId: 'loja', produtoId: 'p1', quantidade: 3 },
    'orcamentos/orc1': { tenantId: 'loja', status: 'Finalizado' },
  }), { consultas: true });
  await carregar(fake.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'pagou errado' } });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 98000);
  assert.equal(fake.ler('estoque_lotes/L1').quantidade, 5);
  assert.equal(fake.ler('orcamentos/orc1').status, 'Pendente');
  assert.equal(fake.ler('transacoes/estorno_cancelamento_v1').naturezaFinanceira, 'bancario_digital');
});

test('credito de devolucao usado volta para o cliente como credito disponivel', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/v1': venda({
      pagamentos: [
        { indice: 1, formaPagamento: 'Crédito de Devolução', valorCentavos: 500, valor: 5, status: 'confirmado', transactionId: 'v1' },
        { indice: 2, formaPagamento: 'Dinheiro', valorCentavos: 1500, valor: 15, status: 'confirmado', transactionId: 'v1_pag_2' },
      ],
    }),
  }), { consultas: true });
  const r = await carregar(fake.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } });
  assert.equal(r.creditoDevolvidoCentavos, 500);
  const credito = fake.ler('creditos_cliente/cancelamento_v1');
  assert.equal(credito.status, 'disponivel');
  assert.equal(credito.saldoDisponivelCentavos, 500);
  assert.equal(credito.clienteNome, 'MARIA');
});

test('pedido numa rota aberta nao cancela; rota ja fechada nao bloqueia', async () => {
  const aberta = criarBancoFalso(base({ 'romaneio_pedidos/v1': { tenantId: 'loja', romaneioId: 'r1', romaneioTitulo: 'Rota 03', situacao: 'em_romaneio' } }), { consultas: true });
  await assert.rejects(
    () => carregar(aberta.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } }),
    (erro) => erro.status === 409 && /Rota 03/.test(erro.message),
  );
  const fechada = criarBancoFalso(base({ 'romaneio_pedidos/v1': { tenantId: 'loja', romaneioId: 'r1', situacao: 'entregue' } }), { consultas: true });
  await carregar(fechada.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } });
  assert.equal(fechada.ler('pedidos_venda/v1').status, 'Cancelada');
});

test('nota fiscal autorizada ou na SEFAZ: recusa (a tela cancela a nota antes)', async () => {
  const autorizada = criarBancoFalso(base({ 'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'v1', tipo: 'NF-e', status: 'authorized', number: 12 } }), { consultas: true });
  await assert.rejects(
    () => carregar(autorizada.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } }),
    (erro) => erro.status === 409 && /autorizada/.test(erro.message),
  );
  const cancelada = criarBancoFalso(base({ 'notas_fiscais/n1': { tenantId: 'loja', pedidoId: 'v1', tipo: 'NF-e', status: 'canceled', number: 12 } }), { consultas: true });
  await carregar(cancelada.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } });
  assert.equal(cancelada.ler('pedidos_venda/v1').status, 'Cancelada');
});

test('venda com item devolvido nao cancela; pre-venda nao cancela por este caminho', async () => {
  const devolvida = criarBancoFalso(base({ 'pedidos_venda/v1': venda({ itens: [{ id: 'p1', nome: 'RAÇÃO', quantidade: 2, quantidadeJaDevolvida: 1 }] }) }), { consultas: true });
  await assert.rejects(
    () => carregar(devolvida.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } }),
    (erro) => erro.status === 409 && /devolvidos/.test(erro.message),
  );
  const pre = criarBancoFalso(base({ 'pedidos_venda/v1': venda({ status: 'Pré-venda' }) }), { consultas: true });
  await assert.rejects(
    () => carregar(pre.db).cancelarVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', motivo: 'cliente desistiu' } }),
    (erro) => erro.status === 409 && /pré-venda/.test(erro.message),
  );
});

// ------------------------------------------------------------- pre-venda

test('cancelar pre-venda libera a reserva sem mexer no estoque', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/v1': venda({ status: 'Pré-venda', estoqueReservado: true }),
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 2 },
  }), { consultas: true });
  const r = await carregar(fake.db).cancelarPreVenda({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1' } });
  assert.equal(r.reservaLiberada, true);
  assert.equal(fake.ler('pedidos_venda/v1').status, 'Cancelada');
  assert.equal(fake.ler('pedidos_venda/v1').estoqueReservado, false);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 0);
});

test('app Vendas (soDoVendedor): so cancela a pre-venda do proprio vendedor', async () => {
  const VENDEDOR = { uid: 'vend1', tenantId: 'loja', email: 'v@loja', permissoes: ['vendas.pre_venda_cancelar'] };
  const fake = criarBancoFalso(base({
    'pedidos_venda/v1': venda({ status: 'Pré-venda', estoqueReservado: true, vendedorId: 'vend1' }),
    'pedidos_venda/v2': venda({ status: 'Pré-venda', estoqueReservado: false, vendedorId: 'outro' }),
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 2 },
  }), { consultas: true });
  const s = carregar(fake.db);
  await assert.rejects(
    () => s.cancelarPreVenda({ user: VENDEDOR, tenantId: 'loja', corpo: { pedidoId: 'v2', soDoVendedor: true } }),
    (erro) => erro.status === 403 && /outro vendedor/.test(erro.message),
  );
  assert.equal(fake.ler('pedidos_venda/v2').status, 'Pré-venda');
  const r = await s.cancelarPreVenda({ user: VENDEDOR, tenantId: 'loja', corpo: { pedidoId: 'v1', soDoVendedor: true } });
  assert.equal(r.peloApp, true);
  assert.equal(fake.ler('pedidos_venda/v1').status, 'Cancelada');
  assert.equal(fake.ler('estoque/p1').quantidadeReservada, 0);
  await assert.rejects(
    () => s.cancelarPreVenda({ user: VENDEDOR, tenantId: 'loja', corpo: { pedidoId: 'v1', soDoVendedor: true } }),
    (erro) => erro.status === 409 && /não pode mais ser cancelado pelo aplicativo/.test(erro.message),
  );
});

// ------------------------------------------------------------- alterar pagamento

test('alterar de dinheiro para Pix: o lancamento e refeito e o banco recebe', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).alterarPagamento({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', pagamentos: [pagamento()] } });
  assert.equal(r.formaAnterior, 'Dinheiro');
  assert.equal(r.formaNova, 'Pix');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 102000);
  assert.equal(fake.ler('transacoes/v1').formaPagamento, 'Pix');
  assert.equal(fake.ler('transacoes/v1').bancoId, 'b1');
  assert.equal(fake.ler('pedidos_venda/v1').formaPagamento, 'Pix');
});

test('o total e da venda gravada: pagamento que nao fecha e recusado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).alterarPagamento({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', pagamentos: [pagamento({ valor: '15' })] } }),
    (erro) => erro.status === 400,
  );
});

test('parcela ja recebida no Contas a Receber bloqueia a alteracao', async () => {
  const fake = criarBancoFalso(base({
    'transacoes/v1': titulo({ formaPagamento: 'Pagamento a Prazo', baixaManual: { origem: 'dar_baixa' }, dataPagamento: '2026-10-18' }),
  }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).alterarPagamento({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', pagamentos: [pagamento()] } }),
    (erro) => erro.status === 409 && /já foi recebida em 18\/10\/2026/.test(erro.message),
  );
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000);
});

test('alteracao desligada nas configuracoes: recusa', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/loja': { tenantId: 'loja' } }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).alterarPagamento({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', pagamentos: [pagamento()] } }),
    (erro) => erro.status === 403,
  );
});

test('a parte paga com credito de devolucao nao muda por aqui', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/v1': venda({
      pagamentos: [
        { indice: 1, formaPagamento: 'Crédito de Devolução', valorCentavos: 500, valor: 5, status: 'confirmado', transactionId: 'v1' },
        { indice: 2, formaPagamento: 'Dinheiro', valorCentavos: 1500, valor: 15, status: 'confirmado', transactionId: 'v1_pag_2' },
      ],
    }),
  }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).alterarPagamento({ user: GERENTE, tenantId: 'loja', corpo: { pedidoId: 'v1', pagamentos: [pagamento()] } }),
    (erro) => erro.status === 409 && /crédito de devolução/.test(erro.message),
  );
});
