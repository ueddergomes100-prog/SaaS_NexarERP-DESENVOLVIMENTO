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

test('retorno com valor pago diferente do titulo: a diferenca vira lancamento proprio e o extrato fecha com o banco (25/11/2026)', async () => {
  const fake = criarBancoFalso({
    'transacoes/juros': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Duplicata 3893-8', formaPagamento: 'Boleto', boleto: { nossoNumero: '3893-8' }, valorCentavos: 28145, bancoId: 'bs', clienteId: 'c1', clienteNome: 'JULIANA SOARES' },
    'transacoes/menos': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Duplicata 4000-1', formaPagamento: 'Boleto', boleto: { nossoNumero: '4000-1' }, valorCentavos: 10000, bancoId: 'bs' },
    'transacoes/antigo': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Duplicata 703-6', formaPagamento: 'Boleto', boleto: { nossoNumero: '703-6', sistemaAnterior: true, valorNoBancoCentavos: 53200 }, valorCentavos: 4180, bancoId: 'bs' },
    'transacoes/exato': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Duplicata 3773-9', formaPagamento: 'Boleto', boleto: { nossoNumero: '3773-9' }, valorCentavos: 425000, bancoId: 'bs' },
    'bancos/bs': { tenantId: 'emp1', nome: 'SICOOB SANTO ANTONIO', saldoCentavos: 0 },
  });
  const s = carregar(fake.db);
  const baixar = (transacaoId, valorPagoCentavos) => s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo: { transacaoId, valorPagoCentavos, dataPagamento: '2026-11-23' }, hoje: HOJE });
  const lancamentos = () => fake.listar('transacoes/').filter((t) => t.origemLancamento === 'retorno_boleto');

  // Pago com juros: titulo pela parte dele, juros num lancamento ligado; banco recebe tudo.
  const r = await baixar('juros', 29078);
  assert.equal(r.acrescimoCentavos, 933);
  assert.equal(fake.ler('bancos/bs').saldoCentavos, 29078);
  const titulo = fake.ler('transacoes/juros');
  assert.equal(titulo.boleto.valorPagoCentavos, 29078);
  assert.equal(titulo.acrescimoCentavos, 933);
  const [juros] = lancamentos();
  assert.equal(juros.valorCentavos, 933);
  assert.equal(juros.tipo, 'entrada');
  assert.equal(juros.categoria, 'Juros e multa recebidos');
  assert.equal(juros.descricao, 'Juros e multa — Duplicata 3893-8');
  assert.equal(juros.dataPagamento, '2026-11-23');
  assert.equal(juros.bancoNome, 'SICOOB SANTO ANTONIO');
  assert.equal(juros.clienteNome, 'JULIANA SOARES');
  assert.equal(juros.acrescimoDaTransacaoId, 'juros');
  assert.equal(titulo.acrescimoTransacaoId, juros.id || titulo.acrescimoTransacaoId);
  assert.ok(Object.values(juros).every((v) => v !== undefined), 'nada undefined no Firestore');

  // Pago a menos: desconto concedido (saida); banco recebe so o pago.
  await baixar('menos', 9500);
  const desconto = lancamentos().find((t) => t.descontoDaTransacaoId === 'menos');
  assert.equal(desconto.tipo, 'saida');
  assert.equal(desconto.valorCentavos, 500);
  assert.equal(desconto.categoria, 'Descontos concedidos');
  assert.equal(fake.ler('transacoes/menos').descontoCentavos, 500);

  // Boleto do sistema anterior com parte ja paga la: o excesso nao e juros.
  await baixar('antigo', 53200);
  const aMais = lancamentos().find((t) => t.acrescimoDaTransacaoId === 'antigo');
  assert.equal(aMais.valorCentavos, 49020);
  assert.equal(aMais.categoria, 'Valor pago a mais');
  assert.match(aMais.descricao, /sistema anterior valia R\$ 532,00/);

  // Pago exato: nenhum lancamento a mais.
  const antes = lancamentos().length;
  await baixar('exato', 425000);
  assert.equal(lancamentos().length, antes);
  assert.equal(fake.ler('transacoes/exato').acrescimoTransacaoId, undefined);
  assert.equal(fake.ler('bancos/bs').saldoCentavos, 29078 + 9500 + 53200 + 425000);

  // Mesmo arquivo de novo: nada repete.
  await baixar('juros', 29078);
  assert.equal(lancamentos().filter((t) => t.acrescimoDaTransacaoId === 'juros').length, 1);
});

