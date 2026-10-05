const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-05';
const USER = { uid: 'u1', email: 'u1@teste', tenantId: 'emp1', permissoes: [] };
const carregar = (db) => carregarComBancoFalso(db)[1];

test('cartao: concilia, credita o LIQUIDO no banco do titulo e atualiza a venda', async () => {
  const fake = criarBancoFalso({
    'transacoes/c1': {
      tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #20 - Crédito',
      formaPagamento: 'Cartão de Crédito', valorCentavos: 10000, valor: 100,
      valorLiquidoCentavos: 9500, bancoId: 'b1', pedidoId: 'p20', paymentIndex: 0,
    },
    'bancos/b1': { tenantId: 'emp1', nome: 'Stone', saldoCentavos: 1000 },
    'pedidos_venda/p20': { tenantId: 'emp1', status: 'Finalizada', pagamentos: [{ method: 'Cartão de Crédito', amountCents: 10000, status: 'pending', transactionId: 'c1' }] },
  });
  const s = carregar(fake.db);
  // A escolha da tela (b9) nao vale: o titulo ja' tem banco.
  const r = await s.conciliarCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c1', bancoId: 'b9' }, hoje: HOJE });
  assert.equal(r.liquidoCentavos, 9500);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 10500);
  const t = fake.ler('transacoes/c1');
  assert.equal(t.status, 'Paga');
  assert.equal(t.bancoNome, 'Stone');
  assert.equal(t.dataPagamento, HOJE);
  assert.equal(fake.ler('pedidos_venda/p20').statusPagamento, 'Paga');

  await assert.rejects(() => s.conciliarCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c1' }, hoje: HOJE }), (e) => e.status === 409);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 10500);
});

test('cartao: titulo que nao e\' de cartao e titulo antigo sem banco escolhido sao recusados', async () => {
  const fake = criarBancoFalso({
    'transacoes/x1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', formaPagamento: 'Boleto', valorCentavos: 100 },
    'transacoes/x2': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', formaPagamento: 'Cartão de Débito', valorCentavos: 100 },
  });
  const s = carregar(fake.db);
  await assert.rejects(() => s.conciliarCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'x1' }, hoje: HOJE }), /não é de cartão/);
  await assert.rejects(() => s.conciliarCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'x2' }, hoje: HOJE }), /Escolha em qual banco/);
});

test('cheque recebido: compensa no banco escolhido (titulo sem banco) e credita', async () => {
  const fake = criarBancoFalso({
    'transacoes/q1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Cheque cliente', formaPagamento: 'Cheque', cheque: { numeroCheque: '123' }, valorCentavos: 50000 },
    'bancos/b2': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
  });
  const s = carregar(fake.db);
  await s.compensarChequeRecebido({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'q1', bancoId: 'b2' }, hoje: HOJE });
  assert.equal(fake.ler('bancos/b2').saldoCentavos, 50000);
  assert.equal(fake.ler('transacoes/q1').bancoId, 'b2');
  assert.equal(fake.ler('transacoes/q1').status, 'Paga');
});

test('cheque emitido: compensa com data, debita e grava a marca do Dar Baixa (estornavel)', async () => {
  const fake = criarBancoFalso({
    'transacoes/e1': { tenantId: 'emp1', tipo: 'saida', status: 'Pendente', descricao: 'Fornecedor X', formaPagamento: 'Cheque', cheque: { numeroCheque: '9' }, valorCentavos: 30000, bancoId: 'b3' },
    'bancos/b3': { tenantId: 'emp1', nome: 'BB', saldoCentavos: 100000 },
  });
  const [baixa, s] = carregarComBancoFalso(fake.db);
  await assert.rejects(() => s.compensarChequeEmitido({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'e1', dataPagamento: '2026-10-09' }, hoje: HOJE }), /futuro/);
  await s.compensarChequeEmitido({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'e1', dataPagamento: '2026-10-03' }, hoje: HOJE });
  assert.equal(fake.ler('bancos/b3').saldoCentavos, 70000);
  assert.equal(fake.ler('transacoes/e1').baixaManual.movimentoBancoCentavos, -30000);

  // E o estorno da fatia 1 desfaz certinho.
  await baixa.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'saida', transacaoId: 'e1', motivo: 'compensou errado' } });
  assert.equal(fake.ler('bancos/b3').saldoCentavos, 100000);
});

