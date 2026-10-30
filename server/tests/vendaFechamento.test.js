const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Fechamento da venda pelo servidor (item 8, fatia 3). O servidor refaz
 * totais, pagamentos, comissao, estoque com reserva, lotes, banco e credito
 * -- nada disso vem pronto da tela.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/vendaFechamento')[3];

const VENDEDOR = { uid: 'vend1', tenantId: 'loja', email: 'v@loja', permissoes: ['vendas.pedidos'] };
const FATURISTA = { uid: 'fat1', tenantId: 'loja', email: 'f@loja', permissoes: ['vendas.pre_venda_finalizar'] };

const pagamento = (extra = {}) => ({
  id: 'pg1', forma: 'Dinheiro', valor: '20', prazoDias: '', parcelasAPrazo: '1', dataVencimento: '', bandeira: '', operadora: '',
  autorizacao: '', parcelas: '1', dataPrevistaRecebimento: '', bancoId: '', bancoNome: '', chequeBancoEmissor: '', chequeAgencia: '',
  chequeTitular: '', chequeEmitente: '', chequeDocumentoEmitente: '', chequeNumero: '', ...extra,
});

const corpo = (extra = {}) => ({
  idDocumento: 'venda1',
  dataVenda: '2026-10-13',
  vendedorId: 'vend1',
  clienteId: 'cli1',
  clienteNome: 'Maria',
  itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 0, subtotal: 20, codigo: '7' }],
  descontoGeral: { tipo: 'valor', valorInformado: 0 },
  pagamentos: [pagamento()],
  ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/loja': { tenantId: 'loja' },
  'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', recebeComissaoPecas: true, comissaoPercentualPecas: 5 },
  'usuarios/fat1': { tenantId: 'loja', nome: 'FATURISTA' },
  'clientes/cli1': { tenantId: 'loja', nome: 'MARIA' },
  'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0 },
  'bancos/b1': { tenantId: 'loja', nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  'bancos/outro': { tenantId: 'outra', nome: 'OUTRO', ativo: true, saldoCentavos: 0 },
  ...extra,
});

test('venda direta em dinheiro: numera, baixa o estoque, grava pedido e titulo pago, com comissao do vendedor', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() });
  assert.equal(r.jaEnviado, false);
  assert.equal(r.numeroPedido, '0001');
  assert.equal(r.totalCentavos, 2000);
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.status, 'Finalizada');
  assert.equal(pedido.valorTotalCentavos, 2000);
  assert.equal(pedido.vendedorNome, 'VENDEDOR UM');
  assert.equal(pedido.fechadoPeloServidor, true);
  assert.equal(pedido.itens[0].codigo, '7', 'campos da linha sao guardados');
  assert.equal(pedido.comissao.vendedorId, 'vend1');
  assert.equal(pedido.comissao.valorOriginalCentavos, 100, '5% de R$ 20,00');
  assert.equal(fake.ler('estoque/p1').quantidade, 8);
  assert.equal(fake.ler('transacoes/venda1').status, 'Paga');
  assert.equal(fake.ler('transacoes/venda1').valorCentavos, 2000);
  assert.equal(fake.ler('contadores/loja/sequencias/pedidos_venda').valor, 1);
});

test('mesmo envio repetido (internet caiu depois de gravar) nao duplica nada', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() });
  const de_novo = await s.finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() });
  assert.equal(de_novo.jaEnviado, true);
  assert.equal(de_novo.numeroPedido, '0001');
  assert.equal(fake.ler('estoque/p1').quantidade, 8, 'estoque baixou uma vez so\'');
});

test('o total e\' do servidor: pagamento que nao fecha com os itens e\' recusado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: [pagamento({ valor: '15' })] }) }),
    (erro) => erro.status === 400,
  );
  assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
  assert.equal(fake.ler('estoque/p1').quantidade, 10);
});

test('Pix credita o banco escolhido; banco de outra empresa e\' recusado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: [pagamento({ forma: 'Pix', bancoId: 'b1', bancoNome: 'SICOOB' })] }) });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 102000);

  const outro = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(outro.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: [pagamento({ forma: 'Pix', bancoId: 'outro', bancoNome: 'OUTRO' })] }) }),
    /banco de destino selecionado não foi encontrado/,
  );
  assert.equal(outro.ler('bancos/outro').saldoCentavos, 0);
});