test('boleto cancelado pago no banco: retorno nao baixa nem derruba; recebimento avulso nasce pago e nao repete', async () => {
  const fake = criarBancoFalso({
    'transacoes/bc1': {
      tenantId: 'emp1', tipo: 'entrada', status: 'Cancelada', descricao: 'Venda Direta #0052 - Boleto', formaPagamento: 'Boleto',
      boleto: { nossoNumero: '2023', status: 'em_remessa' }, valorCentavos: 94520, bancoId: 'b6', clienteId: 'cli1', clienteNome: 'MERCADO X', filialId: 'f1', pedidoId: 'p52',
    },
    'transacoes/ok1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Boleto ok', formaPagamento: 'Boleto', boleto: { nossoNumero: '2024' }, valorCentavos: 1000, bancoId: 'b6' },
    'bancos/b6': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
    'pedidos_venda/p52': { tenantId: 'emp1', status: 'Cancelada' },
  });
  const s = carregar(fake.db);
  const corpo = { transacaoId: 'bc1', valorPagoCentavos: 94520, dataPagamento: '2026-10-26' };

  // 1. A baixa normal volta avisando, sem gravar nada (o lote continua).
  const r = await s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r.boletoCancelado, true);
  assert.equal(r.jaLancadoAvulso, false);
  assert.equal(r.descricao, 'Venda Direta #0052 - Boleto');
  assert.equal(r.clienteNome, 'MERCADO X');
  assert.equal(fake.ler('bancos/b6').saldoCentavos, 0);
  assert.equal(fake.ler('transacoes/bc1').status, 'Cancelada');

  // 2. A pessoa aceitou: titulo avulso ja' pago, ligado ao boleto; banco credita.
  const a = await s.receberBoletoCanceladoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(a.jaLancado, false);
  assert.equal(a.novoId, 'bc1_avulso');
  const novo = fake.ler('transacoes/bc1_avulso');
  assert.equal(novo.status, 'Paga');
  assert.equal(novo.tipo, 'entrada');
  assert.equal(novo.valorCentavos, 94520);
  assert.equal(novo.categoria, 'BOLETO PAGO DE VENDA CANCELADA');
  assert.equal(novo.dataPagamento, '2026-10-26');
  assert.equal(novo.bancoNome, 'Sicoob');
  assert.equal(novo.clienteNome, 'MERCADO X');
  assert.equal(novo.filialId, 'f1');
  assert.equal(novo.boletoCanceladoId, 'bc1');
  assert.equal(novo.pedidoId, undefined);
  assert.equal(fake.ler('bancos/b6').saldoCentavos, 94520);
  const boleto = fake.ler('transacoes/bc1');
  assert.equal(boleto.status, 'Cancelada');
  assert.equal(boleto.boleto.recebimentoAvulsoId, 'bc1_avulso');
  assert.equal(fake.ler('pedidos_venda/p52').status, 'Cancelada');

  // 3. Mesmo arquivo de novo: a baixa avisa que ja' foi lancado; lancar de novo nao credita.
  const r2 = await s.baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r2.jaLancadoAvulso, true);
  const a2 = await s.receberBoletoCanceladoPeloRetorno({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(a2.jaLancado, true);
  assert.equal(fake.ler('bancos/b6').saldoCentavos, 94520);

  // 4. Boleto que nao esta' cancelado nao entra por aqui.
  await assert.rejects(() => s.receberBoletoCanceladoPeloRetorno({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'ok1', valorPagoCentavos: 1000 }, hoje: HOJE }), (e) => e.status === 409);
  assert.equal(fake.ler('bancos/b6').saldoCentavos, 94520);
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

// Taxa do cartao a conciliar (26/11/2026): corrige a taxa e o liquido da parcela pendente; conciliada nao muda.
test('cartao: corrige a taxa da parcela pendente, o liquido que entra no banco e o total de taxas da venda', async () => {
  const fake = criarBancoFalso({
    'transacoes/c1': {
      tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda Direta #113764 - Cartão de Crédito',
      formaPagamento: 'Cartão de Crédito', valorCentavos: 4000, valor: 40, valorBrutoCentavos: 4000,
      valorTaxaCentavos: 176, valorLiquidoCentavos: 3824, bancoId: 'b1', pedidoId: 'p1',
      cartao: { bandeira: 'CIELO', taxaPercentual: 4.4, valorTaxaCentavos: 176, valorLiquidoCentavos: 3824, detalhamentoParcelas: [{ numero: 1, valorCentavos: 4000, valorLiquidoCentavos: 3824 }] },
    },
    'bancos/b1': { tenantId: 'emp1', nome: 'SICOOB SAUDE', saldoCentavos: 0 },
    'pedidos_venda/p1': { tenantId: 'emp1', status: 'Finalizada', totalTaxasPagamentoCentavos: 176, totalTaxasPagamento: 1.76 },
  });
  const s = carregar(fake.db);
  const r = await s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c1', taxaCentavos: 200 } });
  assert.equal(r.liquidoCentavos, 3800);
  assert.equal(r.percentual, 5);
  const t = fake.ler('transacoes/c1');
  assert.equal(t.valorTaxaCentavos, 200);
  assert.equal(t.valorLiquidoCentavos, 3800);
  assert.equal(t.cartao.valorTaxaCentavos, 200);
  assert.equal(t.cartao.taxaPercentual, 5);
  assert.equal(t.cartao.detalhamentoParcelas[0].valorLiquidoCentavos, 3800);
  assert.equal(t.cartao.bandeira, 'CIELO');
  assert.equal(t.taxaAlteradaManualmente.deCentavos, 176);
  assert.equal(fake.ler('pedidos_venda/p1').totalTaxasPagamentoCentavos, 200);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0, 'o banco so recebe ao conciliar');
  // Conciliar depois credita o liquido novo.
  await s.conciliarCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c1' }, hoje: HOJE });
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 3800);
  // Conciliada: nao muda mais.
  await assert.rejects(() => s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c1', taxaCentavos: 100 } }), /já foi conciliada/);
});

