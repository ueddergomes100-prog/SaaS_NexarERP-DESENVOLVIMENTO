const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Renegociacao de parcelas a receber e "Gerar boleto" de parcela a prazo
 * (15/10/2026). Firestore falso em memoria: nenhum banco e' tocado.
 */
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

const HOJE = '2026-10-15';
const USER = { uid: 'u1', email: 'u1@teste', tenantId: 'emp1', permissoes: ['financeiro.renegociar'] };

const carregar = (db) => {
  const [baixa, movimento, , reneg, boletoAPrazo] = carregarComBancoFalso(db, 'services/renegociacao', 'services/boletoDeAPrazo');
  return { baixa, movimento, reneg, boletoAPrazo };
};

const pagamento = (id, indice, valorCentavos) => ({
  id, indice, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', valorCentavos, valor: valorCentavos / 100,
  status: 'pendente', naturezaFinanceira: 'contas_receber', movimentaCaixaFisico: false, transactionId: id,
});
const titulo = (id, pedidoId, indice, extra = {}) => ({
  tenantId: 'emp1', tipo: 'entrada', status: 'Pendente', descricao: `Venda ${pedidoId} - ${indice}/2`,
  valor: 1000, valorCentavos: 100000, valorBrutoCentavos: 100000, formaPagamento: 'Pagamento a Prazo',
  dataVencimento: '2026-10-01', clienteId: 'c1', clienteNome: 'MARIA', pedidoId, paymentIndex: indice, ...extra,
});
const cenario = () => ({
  'transacoes/a1': titulo('a1', 'p1', 1),
  'transacoes/a2': titulo('a2', 'p1', 2),
  'transacoes/b1': titulo('b1', 'p2', 1),
  'pedidos_venda/p1': { tenantId: 'emp1', status: 'Finalizada', pagamentos: [pagamento('a1', 1, 100000), pagamento('a2', 2, 100000)] },
  'pedidos_venda/p2': { tenantId: 'emp1', status: 'Finalizada', pagamentos: [pagamento('b1', 1, 100000)] },
  'bancos/b1': { tenantId: 'emp1', nome: 'Sicoob', ativo: true, saldoCentavos: 0 },
});

const renegociar = async (s, parcelas, extra = {}) => {
  const { erro, pedido } = s.reneg.validarPedidoDeRenegociacao({
    transacaoIds: ['a1', 'a2', 'b1'], parcelas, formaPagamento: 'Boleto', motivo: 'acordo para quitar as 3', ...extra,
  }, HOJE);
  assert.equal(erro, undefined);
  return s.reneg.criarRenegociacao({ user: USER, tenantId: 'emp1', pedido, hoje: HOJE });
};

const receber = (s, transacaoId) => s.baixa.registrarBaixa({
  user: USER,
  tenantId: 'emp1',
  pedido: s.baixa.validarPedidoDeBaixa({ tipo: 'entrada', transacaoId, formaPagamento: 'Pix', dataPagamento: HOJE, bancoId: 'b1' }, HOJE).pedido,
});

