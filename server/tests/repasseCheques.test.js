const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Nota avulsa paga com cheque de cliente (25/11/2026, Embala Minas): o cheque
 * sai da carteira "repassado", o titulo do cliente fica pago sem entrar em
 * banco e a venda de origem registra o recebimento; cancelar desfaz.
 */

const HOJE = '2026-11-25';
const T = 'emp1';
const USUARIO = { uid: 'u1', email: 'ana@loja', nome: 'ANA', tenantId: T, permissoes: ['estoque.nota_avulsa', 'estoque.nota_avulsa_cheque_cliente'] };
const servico = (db) => carregarComBancoFalso(db, 'services/renegociacaoOrigem', 'services/auditoria', 'services/repasseCheques')[5];

const cheque = (numero, centavos, extra = {}) => ({
  tenantId: T, tipo: 'entrada', status: 'Pendente', formaPagamento: 'Cheque', descricao: `Pedido #0030 - cheque ${numero}`,
  valor: centavos / 100, valorCentavos: centavos, clienteNome: 'JOAO', naturezaFinanceira: 'contas_receber',
  cheque: { numeroCheque: numero, bancoEmissor: '756', dataCompensacao: '2026-12-10' }, ...extra,
});

const base = (extra = {}) => ({
  'transacoes/C1': cheque('000101', 30000, { pedidoId: 'P30', paymentIndex: 0 }),
  'transacoes/C2': cheque('000102', 20000),
  'transacoes/C3': cheque('000103', 5000, { cheque: { numeroCheque: '000103', situacao: 'depositado' } }),
  'pedidos_venda/P30': {
    tenantId: T, numeroPedido: '0030', status: 'Finalizada', clienteId: 'c1', clienteNome: 'JOAO', itens: [],
    pagamentos: [{ id: 'pg0', indice: 0, formaPagamento: 'Cheque', condicaoPagamento: 'aprazo', valor: 300, valorCentavos: 30000, status: 'pendente', naturezaFinanceira: 'contas_receber', movimentaCaixaFisico: false, transactionId: 'C1' }],
  },
  'notas_avulsas/N1': {
    tenantId: T, numero: '0007', status: 'ativa', fornecedorId: 'f1', fornecedorNome: 'EMBALAGENS SUL', valorTotal: 800,
    pagamentoComCheques: { chequeIds: ['C1', 'C2'], totalCentavos: 50000, situacao: 'a_repassar' },
  },
  ...extra,
});

test('carteira: so cheques em aberto e na carteira; sem a permissao nao lista', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = servico(fake.db);
  const lista = await s.chequesNaCarteira({ user: USUARIO, tenantId: T });
  assert.deepEqual(lista.map((c) => c.id).sort(), ['C1', 'C2']);
  await assert.rejects(s.chequesNaCarteira({ user: { ...USUARIO, permissoes: ['estoque.nota_avulsa'] }, tenantId: T }), (e) => e.status === 403);
});

test('repassar: cheques pagos e "repassados", venda recebe, titulo da nota pago; de novo nao repete', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = servico(fake.db);
  const r = await s.repassarNaNotaAvulsa({ user: USUARIO, tenantId: T, notaAvulsaId: 'N1', hoje: HOJE });
  assert.equal(r.totalCentavos, 50000);
  const c1 = fake.ler('transacoes/C1');
  assert.equal(c1.status, 'Paga');
  assert.equal(c1.cheque.situacao, 'repassado');
  assert.equal(c1.cheque.repassadoA.fornecedorNome, 'EMBALAGENS SUL');
  assert.equal(c1.bancoId, undefined, 'nao entra em banco');
  assert.equal(fake.ler('pedidos_venda/P30').statusPagamento, 'Paga');
  const titulo = fake.ler('transacoes/repasse_cheques_N1');
  assert.equal(titulo.tipo, 'saida');
  assert.equal(titulo.status, 'Paga');
  assert.equal(titulo.valorCentavos, 50000);
  assert.equal(titulo.chequesRepassados.length, 2);
  assert.equal(fake.ler('notas_avulsas/N1').pagamentoComCheques.situacao, 'repassado');
  assert.equal((await s.repassarNaNotaAvulsa({ user: USUARIO, tenantId: T, notaAvulsaId: 'N1', hoje: HOJE })).jaRepassado, true);
});

test('repassar: cheque que saiu da carteira trava com mensagem do que fazer', async () => {
  const fake = criarBancoFalso(base({ 'notas_avulsas/N2': { ...base()['notas_avulsas/N1'], pagamentoComCheques: { chequeIds: ['C3'], totalCentavos: 5000, situacao: 'a_repassar' } } }), { consultas: true });
  await assert.rejects(
    servico(fake.db).repassarNaNotaAvulsa({ user: USUARIO, tenantId: T, notaAvulsaId: 'N2', hoje: HOJE }),
    (e) => e.status === 409 && /depositado/.test(e.message) && /cancele/.test(e.message),
  );
});

test('desfazer (nota cancelada): cheques de volta na carteira, venda em aberto, titulo do repasse cancelado', async () => {
  const fake = criarBancoFalso(base(), { consultas: true });
  const s = servico(fake.db);
  await s.repassarNaNotaAvulsa({ user: USUARIO, tenantId: T, notaAvulsaId: 'N1', hoje: HOJE });
  const r = await s.desfazerRepasseDaNotaAvulsa({ user: USUARIO, tenantId: T, notaAvulsaId: 'N1' });
  assert.equal(r.desfeito, true);
  const c1 = fake.ler('transacoes/C1');
  assert.equal(c1.status, 'Pendente');
  assert.equal(c1.cheque.situacao, 'em_carteira');
  assert.equal(c1.cheque.repassadoA, undefined);
  assert.equal(c1.dataPagamento, undefined);
  assert.equal(c1.naturezaFinanceira, 'contas_receber');
  assert.equal(fake.ler('pedidos_venda/P30').statusPagamento, 'Pendente');
  assert.equal(fake.ler('transacoes/repasse_cheques_N1').status, 'Cancelada');
  assert.equal(fake.ler('notas_avulsas/N1').pagamentoComCheques.situacao, 'desfeito');
});
