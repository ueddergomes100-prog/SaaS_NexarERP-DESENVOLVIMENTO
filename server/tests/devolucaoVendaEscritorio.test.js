const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Devolucao pelo escritorio, no servidor (25/11/2026, Embala Minas): itens de
 * varios pedidos numa devolucao, sem pedido (so' credito, preco do cadastro),
 * e o destino do valor escolhido ao confirmar (credito, caixa, banco ou abater
 * das parcelas em aberto do cliente).
 */

const HOJE = '2026-11-25';
const T = 'emp1';
const ESCRITORIO = { uid: 'u1', email: 'ana@loja', nome: 'ANA', tenantId: T, permissoes: ['vendas.devolucao'] };
const DONO = { uid: 'dono', email: 'dono@loja', nome: 'DONO', tenantId: T, permissoes: [], isTenantManager: true };
const comPermissoes = (...p) => ({ ...ESCRITORIO, permissoes: ['vendas.devolucao', ...p] });

const servico = (db) => carregarComBancoFalso(db, 'services/renegociacaoOrigem', 'services/auditoria', 'services/devolucaoVenda', 'services/devolucaoVendaEscritorio')[6];
const servicoApp = (db) => carregarComBancoFalso(db, 'services/renegociacaoOrigem', 'services/auditoria', 'services/devolucaoVenda')[5];

const pedido = (numero, itens, extra = {}) => ({
  tenantId: T, numeroPedido: numero, clienteId: 'c1', clienteNome: 'JOAO BATISTA PEREIRA', status: 'Finalizada', dataVenda: '2026-11-20',
  vendedorId: 'v1', vendedorNome: 'CARLOS', itens, ...extra,
});

const base = (extra = {}) => ({
  'configuracoes/emp1': {},
  'clientes/c1': { tenantId: T, nome: 'JOAO BATISTA PEREIRA' },
  'pedidos_venda/P1': pedido('0010', [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidade: 5, desconto: 0 }]),
  'pedidos_venda/P2': pedido('0011', [{ id: 'p2', nome: 'CAIXA 12', precoUnitario: 50, quantidade: 2, desconto: 0 }, { id: 'p1', nome: 'FITA', precoUnitario: 9, quantidade: 3, desconto: 0 }]),
  'estoque/p1': { tenantId: T, nome: 'FITA', quantidade: 100, precoVenda: 11 },
  'estoque/p2': { tenantId: T, nome: 'CAIXA 12', quantidade: 10, precoVenda: 55 },
  'estoque/p3': { tenantId: T, nome: 'SACO 50', quantidade: 0, precoVenda: 7.5, unidadeMedidaSigla: 'UN' },
  'bancos/b1': { tenantId: T, nome: 'SICOOB', ativo: true, saldoCentavos: 100000 },
  ...extra,
});

const corpo = (extra = {}) => ({
  idDocumento: 'dev2511aa01',
  clienteId: 'c1',
  clienteNome: 'JOAO BATISTA PEREIRA',
  pedidos: [{ pedidoId: 'P1', itens: [{ indice: 0, quantidade: 2 }] }, { pedidoId: 'P2', itens: [{ indice: 0, quantidade: 1 }] }],
  semPedido: [],
  motivo: 'Produto com defeito',
  observacao: '',
  destino: { tipo: 'credito' },
  ...extra,
});

const semUndefined = (obj) => JSON.stringify(obj, (k, v) => { if (v === undefined) throw new Error(`undefined em ${k}`); return v; });

test('itens de DOIS pedidos numa devolucao: uma devolucao por pedido, cada uma com os itens dela, e credito', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await servico(fake.db).registrarNoSistema({ user: ESCRITORIO, tenantId: T, corpo: corpo(), hoje: HOJE });
  assert.equal(r.devolucoes.length, 2);
  const d1 = fake.ler('devolucoes_venda/dev2511aa01-p1');
  const d2 = fake.ler('devolucoes_venda/dev2511aa01-p2');
  assert.equal(d1.pedidoVendaId, 'P1');
  assert.equal(d1.valorTotalDevolvido, 20);
  assert.equal(d2.pedidoVendaId, 'P2');
  assert.equal(d2.itensDevolvidos[0].nome, 'CAIXA 12');
  assert.equal(d1.status, 'concluida');
  assert.deepEqual(d1.devolucoesDoGrupo, ['dev2511aa01-p1', 'dev2511aa01-p2']);
  semUndefined(d1);
  assert.equal(fake.ler('estoque/p1').quantidade, 102);
  assert.equal(fake.ler('estoque/p2').quantidade, 11);
  assert.equal(fake.ler('pedidos_venda/P1').itens[0].quantidadeJaDevolvida, 2);
  assert.equal(fake.ler('creditos_cliente/devolucao_dev2511aa01-p1').saldoDisponivel, 20);
  assert.equal(fake.ler('creditos_cliente/devolucao_dev2511aa01-p2').clienteId, 'c1');
  assert.equal(fake.ler('creditos_cliente/devolucao_dev2511aa01-p2').status, 'disponivel');

  // Reenviar o mesmo envio (queda de rede) nao duplica.
  const de2 = await servico(fake.db).registrarNoSistema({ user: ESCRITORIO, tenantId: T, corpo: corpo(), hoje: HOJE });
  assert.equal(de2.jaEnviada, true);
  assert.equal(fake.ler('estoque/p1').quantidade, 102);
});