test('reserva dos outros documentos trava a venda (empresa sem venda sem estoque); com venda sem estoque, passa', async () => {
  const travada = criarBancoFalso(base({ 'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 5, quantidadeReservada: 4 } }), { consultas: true });
  await assert.rejects(
    () => carregar(travada.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() }),
    /Estoque reservado: RAÇÃO tem 5 em estoque e 4 reservado/,
  );
  assert.equal(travada.ler('estoque/p1').quantidade, 5);

  const livre = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', venderSemEstoque: true },
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 5, quantidadeReservada: 4 },
  }), { consultas: true });
  await carregar(livre.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() });
  assert.equal(livre.ler('estoque/p1').quantidade, 3);
  assert.equal(livre.ler('estoque/p1').quantidadeReservada, 4);
});

test('pre-venda: consome a propria reserva, mantem o numero e exige a permissao de finalizar pre-venda', async () => {
  const inicial = base({
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 5, quantidadeReservada: 4 },
    'pedidos_venda/pv1': {
      tenantId: 'loja', status: 'Pré-venda', numeroPedido: '0042', origem: 'balcao', estoqueReservado: true,
      itens: [{ id: 'p1', nome: 'RAÇÃO', quantidade: 2 }], createdAt: 'antes', criadoPor: 'vend1', statusConferencia: 'conferido', conferidoPor: 'exp1',
    },
  });
  const semPermissao = criarBancoFalso(inicial, { consultas: true });
  await assert.rejects(
    () => carregar(semPermissao.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ idDocumento: undefined, pedidoId: 'pv1' }) }),
    (erro) => erro.status === 403 && /finalizar pré-venda/.test(erro.message),
  );

  const fake = criarBancoFalso({ ...inicial, 'configuracoes/loja': { tenantId: 'loja', conferenciaMercadoria: true } }, { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: FATURISTA, tenantId: 'loja', corpo: corpo({ idDocumento: undefined, pedidoId: 'pv1' }) });
  assert.equal(r.numeroPedido, '0042');
  const p1 = fake.ler('estoque/p1');
  assert.equal(p1.quantidade, 3, 'baixa os 2 da pre-venda');
  assert.equal(p1.quantidadeReservada, 2, 'libera so\' a reserva dela');
  const pedido = fake.ler('pedidos_venda/pv1');
  assert.equal(pedido.status, 'Finalizada');
  assert.equal(pedido.estoqueReservado, false);
  assert.equal(pedido.createdAt, 'antes');
  assert.equal(pedido.statusConferencia, 'conferido');
  assert.equal(pedido.conferidoPor, 'exp1');
  assert.equal(fake.ler('contadores/loja/sequencias/pedidos_venda'), undefined, 'nao gasta numero novo');

  await assert.rejects(
    () => carregar(fake.db).finalizarVenda({ user: FATURISTA, tenantId: 'loja', corpo: corpo({ idDocumento: undefined, pedidoId: 'pv1' }) }),
    /#0042 já foi finalizado/,
  );
});

