const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Ver os creditos e de onde vem cada um (26/11/2026): Contas a Receber (credito
 * do cliente) e Contas a Pagar (o que o fornecedor deve).
 */

const T = 'emp1';
const servico = (db) => carregarComBancoFalso(db, 'services/creditosConsulta')[3];

const base = () => ({
  'creditos_cliente/devolucao_D1': { tenantId: T, clienteId: 'c1', clienteNome: 'JOAO', devolucaoId: 'D1', pedidoOrigemId: 'P1', numeroPedidoOriginal: '0010', valorOriginal: 50, saldoDisponivel: 20, saldoDisponivelCentavos: 2000, status: 'usado_parcial', motivo: 'Troca', ultimaAlteracao: 'Crédito usado na venda #0020' },
  'creditos_cliente/devolucao_D2-sp': { tenantId: T, clienteId: 'c1', clienteNome: 'JOAO', devolucaoId: 'D2-sp', pedidoOrigemId: '', numeroPedidoOriginal: '', valorOriginal: 30, saldoDisponivel: 30, saldoDisponivelCentavos: 3000, status: 'disponivel' },
  'creditos_cliente/cancelamento_P9': { tenantId: T, clienteNome: 'JOAO', pedidoOrigemId: 'P9', numeroPedidoOriginal: '0009', valorOriginal: 15, saldoDisponivel: 0, saldoDisponivelCentavos: 0, status: 'esgotado', origem: 'cancelamento_venda' },
  'creditos_cliente/devolucao_D3': { tenantId: T, clienteId: 'c1', clienteNome: 'JOAO', devolucaoId: 'D3', pedidoOrigemId: 'P3', numeroPedidoOriginal: '0011', valorOriginal: 10, saldoDisponivel: 0, saldoDisponivelCentavos: 0, status: 'cancelado' },
  'creditos_cliente/devolucao_X': { tenantId: T, clienteId: 'c2', clienteNome: 'MARIA', devolucaoId: 'X', valorOriginal: 99, saldoDisponivel: 99, status: 'disponivel' },
  'creditos_cliente/devolucao_Y': { tenantId: 'outra', clienteId: 'c1', clienteNome: 'JOAO', valorOriginal: 1, saldoDisponivel: 1, status: 'disponivel' },
  'devolucoes_venda/D2-sp': { tenantId: T, semPedido: true, motivo: 'Produto com defeito' },
  'transacoes/V20': { tenantId: T, tipo: 'entrada', status: 'Paga', formaPagamento: 'Crédito de Devolução', clienteId: 'c1', clienteNome: 'JOAO', descricao: 'Venda Direta #0020 - Crédito de Devolução', valorCentavos: 3000, dataPagamento: '2026-11-20', pedidoId: 'P20' },
  'transacoes/F1': { tenantId: T, tipo: 'entrada', status: 'Pendente', fornecedorId: 'f1', fornecedorNome: 'EMBALAGENS SUL', descricao: 'DEVOLUÇÃO DE COMPRA NF 123', valorCentavos: 4500, devolucaoCompraId: 'DC1', origemLancamento: 'devolucao_compra', notaEntradaId: 'N1' },
  'transacoes/F2': { tenantId: T, tipo: 'entrada', status: 'Paga', fornecedorId: 'f1', descricao: 'Bonificação combinada', valorCentavos: 1000, dataPagamento: '2026-11-01', formaPagamento: 'Pix', origemLancamento: 'manual' },
  'transacoes/F5': { tenantId: T, tipo: 'entrada', status: 'Pendente', fornecedorId: 'f1', descricao: 'Lançada à mão em aberto', valorCentavos: 500, origemLancamento: 'manual' },
  'transacoes/F3': { tenantId: T, tipo: 'entrada', status: 'Cancelada', fornecedorId: 'f1', valorCentavos: 777 },
  'transacoes/F4': { tenantId: T, tipo: 'saida', status: 'Pendente', fornecedorId: 'f1', valorCentavos: 9999 },
});

test('creditos do cliente: origem pelo numero que o usuario conhece, usado e saldo', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await servico(fake.db).creditosDoCliente({ tenantId: T, clienteId: 'c1', clienteNome: 'JOAO' });
  const porId = Object.fromEntries(r.creditos.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(porId).sort(), ['cancelamento_P9', 'devolucao_D1', 'devolucao_D2-sp', 'devolucao_D3']);
  assert.equal(porId.devolucao_D1.documento, 'Devolução do pedido #0010');
  assert.equal(porId.devolucao_D1.usadoCentavos, 3000);
  assert.equal(porId.devolucao_D1.saldoCentavos, 2000);
  assert.equal(porId.devolucao_D1.ultimaMovimentacao, 'Crédito usado na venda #0020');
  assert.equal(porId['devolucao_D2-sp'].tipo, 'devolucao_sem_pedido');
  assert.equal(porId['devolucao_D2-sp'].motivo, 'Produto com defeito');
  assert.equal(porId.cancelamento_P9.documento, 'Venda #0009 cancelada (o crédito usado nela voltou)');
  assert.equal(porId.devolucao_D3.statusRotulo, 'Cancelado (devolução estornada)');
  assert.equal(porId.devolucao_D3.usadoCentavos, 0, 'cancelado nao conta como usado');
  assert.equal(r.saldoCentavos, 5000);
  assert.equal(r.creditos[0].saldoCentavos > 0, true, 'abertos primeiro');
  assert.equal(r.usos.length, 1);
  assert.equal(r.usos[0].descricao, 'Venda Direta #0020 - Crédito de Devolução');
});

test('saldo de cada cliente: so credito em aberto, desta empresa', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const r = await servico(fake.db).saldosDosClientes({ tenantId: T });
  const joao = r.clientes.find((c) => c.clienteId === 'c1');
  assert.equal(joao.saldoCentavos, 5000);
  assert.equal(joao.quantidade, 2);
  assert.equal(r.clientes.find((c) => c.clienteId === 'c2').saldoCentavos, 9900);
});

test('fornecedor: o que ele deve a empresa, com a origem; cancelada e despesa ficam de fora', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = servico(fake.db);
  const r = await s.contasDoFornecedor({ tenantId: T, fornecedorId: 'f1' });
  assert.deepEqual(r.contas.map((c) => c.id), ['F1', 'F5', 'F2']);
  assert.equal(r.contas[0].rotulo, 'Devolução ao fornecedor');
  assert.equal(r.contas[0].statusRotulo, 'A receber');
  assert.equal(r.contas[2].rotulo, 'Lançada à mão');
  assert.equal(r.contas[2].formaRecebimento, 'Pix');
  assert.equal(r.saldoCentavos, 5000);
  const resumo = await s.saldosDosFornecedores({ tenantId: T });
  assert.deepEqual(resumo.fornecedores, [{ fornecedorId: 'f1', fornecedorNome: 'EMBALAGENS SUL', saldoCentavos: 5000, quantidade: 2 }]);
  assert.deepEqual(await s.contasDoFornecedor({ tenantId: T, fornecedorId: '' }), { contas: [], saldoCentavos: 0 });
});