test('3 parcelas de R$ 1.000 viram R$ 2.600 em 2x; vendas so quitam com a ultima recebida', async () => {
  const fake = criarBancoFalso(cenario());
  const s = carregar(fake.db);
  const resumo = await renegociar(s, [{ valorCentavos: 130000, vencimento: '2026-11-14' }, { valorCentavos: 130000, vencimento: '2026-12-14' }]);
  assert.equal(resumo.totalOrigemCentavos, 300000);
  assert.equal(resumo.totalNovoCentavos, 260000);

  ['a1', 'a2', 'b1'].forEach((id) => {
    const antigo = fake.ler(`transacoes/${id}`);
    assert.equal(antigo.status, 'Renegociada');
    assert.equal(antigo.renegociacaoId, resumo.renegociacaoId);
    assert.equal(antigo.valorCentavos, 100000, 'o valor antigo fica como estava');
  });
  const p1 = fake.ler(`transacoes/${resumo.renegociacaoId}_p1`);
  const p2 = fake.ler(`transacoes/${resumo.renegociacaoId}_p2`);
  assert.equal(p1.status, 'Pendente');
  assert.equal(p1.valorCentavos, 130000);
  assert.equal(p1.formaPagamento, 'Boleto');
  assert.equal(p1.dataVencimento, '2026-11-14');
  assert.equal(p1.clienteId, 'c1');
  assert.equal(p1.pedidoId, undefined, 'parcela nova nao e de venda nenhuma');
  assert.equal(p1.descricao, 'Renegociação — parcela 1/2');
  assert.deepEqual(p1.renegociacao.titulosNovos, [`${resumo.renegociacaoId}_p1`, `${resumo.renegociacaoId}_p2`]);
  assert.equal(p1.renegociacao.titulosOrigem.length, 3);
  assert.equal(p2.renegociacao.parcela, 2);

  // Parcela antiga nao recebe mais baixa.
  await assert.rejects(() => receber(s, 'a1'), (e) => e.status === 400 && /renegociada/.test(e.message));

  await receber(s, `${resumo.renegociacaoId}_p1`);
  assert.equal(fake.ler('pedidos_venda/p1').statusPagamento, undefined, '1a parcela nova recebida: vendas ainda pendentes');

  await receber(s, `${resumo.renegociacaoId}_p2`);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 260000);
  assert.equal(fake.ler('pedidos_venda/p1').statusPagamento, 'Paga');
  assert.equal(fake.ler('pedidos_venda/p1').totalPendenteCentavos, 0);
  assert.equal(fake.ler('pedidos_venda/p2').statusPagamento, 'Paga');

  // Estornar uma parcela nova reabre as vendas.
  await s.baixa.registrarEstorno({ user: USER, tenantId: 'emp1', pedido: { tipo: 'entrada', transacaoId: `${resumo.renegociacaoId}_p2`, motivo: 'pix devolvido' } });
  assert.equal(fake.ler('pedidos_venda/p1').statusPagamento, 'Pendente');
  assert.equal(fake.ler('pedidos_venda/p2').totalPendenteCentavos, 100000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 130000);
});

test('desfazer com parcela nova ja recebida: estorna, devolve o banco e reabre as antigas', async () => {
  const fake = criarBancoFalso(cenario());
  const s = carregar(fake.db);
  const { renegociacaoId } = await renegociar(s, [{ valorCentavos: 260000, vencimento: '2026-11-14' }], { formaPagamento: 'Pagamento a Prazo' });
  await receber(s, `${renegociacaoId}_p1`);
  assert.equal(fake.ler('pedidos_venda/p1').statusPagamento, 'Paga');
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 260000);

  const { pedido } = s.reneg.validarPedidoDeDesfazer({ transacaoId: `${renegociacaoId}_p1`, motivo: 'cliente desistiu do acordo' });
  const resumo = await s.reneg.desfazerRenegociacao({ user: USER, tenantId: 'emp1', pedido });
  assert.equal(resumo.estornadas, 1);
  assert.equal(resumo.retiradoDoBancoCentavos, 260000);
  assert.equal(fake.ler('bancos/b1').saldoCentavos, 0);
  const nova = fake.ler(`transacoes/${renegociacaoId}_p1`);
  assert.equal(nova.status, 'Cancelada');
  assert.match(nova.motivoCancelamento, /cliente desistiu/);
  ['a1', 'a2', 'b1'].forEach((id) => {
    const antigo = fake.ler(`transacoes/${id}`);
    assert.equal(antigo.status, 'Pendente');
    assert.equal(antigo.renegociacaoId, undefined);
    assert.equal(antigo.renegociacaoDesfeita.id, renegociacaoId);
  });
  assert.equal(fake.ler('pedidos_venda/p1').statusPagamento, 'Pendente');
  assert.equal(fake.ler('pedidos_venda/p1').totalPendenteCentavos, 200000);

  // Desfazer de novo e' recusado.
  await assert.rejects(() => s.reneg.desfazerRenegociacao({ user: USER, tenantId: 'emp1', pedido }), (e) => e.status === 409);
});