test('sem pedido: permissao propria, preco do cadastro, so credito; mudar o preco so com a permissao', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = servico(fake.db);
  const sp = { pedidos: [], semPedido: [{ produtoId: 'p3', quantidade: 4 }] };
  await assert.rejects(s.registrarNoSistema({ user: ESCRITORIO, tenantId: T, corpo: corpo(sp), hoje: HOJE }), /Devolução sem pedido/);
  await assert.rejects(
    s.registrarNoSistema({ user: comPermissoes('vendas.devolucao_sem_pedido'), tenantId: T, corpo: corpo({ ...sp, semPedido: [{ produtoId: 'p3', quantidade: 4, precoUnitario: 9 }] }), hoje: HOJE }),
    (e) => e.status === 403 && /alterar o preço/.test(e.message),
  );
  await assert.rejects(
    s.registrarNoSistema({ user: comPermissoes('vendas.devolucao_sem_pedido'), tenantId: T, corpo: corpo({ ...sp, destino: { tipo: 'caixa' } }), hoje: HOJE }),
    /só gera crédito/,
  );
  const r = await s.registrarNoSistema({ user: comPermissoes('vendas.devolucao_sem_pedido'), tenantId: T, corpo: corpo(sp), hoje: HOJE });
  assert.equal(r.valorTotal, 30);
  const d = fake.ler('devolucoes_venda/dev2511aa01-sp');
  assert.equal(d.semPedido, true);
  assert.equal(d.pedidoVendaId, '');
  assert.equal(d.itensDevolvidos[0].precoUnitario, 7.5);
  semUndefined(d);
  assert.equal(fake.ler('estoque/p3').quantidade, 4);
  const credito = fake.ler('creditos_cliente/devolucao_dev2511aa01-sp');
  assert.equal(credito.saldoDisponivel, 30);
  assert.equal(credito.clienteId, 'c1');

  // Dono muda o preco.
  const fake2 = criarBancoFalso(base(), { consultas: true });
  await servico(fake2.db).registrarNoSistema({ user: DONO, tenantId: T, corpo: corpo({ ...sp, semPedido: [{ produtoId: 'p3', quantidade: 2, precoUnitario: 9 }] }), hoje: HOJE });
  assert.equal(fake2.ler('devolucoes_venda/dev2511aa01-sp').valorTotalDevolvido, 18);
  assert.equal(fake2.ler('devolucoes_venda/dev2511aa01-sp').precoAlteradoPorId, 'dono');
});