test('entrega futura (23/10): fatura sem baixar o estoque (reserva), regra da filial para estoque, pre-venda ajusta a reserva', async () => {
  // Chave desligada: recusa.
  const desligada = criarBancoFalso(base({ 'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 1, quantidadeReservada: 0 } }), { consultas: true });
  await assert.rejects(
    () => carregar(desligada.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ entregaFutura: true, previsaoEntrega: '2026-11-05' }) }),
    (e) => e.status === 409 && /não trabalha com venda para entrega futura/.test(e.message),
  );

  // Padrao: reserva o que tem e deixa faturar sem estoque (1 em estoque, vende 2).
  const fake = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true },
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 1, quantidadeReservada: 0, controlarLote: true },
  }), { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ entregaFutura: true, previsaoEntrega: '2026-11-05' }) });
  assert.equal(r.numeroPedido, '0001');
  const p1 = fake.ler('estoque/p1');
  assert.equal(p1.quantidade, 1, 'nada saiu do estoque');
  assert.equal(p1.quantidadeReservada, 2, 'os 2 ficam reservados');
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.status, 'Finalizada');
  assert.equal(pedido.entregaFutura, true);
  assert.equal(pedido.estoqueReservado, true);
  assert.equal(pedido.previsaoEntrega, '2026-11-05');
  assert.equal(pedido.entregaFuturaSituacao, 'pendente');
  assert.deepEqual(pedido.entregaFuturaEntregue, [0]);
  assert.equal(pedido.itens[0].lotes, undefined, 'lote so na entrega');
  assert.equal(fake.ler('transacoes/venda1').status, 'Paga', 'financeiro entra na hora');

  // Filial que exige estoque: 1 em estoque, vende 2 -> recusa dizendo o que fazer.
  const exige = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true, entregaFuturaExigeEstoque: true },
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 1, quantidadeReservada: 0 },
  }), { consultas: true });
  await assert.rejects(
    () => carregar(exige.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ entregaFutura: true }) }),
    (e) => e.status === 409 && /exige estoque para faturar entrega futura/.test(e.message) && /só dá para reservar 1/.test(e.message),
  );

  // Pre-venda que ja' reservava 2 e fatura 3 com entrega futura: a reserva vira 3, estoque intacto.
  const pv = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComEntregaFutura: true },
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 2 },
    'pedidos_venda/pv1': { tenantId: 'loja', status: 'Pré-venda', numeroPedido: '0042', origem: 'balcao', estoqueReservado: true, itens: [{ id: 'p1', nome: 'RAÇÃO', quantidade: 2 }], createdAt: 'antes', criadoPor: 'vend1' },
  }), { consultas: true });
  await carregar(pv.db).finalizarVenda({ user: FATURISTA, tenantId: 'loja', corpo: corpo({ idDocumento: undefined, pedidoId: 'pv1', entregaFutura: true, itens: [{ id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 3, desconto: 0, subtotal: 30 }], pagamentos: [pagamento({ valor: '30' })] }) });
  assert.equal(pv.ler('estoque/p1').quantidade, 10);
  assert.equal(pv.ler('estoque/p1').quantidadeReservada, 3);
  assert.equal(pv.ler('pedidos_venda/pv1').estoqueReservado, true);
});

test('lote: baixa do lote escolhido; quantidade que nao bate com a linha e\' recusada', async () => {
  const comLote = () => base({
    'estoque/p1': { tenantId: 'loja', nome: 'RAÇÃO', quantidade: 10, quantidadeReservada: 0, controlarLote: true },
    'estoque_lotes/L1': { tenantId: 'loja', produtoId: 'p1', lote: 'A1', quantidade: 5 },
  });
  const fake = criarBancoFalso(comLote(), { consultas: true });
  const item = { id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 0, lotes: [{ loteId: 'L1', lote: 'A1', validade: null, quantidade: 2 }] };
  await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ itens: [item] }) });
  assert.equal(fake.ler('estoque_lotes/L1').quantidade, 3);

  const errado = criarBancoFalso(comLote(), { consultas: true });
  await assert.rejects(
    () => carregar(errado.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ itens: [{ ...item, lotes: [{ loteId: 'L1', lote: 'A1', validade: null, quantidade: 1 }] }] }) }),
    /escolha de novo de qual lote sai/,
  );
  assert.equal(errado.ler('estoque_lotes/L1').quantidade, 5);
});

test('venda a prazo com limite de credito ligado: cliente sem limite nao compra fiado', async () => {
  const fake = criarBancoFalso(base({ 'configuracoes/loja': { tenantId: 'loja', trabalhaComLimiteCredito: true } }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: [pagamento({ forma: 'Pagamento a Prazo', prazoDias: '30' })] }) }),
    /não tem limite de crédito cadastrado/,
  );
  const comLimite = criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', trabalhaComLimiteCredito: true },
    'clientes/cli1': { tenantId: 'loja', nome: 'MARIA', limiteDeCredito: 100 },
  }), { consultas: true });
  const r = await carregar(comLimite.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: [pagamento({ forma: 'Pagamento a Prazo', prazoDias: '30' })] }) });
  assert.equal(r.condicaoPagamento, 'aprazo');
  assert.equal(comLimite.ler('transacoes/venda1').status, 'Pendente');
  assert.equal(comLimite.ler('clientes/cli1').creditoVersao, 1, 'fecha a guarda de credito');
});

