const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Pagamento PARCIAL (16/10/2026): cliente deve 1.000, paga 100 em 100.
 * Firestore falso em memoria.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const carregar = (db) => carregarComBancoFalso(db)[0];
const USER = { uid: 'u1', email: 'u1@teste', tenantId: 'emp1', permissoes: [] };

const banco = () => criarBancoFalso({
  'transacoes/r1': {
    tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Venda #0090 - 1/1', valor: 1000, valorCentavos: 100000,
    formaPagamento: 'Pagamento a Prazo', pedidoId: 'p90', paymentIndex: 0, clienteId: 'c1', clienteNome: 'MARIA', dataVencimento: '2026-10-01',
  },
  'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
  'pedidos_venda/p90': {
    tenantId: 'emp1', status: 'Finalizada',
    pagamentos: [{ id: 'pg1', indice: 0, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', valorCentavos: 100000, valor: 1000, status: 'pendente', transactionId: 'r1' }],
  },
});

const dia = () => carregar(criarBancoFalso({})).hojeNoBrasil();

const receber = (s, valorRecebidoCentavos, extra = {}) => s.registrarBaixa({
  user: USER,
  tenantId: 'emp1',
  pedido: s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 'r1', formaPagamento: 'Pix', dataPagamento: dia(), bancoId: 'b1', valorRecebidoCentavos, ...extra }, dia()).pedido,
});

const parciais = (fake) => fake.listar('transacoes/').filter((t) => t.parcialDaTransacaoId === 'r1');

/** Id do lancamento parcial de uma conta (o Firestore falso numera auto1, auto2...). */
const idDoParcial = (fake, contaId, valorCentavos) => [...Array(100).keys()].map((n) => `auto${n}`).find((id) => {
  const t = fake.ler(`transacoes/${id}`);
  return t && t.parcialDaTransacaoId === contaId && (valorCentavos === undefined || t.valorCentavos === valorCentavos);
});

test('100 de 1.000: a conta fica com 900 em aberto, o pago vira lancamento proprio e a venda fica Parcial', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  const r = await receber(s, 10000);
  assert.deepEqual(r.parcial, { transacaoId: idDoParcial(fake, 'r1'), principalCentavos: 10000, restanteCentavos: 90000 });

  const conta = fake.ler('transacoes/r1');
  assert.equal(conta.status, 'Pendente');
  assert.equal(conta.valorCentavos, 90000);
  assert.equal(conta.valorAntesDoParcialCentavos, 100000);
  assert.equal(conta.pagoParcialCentavos, 10000);

  const [pago] = parciais(fake);
  assert.deepEqual([pago.status, pago.tipo, pago.valorCentavos, pago.formaPagamento, pago.pedidoId, pago.clienteNome], ['Paga', 'entrada', 10000, 'Pix', 'p90', 'MARIA']);
  assert.equal(pago.sourcePaymentTransactionId, undefined, 'senao o estorno o trataria como credito');
  assert.equal(pago.baixaManual.movimentoBancoCentavos, 10000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 10000);

  const venda = fake.ler('pedidos_venda/p90');
  assert.equal(venda.statusPagamento, 'Parcial');
  assert.equal(venda.totalPendenteCentavos, 90000);
  assert.equal(venda.totalRecebidoCentavos, 10000);
  assert.ok(!JSON.stringify(pago).includes('undefined'));
});

test('varios parciais acumulam; o ultimo quita a conta e a venda', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await receber(s, 10000);
  await receber(s, 20000);
  let conta = fake.ler('transacoes/r1');
  assert.equal(conta.valorCentavos, 70000);
  assert.equal(conta.pagoParcialCentavos, 30000);
  assert.equal(conta.valorAntesDoParcialCentavos, 100000, 'guarda o valor de antes do primeiro parcial');

  // Sem valor informado: quita o que falta (a baixa de sempre).
  await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 'r1', formaPagamento: 'Dinheiro', dataPagamento: dia() }, dia()).pedido });
  conta = fake.ler('transacoes/r1');
  assert.equal(conta.status, 'Paga');
  assert.equal(conta.valorCentavos, 70000);
  const venda = fake.ler('pedidos_venda/p90');
  assert.equal(venda.statusPagamento, 'Paga');
  assert.equal(venda.totalRecebidoCentavos, 100000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 30000, 'o dinheiro final nao passou pelo banco');
});

test('estorno de um parcial devolve o valor para a conta, para o banco e para a venda', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await receber(s, 10000);
  await receber(s, 20000);
  const idDoPrimeiro = idDoParcial(fake, 'r1', 10000);
  assert.ok(idDoPrimeiro);

  const estorno = s.validarPedidoDeEstorno({ tipo: 'entrada', transacaoId: idDoPrimeiro, motivo: 'cliente pagou em outra conta' }).pedido;
  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: estorno });

  const conta = fake.ler('transacoes/r1');
  assert.equal(conta.valorCentavos, 80000);
  assert.equal(conta.pagoParcialCentavos, 20000);
  assert.equal(fake.ler(`transacoes/${idDoPrimeiro}`).status, 'Cancelada');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 20000);
  const venda = fake.ler('pedidos_venda/p90');
  assert.equal(venda.totalPendenteCentavos, 80000);
  assert.equal(venda.totalRecebidoCentavos, 20000);
  assert.equal(venda.statusPagamento, 'Parcial');
});