const parcelas = {
  'transacoes/T1': { tenantId: T, tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #0009 - 1/2', valor: 15, valorCentavos: 1500, clienteId: 'c1', clienteNome: 'JOAO BATISTA PEREIRA', dataVencimento: '2026-11-01', formaPagamento: 'Boleto', pedidoId: 'P9', paymentIndex: 0 },
  'transacoes/T2': { tenantId: T, tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #0009 - 2/2', valor: 40, valorCentavos: 4000, clienteId: 'c1', clienteNome: 'JOAO BATISTA PEREIRA', dataVencimento: '2026-12-01', formaPagamento: 'Boleto', pedidoId: 'P9', paymentIndex: 1 },
  'transacoes/TX': { tenantId: T, tipo: 'entrada', status: 'Pendente', descricao: 'Outro cliente', valor: 10, valorCentavos: 1000, clienteId: 'c2', clienteNome: 'MARIA' },
  'pedidos_venda/P9': pedido('0009', [{ id: 'p1', nome: 'FITA', precoUnitario: 55, quantidade: 1, desconto: 0 }], {
    pagamentos: [
      { id: 'pg0', indice: 0, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valor: 15, valorCentavos: 1500, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 'T1' },
      { id: 'pg1', indice: 1, formaPagamento: 'Boleto', condicaoPagamento: 'aprazo', valor: 40, valorCentavos: 4000, status: 'pendente', naturezaFinanceira: 'boleto', movimentaCaixaFisico: false, transactionId: 'T2' },
    ],
  }),
};

test('abater das parcelas: quita a primeira, abate o resto na segunda, credito ja nasce usado', async () => {
  const fake = criarBancoFalso(base(parcelas), { consultas: true });
  const s = servico(fake.db);
  const destino = { tipo: 'abater', parcelas: ['T1', 'T2'] };
  await assert.rejects(s.registrarNoSistema({ user: ESCRITORIO, tenantId: T, corpo: corpo({ destino }), hoje: HOJE }), (e) => e.status === 403);

  const r = await s.registrarNoSistema({ user: comPermissoes('vendas.devolucao_abater_parcelas'), tenantId: T, corpo: corpo({ destino }), hoje: HOJE });
  // 20 (P1) + 50 (P2) = 70: quita T1 (15) e abate 40 de T2 (fica 0? nao: T2 = 40, entao quita tambem) -> sobra 15.
  assert.equal(r.valorTotal, 70);
  assert.equal(fake.ler('transacoes/T1').status, 'Paga');
  assert.equal(fake.ler('transacoes/T1').formaPagamento, 'Crédito de Devolução');
  assert.equal(fake.ler('transacoes/T2').status, 'Paga');
  assert.equal(r.sobraDeCreditoCentavos, 1500);
  const c1 = fake.ler('creditos_cliente/devolucao_dev2511aa01-p1');
  const c2 = fake.ler('creditos_cliente/devolucao_dev2511aa01-p2');
  assert.equal(c1.status, 'esgotado');
  assert.equal(c1.abatimentos.length, 2, 'o primeiro credito guarda onde o valor foi usado');
  assert.equal(c2.saldoDisponivelCentavos, 1500);
  assert.equal(c2.status, 'usado_parcial');
  const venda = fake.ler('pedidos_venda/P9');
  assert.equal(venda.statusPagamento, 'Paga');
  semUndefined(fake.ler('transacoes/T1'));
});

test('abater: parcela fica com o resto em aberto, com o recibo do abatimento; outro cliente e cartao recusados', async () => {
  const fake = criarBancoFalso(base(parcelas), { consultas: true });
  const s = servico(fake.db);
  const user = comPermissoes('vendas.devolucao_abater_parcelas');
  const so1 = corpo({ pedidos: [{ pedidoId: 'P1', itens: [{ indice: 0, quantidade: 3 }] }], destino: { tipo: 'abater', parcelas: ['T2'] } });
  await s.registrarNoSistema({ user, tenantId: T, corpo: so1, hoje: HOJE });
  const t2 = fake.ler('transacoes/T2');
  assert.equal(t2.status, 'Pendente');
  assert.equal(t2.valorCentavos, 1000);
  const recibos = fake.listar('transacoes/').filter((v) => v.sourcePaymentTransactionId === 'T2');
  assert.equal(recibos.length, 1);
  assert.equal(recibos[0].valorCentavos, 3000);
  assert.equal(fake.ler('pedidos_venda/P9').statusPagamento, 'Parcial');

  const outro = criarBancoFalso(base(parcelas), { consultas: true });
  await assert.rejects(
    servico(outro.db).registrarNoSistema({ user, tenantId: T, corpo: corpo({ destino: { tipo: 'abater', parcelas: ['TX'] } }), hoje: HOJE }),
    /outro cliente/,
  );
  const cartao = criarBancoFalso(base({ ...parcelas, 'transacoes/T1': { ...parcelas['transacoes/T1'], formaPagamento: 'Cartão de Crédito' } }), { consultas: true });
  await assert.rejects(
    servico(cartao.db).registrarNoSistema({ user, tenantId: T, corpo: corpo({ destino: { tipo: 'abater', parcelas: ['T1'] } }), hoje: HOJE }),
    /operadora/,
  );
});

test('janela: parcelas em aberto do cliente (sem cartao, sem outro cliente), mais antigas primeiro', async () => {
  const fake = criarBancoFalso(base({ ...parcelas, 'transacoes/T3': { ...parcelas['transacoes/T1'], formaPagamento: 'Cartão de Débito' } }), { consultas: true });
  const r = await servico(fake.db).opcoesDoValor({ user: ESCRITORIO, tenantId: T, clienteId: 'c1', clienteNome: 'JOAO BATISTA PEREIRA' });
  assert.deepEqual(r.parcelas.map((p) => p.id), ['T1', 'T2']);
  assert.equal(r.bancos[0].nome, 'SICOOB');
  assert.equal(r.podeAbater, false);
});

test('confirmar a devolucao do app escolhendo o banco: sai do banco, situacao Confirmada', async () => {
  const fake = criarBancoFalso(base({
    'devolucoes_venda/D1': {
      tenantId: T, status: 'aguardando_confirmacao', origem: 'app', pedidoVendaId: 'P1', numeroPedidoOriginal: '0010', clienteNome: 'JOAO BATISTA PEREIRA',
      valorTotalDevolvido: 20, destinoValor: 'credito', destinoDoVendedor: false, motivo: 'Troca', vendedorId: 'v1',
      itensDevolvidos: [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidadeDevolvida: 2, descontoProporcional: 0, subtotal: 20, indice: 0 }],
    },
  }), { consultas: true });
  const s = servico(fake.db);
  const r = await s.confirmarDoApp({ user: ESCRITORIO, tenantId: T, devolucaoId: 'D1', corpo: { destino: { tipo: 'banco', bancoId: 'b1', formaBancaria: 'Pix' } }, hoje: HOJE });
  assert.equal(r.destino, 'banco');
  const d = fake.ler('devolucoes_venda/D1');
  assert.equal(d.status, 'concluida');
  assert.equal(d.destinoValor, 'banco');
  assert.equal(d.bancoNome, 'SICOOB');
  assert.equal(d.destinoPedidoPeloApp, 'credito');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 98000);
  assert.equal(fake.ler('transacoes/devolucao_D1').tipo, 'saida');
  assert.equal(fake.ler('estoque/p1').quantidade, 102);
  assert.equal(fake.listar('creditos_cliente/').length, 0);
  await assert.rejects(s.confirmarDoApp({ user: ESCRITORIO, tenantId: T, devolucaoId: 'D1', corpo: { destino: { tipo: 'credito' } }, hoje: HOJE }), /Confirmada/);
});