test('vendedor de outra empresa nao fecha venda aqui', async () => {
  const fake = criarBancoFalso(base({ 'usuarios/vend1': { tenantId: 'outra', nome: 'X' } }), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo() }),
    /não pertence à empresa ativa/,
  );
});

test('credito de devolucao: acha o credito pelo nome do CADASTRO do cliente e baixa o saldo', async () => {
  // O credito e' gravado pela devolucao so' com clienteNome (sem clienteId).
  const creditos = {
    'creditos_cliente/devolucao_d1': { tenantId: 'loja', clienteNome: 'MARIA', status: 'disponivel', saldoDisponivel: 15, valorOriginal: 15 },
    'creditos_cliente/devolucao_d2': { tenantId: 'loja', clienteNome: 'JOAO', status: 'disponivel', saldoDisponivel: 50, valorOriginal: 50 },
    'creditos_cliente/devolucao_d3': { tenantId: 'loja', clienteNome: 'MARIA', status: 'esgotado', saldoDisponivel: 0, valorOriginal: 30 },
  };
  const fake = criarBancoFalso(base(creditos), { consultas: true });
  const pagamentos = [pagamento({ forma: 'Crédito de Devolução', valor: '10' }), pagamento({ id: 'pg2', valor: '10' })];
  await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos }) });
  const usado = fake.ler('creditos_cliente/devolucao_d1');
  assert.equal(usado.saldoDisponivelCentavos, 500, 'R$ 15,00 - R$ 10,00');
  assert.equal(usado.status, 'usado_parcial');
  assert.equal(fake.ler('creditos_cliente/devolucao_d2').saldoDisponivel, 50, 'credito de outro cliente fica intacto');
});

test('credito de devolucao: trocar o nome na tela nao gasta o credito de outro cliente', async () => {
  const fake = criarBancoFalso(base({
    'creditos_cliente/devolucao_d2': { tenantId: 'loja', clienteNome: 'JOAO', status: 'disponivel', saldoDisponivel: 50, valorOriginal: 50 },
  }), { consultas: true });
  const pagamentos = [pagamento({ forma: 'Crédito de Devolução', valor: '20' })];
  await assert.rejects(
    () => carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ clienteNome: 'JOAO', pagamentos }) }),
    (erro) => erro.status === 409,
  );
  assert.equal(fake.ler('creditos_cliente/devolucao_d2').saldoDisponivel, 50);
});

// ------------------------------------------------------------------ Cashback como pagamento (fase 2, 20/10/2026)

const loteDeCashback = (extra = {}) => ({
  tenantId: 'loja', clienteId: 'cli1', tipo: 'gerado', modelo: 'reais', centavos: 400, pontos: 0, restanteCentavos: 400, restantePontos: 0,
  usadoCentavos: 0, usadoPontos: 0, validade: null, estornado: false, ...extra,
});
const configComCashback = { tenantId: 'loja', cashback: { ativo: true, modelo: 'reais', tipoPadrao: 'percentual', valorPadrao: 5 } };

