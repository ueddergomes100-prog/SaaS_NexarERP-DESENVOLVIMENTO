import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bloqueioDoCreditoNaAlteracao,
  bloqueioParaAlterarPagamento,
  camposDoCreditoDevolvido,
  creditoUsadoNaVenda,
  erroDaRotaParaCancelar,
  erroDoMotivoDoCancelamento,
  estornoDosTitulosDaVenda,
  idDoCreditoDevolvido,
  lerPedidoDeAlteracaoDePagamento,
  lerPedidoDeCancelamento,
  lerPedidoDeCancelamentoDaPreVenda,
} from '../src/utils/cancelamentoVendaDomain';
import { lotesQueVoltamNoCancelamento } from '../src/utils/loteRetornoDomain';

const ARGS = { pedidoId: 'p1', numeroPedido: '0154', clienteNome: 'MARIA', usuarioId: 'u1', tenantId: 't1', hoje: '2026-10-19' };

test('motivo do cancelamento: obrigatorio, com tamanho', () => {
  assert.match(String(erroDoMotivoDoCancelamento('')), /mínimo 5/);
  assert.match(String(erroDoMotivoDoCancelamento('   abc ')), /mínimo 5/);
  assert.equal(erroDoMotivoDoCancelamento('cliente desistiu'), null);
  assert.match(String(erroDoMotivoDoCancelamento('x'.repeat(301))), /máximo 300/);
});