test('app: sem a permissao o destino que vier vira credito; com ela vale o escolhido', async () => {
  const ID_APP = '0123456789abcdef0123456789abcdef';
  const VENDEDOR = { uid: 'v1', email: 'v1@app', nome: 'CARLOS', tenantId: T, permissoes: [] };
  const dados = base({
    'configuracoes/emp1': { appDevolucaoPermitida: true },
    [`pedidos_venda/${ID_APP}`]: pedido('0020', [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidade: 5, desconto: 0 }], { criadoPor: 'v1' }),
  });
  const pedidoDoApp = (extra) => ({ pedidoId: ID_APP, itens: [{ indice: 0, quantidade: 1 }], motivo: 'Troca', destino: 'banco', bancoId: 'b1', formaBancaria: 'Pix', ...extra });
  const fake = criarBancoFalso(dados, { consultas: true });
  const app = servicoApp(fake.db);
  assert.equal((await app.dadosParaDevolver({ user: VENDEDOR, tenantId: T, pedidoId: ID_APP, hoje: HOJE })).podeEscolherDestino, false);
  await app.solicitarPeloApp({ user: VENDEDOR, tenantId: T, corpo: pedidoDoApp({ idDocumento: 'appdev0001' }), hoje: HOJE });
  assert.equal(fake.ler('devolucoes_venda/appdev0001').destinoValor, 'credito');
  assert.equal(fake.ler('devolucoes_venda/appdev0001').destinoDoVendedor, false);

  const comChave = { ...VENDEDOR, permissoes: ['app.devolucao_destino'] };
  await app.solicitarPeloApp({ user: comChave, tenantId: T, corpo: pedidoDoApp({ idDocumento: 'appdev0002' }), hoje: HOJE });
  assert.equal(fake.ler('devolucoes_venda/appdev0002').destinoValor, 'banco');
  assert.equal(fake.ler('devolucoes_venda/appdev0002').destinoDoVendedor, undefined);
});

test('devolucao por cliente e produto: so os pedidos faturados do cliente com o produto e o que sobra', async () => {
  const fake = criarBancoFalso(base({
    'pedidos_venda/P3': pedido('0012', [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidade: 1, desconto: 0, quantidadeJaDevolvida: 1 }]),
    'pedidos_venda/P4': pedido('0013', [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidade: 1, desconto: 0 }], { status: 'Cancelada' }),
    'pedidos_venda/P5': pedido('0014', [{ id: 'p1', nome: 'FITA', precoUnitario: 10, quantidade: 1, desconto: 0 }], { clienteId: 'c2' }),
  }), { consultas: true });
  const r = await servico(fake.db).pedidosDoClienteComProdutos({ user: ESCRITORIO, tenantId: T, clienteId: 'c1', produtoIds: ['p1'] });
  assert.deepEqual(r.pedidos.map((p) => p.numeroPedido).sort(), ['0010', '0011']);
  const p2 = r.pedidos.find((p) => p.numeroPedido === '0011');
  assert.deepEqual(p2.linhas.map((l) => l.indice), [1], 'so a linha do produto escolhido');
});

test('sem a permissao de devolucao nada acontece', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    servico(fake.db).registrarNoSistema({ user: { ...ESCRITORIO, permissoes: [] }, tenantId: T, corpo: corpo(), hoje: HOJE }),
    (e) => e.status === 403,
  );
  assert.equal(fake.listar('devolucoes_venda/').length, 0);
});