test('cartao: taxa invalida e titulo que nao e\' de cartao sao recusados', async () => {
  const fake = criarBancoFalso({
    'transacoes/c2': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', formaPagamento: 'Cartão de Débito', valorCentavos: 1000 },
    'transacoes/b2': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', formaPagamento: 'Boleto', valorCentavos: 1000 },
  });
  const s = carregar(fake.db);
  await assert.rejects(() => s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c2', taxaCentavos: 1000 } }), /não pode ser igual ou maior/);
  await assert.rejects(() => s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c2', taxaCentavos: -5 } }), /zero ou maior/);
  await assert.rejects(() => s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'b2', taxaCentavos: 10 } }), /não é de cartão/);
  const ok = await s.alterarTaxaDoCartao({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'c2', taxaCentavos: 0 } });
  assert.equal(ok.liquidoCentavos, 1000);
});


test('retorno do boleto (28/11/2026): guarda juros/multa, tarifa e liquido do banco so\' para a tela, sem lixo', async () => {
  const fake = criarBancoFalso({
    'transacoes/bl1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Boleto 1/3', formaPagamento: 'Boleto', boleto: { nossoNumero: '77', status: 'em_remessa' }, valorCentavos: 10000, bancoId: 'b4' },
    'bancos/b4': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
  });
  const servico = carregar(fake.db);
  await servico.baixarBoletoPeloRetorno({
    user: USER, tenantId: 'emp1', hoje: HOJE,
    corpo: { transacaoId: 'bl1', valorPagoCentavos: 10000, detalheDoRetorno: { jurosMultaCentavos: 0, tarifaCentavos: 250, valorLiquidoCentavos: 9750, descontoCentavos: -5, lixo: 'x' } },
  });
  const boleto = fake.ler('transacoes/bl1').boleto;
  assert.deepEqual(boleto.retorno, { jurosMultaCentavos: 0, tarifaCentavos: 250, valorLiquidoCentavos: 9750 });
  assert.equal(boleto.valorPagoCentavos, 10000, 'a baixa continua pelo valor pago');
});