test('boleto: baixa pelo retorno com o valor pago do arquivo; repetir o arquivo nao credita de novo', async () => {
  const fake = criarBancoFalso({
    'transacoes/bl1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Boleto 1/3', formaPagamento: 'Boleto', boleto: { nossoNumero: '77', status: 'em_remessa' }, valorCentavos: 20000, bancoId: 'b4' },
    'transacoes/nb': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Sem boleto', formaPagamento: 'Pix', valorCentavos: 100 },
    'bancos/b4': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
  });
  const s = carregar(fake.db);
  const corpo = { transacaoId: 'bl1', valorPagoCentavos: 20150, dataPagamento: '2026-10-02' };
  const r1 = await s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r1.jaEstavaPago, false);
  assert.equal(fake.ler('bancos/b4').saldoCentavos, 20150);
  assert.equal(fake.ler('transacoes/bl1').boleto.status, 'pago');
  assert.equal(fake.ler('transacoes/bl1').dataPagamento, '2026-10-02');

  const r2 = await s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r2.jaEstavaPago, true);
  assert.equal(fake.ler('bancos/b4').saldoCentavos, 20150);

  await assert.rejects(() => s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'nb', valorPagoCentavos: 100 }, hoje: HOJE }), /não é um boleto/);
  await assert.rejects(() => s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'bl1', valorPagoCentavos: 0 }, hoje: HOJE }), /valor pago inválido/);
});

test('banco: lancamento manual de tarifa debita e grava o lancamento', async () => {
  const fake = criarBancoFalso({ 'bancos/b5': { tenantId: 'emp1', nome: 'Itaú', saldoCentavos: 10000 } });
  const s = carregar(fake.db);
  await s.lancarNoBanco({ user: USER, tenantId: 'emp1', corpo: { bancoId: 'b5', tipo: 'tarifa', direcao: 'debito', valorCentavos: 1590, descricao: 'Tarifa TED', data: HOJE } });
  assert.equal(fake.ler('bancos/b5').saldoCentavos, 8410);
  const [lanc] = fake.listar('lancamentos_bancarios/');
  assert.equal(lanc.tipo, 'tarifa');
  assert.equal(lanc.bancoNome, 'Itaú');
  assert.equal(lanc.tenantId, 'emp1');

  await assert.rejects(() => s.lancarNoBanco({ user: USER, tenantId: 'emp1', corpo: { bancoId: 'b5', tipo: 'saldo_inicial', direcao: 'credito', valorCentavos: 1, descricao: 'x', data: HOJE } }), /tipo do lançamento/);
  await assert.rejects(() => s.lancarNoBanco({ user: USER, tenantId: 'emp1', corpo: { bancoId: 'b5', tipo: 'ajuste', direcao: 'credito', valorCentavos: 1.5, descricao: 'x', data: HOJE } }), /maior que zero/);
});

test('banco: transferencia move os dois saldos e grava o par; outra empresa e mesmo banco sao recusados', async () => {
  const fake = criarBancoFalso({
    'bancos/o': { tenantId: 'emp1', nome: 'Caixa', saldoCentavos: 50000 },
    'bancos/d': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
    'bancos/z': { tenantId: 'emp2', nome: 'Alheio', saldoCentavos: 0 },
  });
  const s = carregar(fake.db);
  await s.transferirEntreBancos({ user: USER, tenantId: 'emp1', corpo: { origemId: 'o', destinoId: 'd', valorCentavos: 20000, data: HOJE } });
  assert.equal(fake.ler('bancos/o').saldoCentavos, 30000);
  assert.equal(fake.ler('bancos/d').saldoCentavos, 20000);
  const lancs = fake.listar('lancamentos_bancarios/');
  assert.deepEqual(lancs.map((l) => l.tipo).sort(), ['transferencia_entrada', 'transferencia_saida']);
  assert.equal(lancs.find((l) => l.tipo === 'transferencia_saida').descricao, 'Transferência para Sicoob');

  await assert.rejects(() => s.transferirEntreBancos({ user: USER, tenantId: 'emp1', corpo: { origemId: 'o', destinoId: 'z', valorCentavos: 100, data: HOJE } }), (e) => e.status === 404);
  await assert.rejects(() => s.transferirEntreBancos({ user: USER, tenantId: 'emp1', corpo: { origemId: 'o', destinoId: 'o', valorCentavos: 100, data: HOJE } }), /diferente/);
  assert.equal(fake.ler('bancos/z').saldoCentavos, 0);
  assert.equal(fake.ler('bancos/o').saldoCentavos, 30000);
});
