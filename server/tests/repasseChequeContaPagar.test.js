const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Cheque de cliente pagando uma conta a pagar de fornecedor (28/11/2026, pedido
 * do dono): em Cheques > Compensar, em vez do banco, escolhe-se uma conta a
 * pagar. O cheque sai "repassado", o titulo do cliente fica pago sem banco, a
 * conta e' paga (inteira ou em parte) e o estorno da conta devolve o cheque.
 */

const HOJE = '2026-11-28';
const T = 'emp1';
const PERMISSAO = 'financeiro.cheque_pagar_conta';
const USUARIO = { uid: 'u1', email: 'ana@loja', nome: 'ANA', tenantId: T, permissoes: ['financeiro.cheques', PERMISSAO, 'financeiro.pagar', 'financeiro.pagar_baixar', 'financeiro.estornar'] };
const carregar = (db) => {
  const [baixa, , , , , repasse] = carregarComBancoFalso(db, 'services/renegociacaoOrigem', 'services/auditoria', 'services/repasseCheques');
  return { baixa, repasse };
};

const cheque = (numero, centavos, extra = {}) => ({
  tenantId: T, tipo: 'entrada', status: 'Pendente', formaPagamento: 'Cheque', descricao: `Pedido #0030 - cheque ${numero}`,
  valor: centavos / 100, valorCentavos: centavos, clienteNome: 'JOAO', naturezaFinanceira: 'contas_receber',
  cheque: { numeroCheque: numero, bancoEmissor: '756', dataCompensacao: '2026-12-10' }, ...extra,
});
const conta = (centavos, extra = {}) => ({
  tenantId: T, tipo: 'saida', status: 'Pendente', descricao: 'NF 1234 - EMBALAGENS SUL', categoria: 'FORNECEDORES',
  fornecedorId: 'f1', fornecedorNome: 'EMBALAGENS SUL', formaPagamento: 'Boleto', naturezaFinanceira: 'contas_pagar',
  valor: centavos / 100, valorCentavos: centavos, data: '2026-11-20', dataVencimento: '2026-12-05', ...extra,
});

const base = (extra = {}) => ({
  'transacoes/C1': cheque('000101', 30000, { pedidoId: 'P30', paymentIndex: 0 }),
  'transacoes/C2': cheque('000102', 50000),
  'transacoes/C3': cheque('000103', 5000, { cheque: { numeroCheque: '000103', situacao: 'depositado' } }),
  'transacoes/D1': conta(30000),
  'transacoes/D2': conta(80000, { descricao: 'ALUGUEL NOVEMBRO', fornecedorNome: 'IMOBILIARIA', fornecedorId: 'f2' }),
  'transacoes/D3': conta(10000, { descricao: 'LUZ', status: 'Paga' }),
  'transacoes/D4': conta(20000, { descricao: 'CHEQUE EMITIDO', formaPagamento: 'Cheque', cheque: { numeroCheque: '9' } }),
  'pedidos_venda/P30': {
    tenantId: T, numeroPedido: '0030', status: 'Finalizada', clienteId: 'c1', clienteNome: 'JOAO', itens: [],
    pagamentos: [{ id: 'pg0', indice: 0, formaPagamento: 'Cheque', condicaoPagamento: 'aprazo', valor: 300, valorCentavos: 30000, status: 'pendente', naturezaFinanceira: 'contas_receber', movimentaCaixaFisico: false, transactionId: 'C1' }],
  },
  ...extra,
});

test('contas para o cheque: so as em aberto e sem cheque emitido; sem a permissao nao lista', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { repasse } = carregar(fake.db);
  const r = await repasse.contasAPagarParaRepasse({ user: USUARIO, tenantId: T });
  assert.deepEqual(r.contas.map((c) => c.id).sort(), ['D1', 'D2']);
  assert.equal(r.contas.find((c) => c.id === 'D2').centavos, 80000);
  await assert.rejects(repasse.contasAPagarParaRepasse({ user: { ...USUARIO, permissoes: ['financeiro.cheques'] }, tenantId: T }), (e) => e.status === 403 && /cadastro de funcionário/.test(e.message));
});

test('cheque do mesmo valor: conta paga em Cheque sem banco, cheque repassado e a venda recebe', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { repasse } = carregar(fake.db);
  const r = await repasse.repassarParaContaAPagar({ user: USUARIO, tenantId: T, corpo: { transacaoId: 'C1', contaPagarId: 'D1' }, hoje: HOJE });
  assert.equal(r.parcial, false);
  const c1 = fake.ler('transacoes/C1');
  assert.equal(c1.status, 'Paga');
  assert.equal(c1.cheque.situacao, 'repassado');
  assert.equal(c1.cheque.repassadoA.fornecedorNome, 'EMBALAGENS SUL');
  assert.equal(c1.cheque.repassadoA.pagamentoTransacaoId, 'D1');
  assert.equal(c1.bancoId, undefined, 'nao entra em banco');
  const d1 = fake.ler('transacoes/D1');
  assert.equal(d1.status, 'Paga');
  assert.equal(d1.formaPagamento, 'Cheque');
  assert.equal(d1.dataPagamento, HOJE);
  assert.equal(d1.bancoId, undefined);
  assert.equal(d1.chequeRecebidoRepassado.transacaoId, 'C1');
  assert.equal(d1.antesDoRepasse.formaPagamento, 'Boleto');
  assert.equal(d1.baixaManual.origem, 'contas_pagar');
  assert.equal(fake.ler('pedidos_venda/P30').statusPagamento, 'Paga');
  const logs = fake.listar(`empresas/${T}/logs/`);
  assert.ok(logs.some((l) => /paga com cheque nº 000101 de JOAO/.test(l.descricao)), 'fica no Historico de alteracoes');
});

