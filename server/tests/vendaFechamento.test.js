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