test('cashback como pagamento: confere o saldo do cliente, consome os lotes (vence antes sai antes) e grava o uso', async () => {
  const fake = criarBancoFalso(base({
    'configuracoes/loja': configComCashback,
    'cashback_movimentos/gerado_a': loteDeCashback(),
    'cashback_movimentos/gerado_b': loteDeCashback({ centavos: 500, restanteCentavos: 500, validade: '2026-12-31' }),
  }), { consultas: true });
  const pagamentos = [pagamento({ forma: 'Cashback', valor: '7' }), pagamento({ id: 'pg2', valor: '13' })];
  await carregar(fake.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos }) });
  // R$ 7,00: primeiro o lote que vence (b, 500), depois o sem validade (a, 200).
  assert.equal(fake.ler('cashback_movimentos/gerado_b').restanteCentavos, 0);
  assert.equal(fake.ler('cashback_movimentos/gerado_b').usadoCentavos, 500);
  assert.equal(fake.ler('cashback_movimentos/gerado_a').restanteCentavos, 200);
  const uso = fake.ler('cashback_movimentos/usado_venda1');
  assert.equal(uso.tipo, 'usado');
  assert.equal(uso.centavos, 700);
  assert.deepEqual(uso.porLote.map((c) => [c.id, c.centavos]), [['gerado_b', 500], ['gerado_a', 200]]);
  assert.equal(fake.ler('clientes/cli1').cashback.saldoCentavos, 200);
  const titulo = fake.ler('transacoes/venda1');
  assert.equal(titulo.formaPagamento, 'Cashback');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.naturezaFinanceira, 'credito_cliente');
  assert.equal(titulo.movimentaCaixaFisico, false);
  assert.equal(fake.ler('pedidos_venda/venda1').totalRecebidoCentavos, 2000);
});

test('cashback como pagamento: acima do saldo, sem cliente ou desligado recusa sem gravar; pontos consomem a faixa', async () => {
  const docs = { 'configuracoes/loja': configComCashback, 'cashback_movimentos/gerado_a': loteDeCashback() };
  const comCashback = (valor) => [pagamento({ forma: 'Cashback', valor }), pagamento({ id: 'pg2', valor: String(20 - Number(valor)) })];
  const acima = criarBancoFalso(base(docs), { consultas: true });
  await assert.rejects(
    () => carregar(acima.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: comCashback('5') }) }),
    (erro) => erro.status === 409 && /4,00/.test(erro.message),
  );
  assert.equal(acima.ler('pedidos_venda/venda1'), undefined, 'nada gravado');
  assert.equal(acima.ler('cashback_movimentos/gerado_a').restanteCentavos, 400);
  const semCliente = criarBancoFalso(base(docs), { consultas: true });
  await assert.rejects(
    () => carregar(semCliente.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ clienteId: null, clienteNome: 'CONSUMIDOR FINAL', pagamentos: comCashback('4') }) }),
    (erro) => erro.status === 400 && /cliente cadastrado/.test(erro.message),
  );
  const desligado = criarBancoFalso(base({ ...docs, 'configuracoes/loja': { tenantId: 'loja' } }), { consultas: true });
  await assert.rejects(
    () => carregar(desligado.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: comCashback('4') }) }),
    (erro) => erro.status === 409 && /desligado/.test(erro.message),
  );
  // Pontos: 300 pontos = 15% de R$ 20,00 = R$ 3,00; o valor tem de ser exatamente esse.
  const pontos = () => criarBancoFalso(base({
    'configuracoes/loja': { tenantId: 'loja', cashback: { ativo: true, modelo: 'pontos', pontosPorReal: 1, faixas: [{ pontos: 100, descontoPercentual: 5 }, { pontos: 300, descontoPercentual: 15 }] } },
    'cashback_movimentos/gerado_p': loteDeCashback({ modelo: 'pontos', centavos: 0, pontos: 350, restanteCentavos: 0, restantePontos: 350 }),
  }), { consultas: true });
  const errado = pontos();
  await assert.rejects(
    () => carregar(errado.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: comCashback('2.5') }) }),
    (erro) => erro.status === 409 && /faixa/.test(erro.message),
  );
  const certo = pontos();
  await carregar(certo.db).finalizarVenda({ user: VENDEDOR, tenantId: 'loja', corpo: corpo({ pagamentos: comCashback('3') }) });
  assert.equal(certo.ler('cashback_movimentos/gerado_p').restantePontos, 50);
  assert.equal(certo.ler('cashback_movimentos/usado_venda1').pontos, 300);
  assert.equal(certo.ler('clientes/cli1').cashback.saldoPontos, 50);
});

// ------------------------------------------------------------------ PDV (fatia 3c, 19/10/2026)

const OPERADOR = { uid: 'vend1', tenantId: 'loja', email: 'v@loja', permissoes: ['vendas.pdv'] };
const caixaAberto = { 'caixas_pdv/cx1': { tenantId: 'loja', operadorId: 'vend1', status: 'aberto', saldoInicialCentavos: 0 } };