test('cheque menor: paga a conta em parte (lancamento proprio) e o resto fica em aberto', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { repasse } = carregar(fake.db);
  const r = await repasse.repassarParaContaAPagar({ user: USUARIO, tenantId: T, corpo: { transacaoId: 'C2', contaPagarId: 'D2' }, hoje: HOJE });
  assert.equal(r.parcial, true);
  assert.equal(r.restanteCentavos, 30000);
  const d2 = fake.ler('transacoes/D2');
  assert.equal(d2.status, 'Pendente');
  assert.equal(d2.valorCentavos, 30000);
  assert.equal(d2.pagoParcialCentavos, 50000);
  assert.equal(d2.valorAntesDoParcialCentavos, 80000);
  const parciais = fake.listar('transacoes/').filter((t) => t.parcialDaTransacaoId === 'D2');
  assert.equal(parciais.length, 1);
  assert.equal(parciais[0].valorCentavos, 50000);
  assert.equal(parciais[0].formaPagamento, 'Cheque');
  assert.equal(parciais[0].fornecedorNome, 'IMOBILIARIA');
  assert.equal(parciais[0].chequeRecebidoRepassado.transacaoId, 'C2');
  for (const v of Object.values(parciais[0])) assert.notEqual(v, undefined);
});

test('recusas: cheque maior que a conta, conta paga, cheque fora da carteira, conta com cheque emitido', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { repasse } = carregar(fake.db);
  const tentar = (transacaoId, contaPagarId) => repasse.repassarParaContaAPagar({ user: USUARIO, tenantId: T, corpo: { transacaoId, contaPagarId }, hoje: HOJE });
  await assert.rejects(tentar('C2', 'D1'), (e) => e.status === 409 && /maior que a conta/.test(e.message) && /compense o cheque no banco/.test(e.message));
  await assert.rejects(tentar('C1', 'D3'), (e) => e.status === 409 && /não está mais em aberto/.test(e.message));
  await assert.rejects(tentar('C3', 'D2'), (e) => e.status === 409 && /depositado/.test(e.message));
  await assert.rejects(tentar('C1', 'D4'), (e) => e.status === 409 && /cheque emitido/.test(e.message));
  await assert.rejects(tentar('../x', 'D1'), (e) => e.status === 400);
  await assert.rejects(repasse.repassarParaContaAPagar({ user: { ...USUARIO, permissoes: ['financeiro.cheques'] }, tenantId: T, corpo: { transacaoId: 'C1', contaPagarId: 'D1' }, hoje: HOJE }), (e) => e.status === 403);
  assert.equal(fake.ler('transacoes/C1').status, 'Pendente', 'nada mudou');
  assert.equal(fake.ler('transacoes/D1').status, 'Pendente');
});

test('estorno da conta paga com o cheque: conta volta como era e o cheque volta para a carteira', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { baixa, repasse } = carregar(fake.db);
  await repasse.repassarParaContaAPagar({ user: USUARIO, tenantId: T, corpo: { transacaoId: 'C1', contaPagarId: 'D1' }, hoje: HOJE });
  await baixa.registrarEstorno({ user: USUARIO, tenantId: T, pedido: { transacaoId: 'D1', tipo: 'saida', motivo: 'Fornecedor devolveu o cheque' } });
  const d1 = fake.ler('transacoes/D1');
  assert.equal(d1.status, 'Pendente');
  assert.equal(d1.formaPagamento, 'Boleto', 'volta a forma de antes');
  assert.equal(d1.chequeRecebidoRepassado, undefined);
  const c1 = fake.ler('transacoes/C1');
  assert.equal(c1.status, 'Pendente');
  assert.equal(c1.cheque.situacao, 'em_carteira');
  assert.equal(c1.cheque.repassadoA, undefined);
  assert.notEqual(fake.ler('pedidos_venda/P30').statusPagamento, 'Paga');
});

test('estorno do pagamento parcial com o cheque: parcial cancelado, conta com o valor cheio e cheque na carteira', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const { baixa, repasse } = carregar(fake.db);
  await repasse.repassarParaContaAPagar({ user: USUARIO, tenantId: T, corpo: { transacaoId: 'C2', contaPagarId: 'D2' }, hoje: HOJE });
  // O lancamento do parcial e' o que o cheque guardou como pagamento.
  const id = fake.ler('transacoes/C2').cheque.repassadoA.pagamentoTransacaoId;
  assert.equal(fake.ler(`transacoes/${id}`).parcialDaTransacaoId, 'D2');
  await baixa.registrarEstorno({ user: USUARIO, tenantId: T, pedido: { transacaoId: id, tipo: 'saida', motivo: 'Cheque voltou' } });
  assert.equal(fake.ler(`transacoes/${id}`).status, 'Cancelada');
  assert.equal(fake.ler('transacoes/D2').valorCentavos, 80000);
  assert.equal(fake.ler('transacoes/C2').cheque.situacao, 'em_carteira');
  assert.equal(fake.ler('transacoes/C2').status, 'Pendente');
});