test('estornar o ultimo parcial apaga o "pago de" da conta', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await receber(s, 10000);
  const [pago] = parciais(fake);
  const id = idDoParcial(fake, 'r1');
  assert.equal(pago.valorCentavos, 10000);
  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: id, motivo: 'lancado na conta errada' } });
  const conta = fake.ler('transacoes/r1');
  assert.equal(conta.valorCentavos, 100000);
  assert.equal(conta.pagoParcialCentavos, undefined);
  assert.equal(conta.valorAntesDoParcialCentavos, undefined);
  assert.equal(fake.ler('pedidos_venda/p90').statusPagamento, 'Pendente');
});

test('conta quitada depois: o parcial antigo so\' estorna depois de estornar a quitacao', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await receber(s, 10000);
  const id = idDoParcial(fake, 'r1');
  await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido: s.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId: 'r1', formaPagamento: 'Pix', dataPagamento: dia(), bancoId: 'b1' }, dia()).pedido });
  await assert.rejects(
    () => s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: id, motivo: 'tentando estornar o parcial' } }),
    (e) => e.status === 409 && /estorne antes o pagamento que quitou/.test(e.message),
  );
  // Estornando a quitacao primeiro, o parcial sai em seguida.
  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: 'r1', motivo: 'quitacao lancada errada' } });
  assert.equal(fake.ler('transacoes/r1').status, 'Pendente');
  assert.equal(fake.ler('transacoes/r1').valorCentavos, 90000);
  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: id, motivo: 'tentando estornar o parcial' } });
  assert.equal(fake.ler('transacoes/r1').valorCentavos, 100000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0);
  assert.equal(fake.ler('pedidos_venda/p90').totalPendenteCentavos, 100000);
});

test('juros e multa proporcionais entram junto do parcial e saem no estorno dele', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  // 10.300 recebidos = 10.000 da conta + 200 de juros + 100 de multa.
  await receber(s, 10300, { jurosCentavos: 200, multaCentavos: 100 });
  const id = idDoParcial(fake, 'r1');
  const pago = fake.ler(`transacoes/${id}`);
  assert.equal(pago.valorCentavos, 10000);
  assert.equal(fake.ler('transacoes/r1').valorCentavos, 90000);
  const juros = fake.ler(`transacoes/${pago.baixaManual.acrescimoTransacaoId}`);
  assert.equal(juros.valorCentavos, 300);
  assert.equal(juros.acrescimoDaTransacaoId, id, 'juros ligados ao parcial, nao a conta');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 10300);

  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: id, motivo: 'recebido no dia errado' } });
  assert.equal(fake.ler(`transacoes/${pago.baixaManual.acrescimoTransacaoId}`).status, 'Cancelada');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0);
  assert.equal(fake.ler('transacoes/r1').valorCentavos, 100000);
});

test('bloqueios: acima do que falta, boleto emitido e parcela de renegociacao', async () => {
  const fake = banco();
  const s = carregar(fake.db);
  await assert.rejects(() => receber(s, 150000), /passa do que falta/);
  assert.equal(fake.ler('transacoes/r1').valorCentavos, 100000);

  const comBoleto = criarBancoFalso({
    'transacoes/r1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'X', valor: 1000, valorCentavos: 100000, boleto: { status: 'emitido', nossoNumero: '123' } },
    'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
  });
  await assert.rejects(() => receber(carregar(comBoleto.db), 10000), /boleto emitido/);
  // Valor inteiro em conta com boleto continua como sempre.
  await receber(carregar(comBoleto.db), 100000);
  assert.equal(comBoleto.ler('transacoes/r1').status, 'Paga');

  const renegociada = criarBancoFalso({
    'transacoes/r1': { tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: 'Renegociação 1/2', valor: 1000, valorCentavos: 100000, renegociacao: { id: 'rn1', titulosNovos: ['r1'] } },
    'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
  });
  await assert.rejects(() => receber(carregar(renegociada.db), 10000), /Parcela de renegociação/);
});

test('Pagar: pagar 200 de 500 a um fornecedor com juros; estorno devolve tudo', async () => {
  const fake = criarBancoFalso({
    'transacoes/d1': {
      tenantId: 'emp1', tipo: 'saida', status: 'Pendente', descricao: 'Boleto fornecedor', valor: 500, valorCentavos: 50000,
      fornecedorId: 'f1', fornecedorNome: 'DISTRIBUIDORA X', categoria: 'Mercadorias', veiculoId: 'v1', veiculoNome: 'VW',
    },
    'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 100000 },
  });
  const s = carregar(fake.db);
  const pedido = s.validarPedidoDeBaixa({ tipo: 'saida', transacaoId: 'd1', formaPagamento: 'Pix', dataPagamento: dia(), bancoId: 'b1', valorRecebidoCentavos: 21000, jurosCentavos: 1000 }, dia()).pedido;
  await s.registrarBaixa({ user: USER, tenantId: 'emp1', pedido });
  assert.equal(fake.ler('transacoes/d1').valorCentavos, 30000);
  assert.equal(fake.ler('transacoes/d1').status, 'Pendente');
  const id = idDoParcial(fake, 'd1');
  const pago = fake.ler(`transacoes/${id}`);
  assert.deepEqual([pago.tipo, pago.valorCentavos, pago.fornecedorNome, pago.categoria, pago.veiculoId], ['saida', 20000, 'DISTRIBUIDORA X', 'Mercadorias', 'v1']);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000 - 21000);

  await s.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'saida', transacaoId: id, motivo: 'pagamento lancado errado' } });
  assert.equal(fake.ler('transacoes/d1').valorCentavos, 50000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 100000);
  assert.equal(fake.ler(`transacoes/${pago.baixaManual.acrescimoTransacaoId}`).status, 'Cancelada');
});