test('PDV: venda com o caixa aberto leva origem PDV e a sessao do caixa na venda e nos lancamentos; fora da conferencia', async () => {
  const fake = criarBancoFalso(base({ ...caixaAberto, 'configuracoes/loja': { tenantId: 'loja', conferenciaMercadoria: true } }), { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: OPERADOR, tenantId: 'loja', corpo: corpo({ pdvSessionId: 'cx1' }) });
  assert.equal(r.pdv, true);
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.origem, 'pdv');
  assert.equal(pedido.sourceOrigin, 'pdv');
  assert.equal(pedido.pdvSessionId, 'cx1');
  assert.equal(pedido.statusConferencia, undefined, 'balcao nao entra na fila de conferencia');
  const titulo = fake.ler('transacoes/venda1');
  assert.equal(titulo.pdvSessionId, 'cx1');
  assert.equal(titulo.sourceOrigin, 'pdv');
  assert.match(titulo.descricao, /^PDV #0001 - Dinheiro/);
  assert.equal(titulo.idempotencyKey, 'pdv:venda1:pagamento:1');
  assert.equal(titulo.movimentaCaixaFisico, true);
});

test('PDV: caixa fechado, de outro operador ou inexistente recusa sem gravar nada', async () => {
  const fechado = criarBancoFalso(base({ 'caixas_pdv/cx1': { tenantId: 'loja', operadorId: 'vend1', status: 'fechado' } }), { consultas: true });
  await assert.rejects(
    () => carregar(fechado.db).finalizarVenda({ user: OPERADOR, tenantId: 'loja', corpo: corpo({ pdvSessionId: 'cx1' }) }),
    (erro) => erro.status === 409 && /já foi fechado/.test(erro.message),
  );
  assert.equal(fechado.ler('pedidos_venda/venda1'), undefined);
  assert.equal(fechado.ler('estoque/p1').quantidade, 10);

  const deOutro = criarBancoFalso(base({ 'caixas_pdv/cx1': { tenantId: 'loja', operadorId: 'outro', status: 'aberto' } }), { consultas: true });
  await assert.rejects(
    () => carregar(deOutro.db).finalizarVenda({ user: OPERADOR, tenantId: 'loja', corpo: corpo({ pdvSessionId: 'cx1' }) }),
    (erro) => erro.status === 403 && /outro operador/.test(erro.message),
  );

  const semCaixa = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(semCaixa.db).finalizarVenda({ user: OPERADOR, tenantId: 'loja', corpo: corpo({ pdvSessionId: 'cx1' }) }),
    (erro) => erro.status === 404,
  );
});

test('total arredondado por linha (kg): duas linhas fracionadas fecham com o valor que o PDV mostra', async () => {
  // 0,355 kg x R$ 12,90 = 4,5795 -> R$ 4,58 por linha; duas linhas = R$ 9,16 (somando sem arredondar daria R$ 9,16 tambem
  // aqui, entao usa um caso que diverge: 3 x 0,005 kg x R$ 1,00 = 0,005 cada -> 0,01 por linha = R$ 0,03; sem arredondar = R$ 0,02).
  const itens = [1, 2, 3].map((n) => ({ id: 'p1', nome: `RAÇÃO ${n}`, precoUnitario: 1, quantidade: 0.005, desconto: 0, subtotal: 0.01 }));
  const fake = criarBancoFalso(base({ ...caixaAberto, 'configuracoes/loja': { tenantId: 'loja', venderSemEstoque: true } }), { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: OPERADOR, tenantId: 'loja', corpo: corpo({ pdvSessionId: 'cx1', itens, pagamentos: [pagamento({ valor: '0.03' })] }) });
  assert.equal(r.totalCentavos, 3);
});