test('recusas: parcela paga, de outro cliente, de outra empresa, venda cancelada, boleto emitido', async () => {
  const base = cenario();
  const fake = criarBancoFalso({
    ...base,
    'transacoes/paga': titulo('paga', 'p1', 3, { status: 'Paga' }),
    'transacoes/outro': titulo('outro', 'p3', 1, { clienteId: 'c2' }),
    'transacoes/fora': titulo('fora', 'p4', 1, { tenantId: 'emp2' }),
    'transacoes/cancelada': titulo('cancelada', 'p9', 1),
    'pedidos_venda/p9': { tenantId: 'emp1', status: 'Cancelada', pagamentos: [] },
    'transacoes/comBoleto': titulo('comBoleto', 'p1', 4, { formaPagamento: 'Boleto', boleto: { status: 'emitido', nossoNumero: '1' } }),
  });
  const s = carregar(fake.db);
  const tentar = (ids) => {
    const { pedido } = s.reneg.validarPedidoDeRenegociacao({ transacaoIds: ids, parcelas: [{ valorCentavos: 100000, vencimento: HOJE }], formaPagamento: 'Pix', motivo: 'acordo para quitar' }, HOJE);
    return s.reneg.criarRenegociacao({ user: USER, tenantId: 'emp1', pedido, hoje: HOJE });
  };
  await assert.rejects(() => tentar(['a1', 'paga']), (e) => e.status === 409 && /já foi recebida/.test(e.message));
  await assert.rejects(() => tentar(['a1', 'outro']), (e) => e.status === 400 && /cliente só/.test(e.message));
  await assert.rejects(() => tentar(['a1', 'fora']), (e) => e.status === 404);
  await assert.rejects(() => tentar(['cancelada']), (e) => e.status === 400 && /venda cancelada/.test(e.message));
  await assert.rejects(() => tentar(['comBoleto']), (e) => e.status === 400 && /Desfaça a emissão/.test(e.message));
  assert.equal(fake.ler('transacoes/a1').status, 'Pendente', 'nada foi gravado');
  assert.equal(fake.listar('transacoes/reneg_').length, 0);
});

test('pedido do navegador: parcelas, forma e motivo conferidos antes do banco', () => {
  const fake = criarBancoFalso({});
  const s = carregar(fake.db);
  const base = { transacaoIds: ['a1'], parcelas: [{ valorCentavos: 100000, vencimento: HOJE }], formaPagamento: 'Boleto', motivo: 'acordo para quitar' };
  assert.ok(s.reneg.validarPedidoDeRenegociacao(base, HOJE).pedido);
  assert.match(s.reneg.validarPedidoDeRenegociacao({ ...base, transacaoIds: [] }, HOJE).erro, /Selecione/);
  assert.match(s.reneg.validarPedidoDeRenegociacao({ ...base, transacaoIds: ['a1', 'a1'] }, HOJE).erro, /duas vezes/);
  assert.match(s.reneg.validarPedidoDeRenegociacao({ ...base, parcelas: [{ valorCentavos: 10, vencimento: '2026-10-01' }] }, HOJE).erro, /antes de hoje/);
  assert.match(s.reneg.validarPedidoDeRenegociacao({ ...base, formaPagamento: 'Cheque' }, HOJE).erro, /Escolha como/);
  assert.match(s.reneg.validarPedidoDeRenegociacao({ ...base, motivo: 'x' }, HOJE).erro, /motivo/);
});

test('gerar boleto de parcela a prazo e voltar a prazo', async () => {
  const fake = criarBancoFalso(cenario());
  const s = carregar(fake.db);
  await s.boletoAPrazo.gerarBoletoDaParcela({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'a1' } });
  const convertida = fake.ler('transacoes/a1');
  assert.equal(convertida.formaPagamento, 'Boleto');
  assert.equal(convertida.boletoDeAPrazo, true);
  assert.equal(convertida.formaPagamentoOriginal, undefined, 'o estorno de baixa continua voltando para Boleto');
  await assert.rejects(() => s.boletoAPrazo.gerarBoletoDaParcela({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'a1' } }), (e) => /já é cobrada em boleto/.test(e.message));

  await s.boletoAPrazo.voltarParcelaAPrazo({ user: USER, tenantId: 'emp1', corpo: { transacaoId: 'a1' } });
  const voltou = fake.ler('transacoes/a1');
  assert.equal(voltou.formaPagamento, 'Pagamento a Prazo');
  assert.equal(voltou.boletoDeAPrazo, undefined);
  assert.equal(fake.ler('pedidos_venda/p1').pagamentos[0].formaPagamento, 'Pagamento a Prazo', 'a venda nao muda');
});