test('rota: so a rota em aberto bloqueia', () => {
  assert.equal(erroDaRotaParaCancelar(null, '0154'), null);
  assert.equal(erroDaRotaParaCancelar({ romaneioId: 'r1', situacao: 'entregue' }, '0154'), null);
  assert.equal(erroDaRotaParaCancelar({ romaneioId: 'r1', situacao: 'liberado' }, '0154'), null);
  assert.match(String(erroDaRotaParaCancelar({ romaneioId: 'r1', romaneioTitulo: 'Rota 03', situacao: 'em_romaneio' }, '0154')), /#0154 está na rota "Rota 03"/);
});

test('credito de devolucao usado e o credito devolvido', () => {
  const pagamentos = [
    { formaPagamento: 'Crédito de Devolução', valorCentavos: 3000 },
    { formaPagamento: 'Pix', valorCentavos: 7000 },
    { formaPagamento: 'Crédito de Devolução', valor: 12.5 },
  ];
  assert.equal(creditoUsadoNaVenda(pagamentos), 4250);
  assert.equal(creditoUsadoNaVenda(undefined), 0);
  assert.equal(idDoCreditoDevolvido('p1'), 'cancelamento_p1');
  const campos = camposDoCreditoDevolvido({ pedidoId: 'p1', numeroPedido: '0154', clienteNome: ' maria ', valorCentavos: 4250, tenantId: 't1' });
  assert.equal(campos.clienteNome, 'MARIA');
  assert.equal(campos.saldoDisponivel, 42.5);
  assert.equal(campos.saldoDisponivelCentavos, 4250);
  assert.equal(campos.status, 'disponivel');
  Object.values(campos).forEach((v) => assert.notEqual(v, undefined));
});

test('estorno dos lancamentos: pago vira estorno de saida, aberto e cancelado, ja cancelado fica', () => {
  const escritas = estornoDosTitulosDaVenda([
    { id: 'p1', dados: { status: 'Paga', formaPagamento: 'Dinheiro', valor: 50, valorCentavos: 5000 } },
    { id: 'p1_pag_2', dados: { status: 'Pendente', formaPagamento: 'Pagamento a Prazo', valorCentavos: 3000 } },
    { id: 'p1_pag_3', dados: { status: 'Cancelada' } },
    { id: 'p1_pag_4', dados: { status: 'Paga', formaPagamento: 'Pix', valorCentavos: 2000, naturezaFinanceira: 'bancario_digital', movimentaCaixaFisico: false } },
  ], ARGS);
  assert.deepEqual(escritas.atualizar.map((a) => a.id), ['p1', 'p1_pag_2', 'p1_pag_4']);
  assert.deepEqual(escritas.atualizar[1].campos, { status: 'Cancelada', movimentaCaixaFisico: false });
  assert.deepEqual(escritas.criar.map((c) => c.id), ['estorno_cancelamento_p1', 'estorno_cancelamento_p1_pag_4']);
  const dinheiro = escritas.criar[0].campos;
  assert.equal(dinheiro.tipo, 'saida');
  assert.equal(dinheiro.naturezaFinanceira, 'caixa_fisico');
  assert.equal(dinheiro.valorCentavos, 5000);
  assert.equal(dinheiro.idempotencyKey, 'cancelamento:p1:transacao:p1');
  assert.equal(escritas.criar[1].campos.naturezaFinanceira, 'bancario_digital');
  escritas.criar.forEach((c) => Object.values(c.campos).forEach((v) => assert.notEqual(v, undefined)));
});

test('alterar pagamento: nasceu pago pode; recebido depois, parcial, boleto e cheque compensado bloqueiam', () => {
  assert.equal(bloqueioParaAlterarPagamento([{ status: 'Paga', formaPagamento: 'Dinheiro' }, { status: 'Pendente', formaPagamento: 'Pagamento a Prazo' }]), null);
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Paga', descricao: 'Venda #1', baixaManual: { origem: 'dar_baixa' }, dataPagamento: '2026-10-10' }])), /recebida em 10\/10\/2026 no Contas a Receber/);
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Pendente', descricao: 'Venda #1', pagoParcialCentavos: 10000 }])), /R\$ 100,00 recebidos por partes/);
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Paga', parcialDaTransacaoId: 'x', valorCentavos: 5000 }])), /recebimento parcial de R\$ 50,00/);
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Pendente', descricao: 'Venda #1', boleto: { status: 'registrado' } }])), /boleto emitido/);
  assert.equal(bloqueioParaAlterarPagamento([{ status: 'Pendente', boleto: { status: 'cancelado' } }]), null);
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Paga', formaPagamento: 'Cheque', descricao: 'Venda #1' }])), /cheque .* compensado/);
  // lancamento ja' cancelado ou estornado nao conta
  assert.equal(bloqueioParaAlterarPagamento([{ status: 'Cancelada', baixaManual: {} }, { status: 'Paga', estornada: true, baixaManual: {} }]), null);
});

test('alterar pagamento: a parte em credito de devolucao nao muda', () => {
  const antes = [{ formaPagamento: 'Crédito de Devolução', valorCentavos: 3000 }, { formaPagamento: 'Pix', valorCentavos: 7000 }];
  assert.equal(bloqueioDoCreditoNaAlteracao(antes, [{ formaPagamento: 'Crédito de Devolução', valorCentavos: 3000 }, { formaPagamento: 'Dinheiro', valorCentavos: 7000 }]), null);
  assert.match(String(bloqueioDoCreditoNaAlteracao(antes, [{ formaPagamento: 'Dinheiro', valorCentavos: 10000 }])), /crédito de devolução/);
});

test('lotes que voltam no cancelamento: soma por lote', () => {
  const itens = [
    { id: 'a', lotes: [{ loteId: 'L1', lote: 'L1', validade: null, quantidade: 2 }, { loteId: 'L2', lote: 'L2', validade: null, quantidade: 1 }] },
    { id: 'b', lotes: [{ loteId: 'L1', lote: 'L1', validade: null, quantidade: 3 }] },
    { id: 'c' },
  ];
  assert.deepEqual(lotesQueVoltamNoCancelamento(itens).map((l) => [l.loteId, l.quantidade]), [['L1', 5], ['L2', 1]]);
  assert.deepEqual(lotesQueVoltamNoCancelamento(null), []);
});

test('o que a tela manda: pedido valido, motivo e pagamentos', () => {
  assert.deepEqual(lerPedidoDeCancelamento({ pedidoId: 'abc_1', motivo: '  cliente desistiu ' }), { pedidoId: 'abc_1', motivo: 'cliente desistiu' });
  assert.match(String((lerPedidoDeCancelamento({ pedidoId: 'abc', motivo: '' }) as { erro: string }).erro), /motivo/);
  assert.match(String((lerPedidoDeCancelamento({ pedidoId: '../x', motivo: 'cliente desistiu' }) as { erro: string }).erro), /Venda inválida/);
  assert.deepEqual(lerPedidoDeCancelamentoDaPreVenda({ pedidoId: 'p1' }), { pedidoId: 'p1', nota: 'Pré-venda cancelada' });
  assert.match(String((lerPedidoDeAlteracaoDePagamento({ pedidoId: 'p1', pagamentos: [] }) as { erro: string }).erro), /forma de pagamento/);
  assert.equal((lerPedidoDeAlteracaoDePagamento({ pedidoId: 'p1', pagamentos: [{ forma: 'Pix' }] }) as { pagamentos: unknown[] }).pagamentos.length, 1);
});


test('bloqueioDoCreditoNaAlteracao: cashback (20/10/2026) tambem nao se troca por aqui', () => {
  const antes = [{ formaPagamento: 'Cashback', valorCentavos: 1000 }, { formaPagamento: 'Pix', valorCentavos: 9000 }];
  assert.equal(bloqueioDoCreditoNaAlteracao(antes, [{ formaPagamento: 'Cashback', valorCentavos: 1000 }, { formaPagamento: 'Dinheiro', valorCentavos: 9000 }]), null);
  assert.match(String(bloqueioDoCreditoNaAlteracao(antes, [{ formaPagamento: 'Pix', valorCentavos: 10000 }])), /cashback/);
});