// Bonificacao (30/10/2026): item de brinde vai a preco zero, baixa o estoque e fica fora do total e da comissao.
const comBrinde = (extra = {}) => corpo({
  itens: [
    { id: 'p1', nome: 'RAÇÃO', precoUnitario: 10, quantidade: 2, desconto: 0, subtotal: 20 },
    // A tela manda preco 7 por engano: o servidor zera (bonificado nunca leva preco).
    { id: 'p2', nome: 'PETISCO', precoUnitario: 7, quantidade: 1, desconto: 0, subtotal: 7, bonificado: true, precoReferencia: 1.5 },
  ],
  ...extra,
});
const baseComBrinde = (config = { ativa: true, limitePercentual: 10 }, extra = {}) => base({
  'configuracoes/loja': { tenantId: 'loja', bonificacao: config },
  'estoque/p2': { tenantId: 'loja', nome: 'PETISCO', quantidade: 5, quantidadeReservada: 0, precoVenda: 1.5 },
  ...extra,
});
const BONIFICA = { ...VENDEDOR, permissoes: ['vendas.pedidos', 'vendas.bonificar'] };

test('bonificacao: brinde baixa o estoque, sai a zero do total e da comissao, e a venda grava o valor dele', async () => {
  const fake = criarBancoFalso(baseComBrinde(), { consultas: true });
  const r = await carregar(fake.db).finalizarVenda({ user: BONIFICA, tenantId: 'loja', corpo: comBrinde() });
  assert.equal(r.totalCentavos, 2000);
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.itens[1].precoUnitario, 0);
  assert.equal(pedido.itens[1].subtotal, 0);
  assert.equal(pedido.itens[1].bonificado, true);
  assert.equal(pedido.itens[1].precoReferencia, 1.5);
  assert.deepEqual(pedido.bonificacao, { valorCentavos: 150, percentual: 7.5 });
  assert.equal(pedido.comissao.valorOriginalCentavos, 100, 'comissao so\' da parte vendida');
  assert.equal(fake.ler('estoque/p2').quantidade, 4);
});

test('bonificacao: desligada, sem permissao, so\' brinde ou acima do limite sem quem aprova desconto recusa sem gravar', async () => {
  const casos = [
    { banco: baseComBrinde({ ativa: false }), user: BONIFICA, corpo: comBrinde(), msg: /não trabalha com bonificação/ },
    { banco: baseComBrinde(), user: VENDEDOR, corpo: comBrinde(), msg: /Pode bonificar/ },
    {
      banco: baseComBrinde(),
      user: BONIFICA,
      corpo: comBrinde({ itens: [{ id: 'p2', nome: 'PETISCO', precoUnitario: 0, quantidade: 1, desconto: 0, subtotal: 0, bonificado: true, precoReferencia: 1.5 }], pagamentos: [pagamento({ valor: '0' })] }),
      msg: /só tem itens bonificados/,
    },
    { banco: baseComBrinde({ ativa: true, limitePercentual: 5 }), user: BONIFICA, corpo: comBrinde(), msg: /passa do limite/ },
  ];
  for (const caso of casos) {
    const fake = criarBancoFalso(caso.banco, { consultas: true });
    await assert.rejects(carregar(fake.db).finalizarVenda({ user: caso.user, tenantId: 'loja', corpo: caso.corpo }), (e) => caso.msg.test(e.message) && e.status === 409);
    assert.equal(fake.ler('pedidos_venda/venda1'), undefined);
    assert.equal(fake.ler('estoque/p2').quantidade, 5);
  }
});

test('bonificacao: vendedor da venda pode bonificar (pedido do app) e quem aprova desconto fatura acima do limite', async () => {
  const fake = criarBancoFalso(baseComBrinde({ ativa: true, limitePercentual: 5 }, {
    'usuarios/vend1': { tenantId: 'loja', nome: 'VENDEDOR UM', permissoes: ['vendas.bonificar'] },
  }), { consultas: true });
  const APROVA = { ...FATURISTA, permissoes: ['vendas.pre_venda_finalizar', 'vendas.liberar_desconto'], nome: 'GERENTE' };
  await carregar(fake.db).finalizarVenda({ user: APROVA, tenantId: 'loja', corpo: comBrinde() });
  const pedido = fake.ler('pedidos_venda/venda1');
  assert.equal(pedido.bonificacao.liberadaPorId, 'fat1');
  assert.equal(pedido.bonificacao.liberadaPorNome, 'GERENTE');
});