test('tarifa do boleto (28/11/2026): vira despesa "Tarifas bancárias" e sai do saldo do banco', async () => {
  const fake = criarBancoFalso({
    'transacoes/bl2': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Boleto 2/3', formaPagamento: 'Boleto', boleto: { nossoNumero: '78', status: 'em_remessa' }, valorCentavos: 10000, bancoId: 'b5' },
    'bancos/b5': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
  }, { consultas: true });
  const servico = carregar(fake.db);
  await servico.baixarBoletoPeloRetorno({
    user: USER, tenantId: 'emp1', hoje: HOJE,
    corpo: { transacaoId: 'bl2', valorPagoCentavos: 10000, dataPagamento: '2026-10-02', detalheDoRetorno: { tarifaCentavos: 250, valorLiquidoCentavos: 9750 } },
  });
  assert.equal(fake.ler('bancos/b5').saldoCentavos, 9750, 'o banco fica com o liquido');
  const titulo = fake.ler('transacoes/bl2');
  assert.equal(titulo.tarifaCentavos, 250);
  const tarifa = fake.ler(`transacoes/${titulo.tarifaTransacaoId}`);
  assert.equal(tarifa.tipo, 'saida');
  assert.equal(tarifa.status, 'Paga');
  assert.equal(tarifa.categoria, 'Tarifas bancárias');
  assert.equal(tarifa.valorCentavos, 250);
  assert.equal(tarifa.tarifaDaTransacaoId, 'bl2');
  for (const v of Object.values(tarifa)) assert.notEqual(v, undefined);

  // Sem tarifa no arquivo (CNAB400 ou boleto antigo): nada muda.
  const fake2 = criarBancoFalso({
    'transacoes/bl3': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Boleto 3/3', formaPagamento: 'Boleto', boleto: { nossoNumero: '79', status: 'em_remessa' }, valorCentavos: 10000, bancoId: 'b6' },
    'bancos/b6': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 0 },
  });
  await carregar(fake2.db).baixarBoletoPeloRetorno({ user: USER, tenantId: 'emp1', hoje: HOJE, corpo: { transacaoId: 'bl3', valorPagoCentavos: 10000 } });
  assert.equal(fake2.ler('bancos/b6').saldoCentavos, 10000);
  assert.equal(fake2.ler('transacoes/bl3').tarifaTransacaoId, undefined);
});


test('decurso de prazo (28/11/2026): boleto marcado, conta continua em aberto, tarifa vira despesa e sai do banco; repetir nao duplica', async () => {
  const fake = criarBancoFalso({
    'transacoes/bp1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Pedido #50 - Parcela 1/1', clienteNome: 'JOSE', formaPagamento: 'Boleto', boleto: { nossoNumero: '27191', status: 'em_remessa', vencimento: '2026-05-26' }, valorCentavos: 70175, bancoId: 'b7' },
    'bancos/b7': { tenantId: 'emp1', nome: 'Sicoob', saldoCentavos: 10000 },
  });
  const s = carregar(fake.db);
  const corpo = { transacaoId: 'bp1', dataOcorrencia: '2026-11-23', tarifaCentavos: 100 };
  const r1 = await s.registrarBaixaPorPrazo({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r1.jaRegistrado, false);
  const titulo = fake.ler('transacoes/bp1');
  assert.equal(titulo.status, 'Pendente', 'a conta continua em aberto');
  assert.deepEqual(titulo.boleto.baixaPorPrazo, { em: '2026-11-23', tarifaCentavos: 100 });
  assert.equal(fake.ler('bancos/b7').saldoCentavos, 9900);
  const tarifas = fake.listar('transacoes/').filter((t) => t.tarifaDaTransacaoId === 'bp1');
  assert.equal(tarifas.length, 1);
  assert.equal(tarifas[0].categoria, 'Tarifas bancárias');
  assert.equal(tarifas[0].tipo, 'saida');
  const r2 = await s.registrarBaixaPorPrazo({ user: USER, tenantId: 'emp1', corpo, hoje: HOJE });
  assert.equal(r2.jaRegistrado, true);
  assert.equal(fake.ler('bancos/b7').saldoCentavos, 9900, 'importar de novo nao cobra a tarifa duas vezes');
});
