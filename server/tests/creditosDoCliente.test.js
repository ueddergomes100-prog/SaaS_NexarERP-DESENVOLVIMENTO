const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso, TS } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db, 'services/creditosDoCliente').pop();

const base = () => ({
  'configuracoes/loja': { tenantId: 'loja', nomeOficina: 'JOMARLY', cnpj: '12.345.678/0001-90' },
  'clientes/c779': { tenantId: 'loja', nome: 'ALGERICO ALCIDES CONCAS' },
  'clientes/c10': { tenantId: 'loja', nome: 'MARIA' },
  'clientes/padrao': { tenantId: 'loja', nome: 'CONSUMIDOR FINAL', isPadrao: true },
  'pedidos_venda/p180': { tenantId: 'loja', numeroPedido: '0180', clienteId: 'c779', clienteNome: 'ALGERICO CONCAS' },
  'pedidos_venda/p50': { tenantId: 'loja', numeroPedido: '0050', clienteId: 'c10', clienteNome: 'MARIA' },
  'pedidos_venda/p60': { tenantId: 'loja', numeroPedido: '0060', clienteId: 'padrao', clienteNome: 'CONSUMIDOR FINAL' },
  'pedidos_venda/p70': { tenantId: 'loja', numeroPedido: '0070', clienteNome: 'AVULSO' },
  // Caso real: cliente renomeado depois do cancelamento -- credito escondido.
  'creditos_cliente/cancelamento_p180': {
    tenantId: 'loja', clienteNome: 'ALGERICO CONCAS', pedidoOrigemId: 'p180', numeroPedidoOriginal: '0180',
    status: 'disponivel', saldoDisponivel: 108, saldoDisponivelCentavos: 10800, valorOriginal: 108,
  },
  // Nome igual ao cadastro: aparece hoje, mas ganha o codigo tambem.
  'creditos_cliente/devolucao_d1': {
    tenantId: 'loja', clienteNome: 'MARIA', pedidoOrigemId: 'p50', numeroPedidoOriginal: '0050', status: 'disponivel', saldoDisponivel: 20, valorOriginal: 20,
  },
  // Ja tem codigo: fica como esta'.
  'creditos_cliente/devolucao_d2': {
    tenantId: 'loja', clienteId: 'c10', clienteNome: 'MARIA', pedidoOrigemId: 'p50', status: 'disponivel', saldoDisponivel: 5, valorOriginal: 5,
  },
  // Consumidor Final e venda sem cliente: nao liga (continua pelo nome).
  'creditos_cliente/devolucao_d3': {
    tenantId: 'loja', clienteNome: 'CONSUMIDOR FINAL', pedidoOrigemId: 'p60', numeroPedidoOriginal: '0060', status: 'disponivel', saldoDisponivel: 7, valorOriginal: 7,
  },
  'creditos_cliente/devolucao_d4': {
    tenantId: 'loja', clienteNome: 'AVULSO', pedidoOrigemId: 'p70', numeroPedidoOriginal: '0070', status: 'disponivel', saldoDisponivel: 9, valorOriginal: 9,
  },
  // Outra empresa: fora.
  'creditos_cliente/alheio': { tenantId: 'outra', clienteNome: 'X', pedidoOrigemId: 'p180', status: 'disponivel', saldoDisponivel: 1 },
});

test('simular: acha o credito escondido pelo nome antigo, sem gravar nada', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await carregar(fake.db).ligarCreditosAoCliente({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(r.empresa, 'JOMARLY');
  assert.equal(r.creditos, 5);
  assert.equal(r.semCodigo, 4);
  assert.equal(r.ligados, 2, 'o do 0180 e o da MARIA');
  assert.equal(r.escondidos, 1);
  assert.equal(r.escondidosCentavos, 10800);
  assert.deepEqual(r.exemplos[0], { numeroPedido: '0180', nomeNoCredito: 'ALGERICO CONCAS', nomeNoCadastro: 'ALGERICO ALCIDES CONCAS', saldoCentavos: 10800, escondido: true });
  assert.deepEqual(r.semComoLigar.map((s) => s.motivo).sort(), ['a venda foi no Consumidor Final', 'a venda foi sem cliente cadastrado']);
  assert.equal(fake.ler('creditos_cliente/cancelamento_p180').clienteId, undefined, 'simular nao grava');
});

test('aplicar: grava so o codigo do cliente; saldo, status e nome ficam como estavam; rodar de novo nao acha nada', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = carregar(fake.db);
  await s.ligarCreditosAoCliente({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: true, usuarioId: 'admin' });
  const credito = fake.ler('creditos_cliente/cancelamento_p180');
  assert.equal(credito.clienteId, 'c779');
  assert.equal(credito.clienteNome, 'ALGERICO CONCAS');
  assert.equal(credito.saldoDisponivelCentavos, 10800);
  assert.equal(credito.status, 'disponivel');
  assert.equal(credito.alteradoPor, 'admin');
  assert.equal(fake.ler('creditos_cliente/devolucao_d1').clienteId, 'c10');
  assert.equal(fake.ler('creditos_cliente/devolucao_d2').alteradoPor, undefined, 'o que ja tinha codigo nao e regravado');
  assert.equal(fake.ler('creditos_cliente/devolucao_d3').clienteId, undefined);
  assert.equal(fake.ler('creditos_cliente/devolucao_d4').clienteId, undefined);
  assert.equal(fake.ler('creditos_cliente/alheio').clienteId, undefined);

  const deNovo = await s.ligarCreditosAoCliente({ db: fake.db, agora: () => TS, tenantId: 'loja', aplicar: false, usuarioId: 'admin' });
  assert.equal(deNovo.ligados, 0);
  assert.equal(deNovo.escondidos, 0);
});

test('empresa que nao existe: erro em portugues com status 404', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  await assert.rejects(
    () => carregar(fake.db).ligarCreditosAoCliente({ db: fake.db, agora: () => TS, tenantId: 'nada', aplicar: false, usuarioId: 'admin' }),
    (e) => e.status === 404 && /Empresa não encontrada/.test(e.message),
  );
});
