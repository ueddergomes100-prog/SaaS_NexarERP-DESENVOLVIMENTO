import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assinaturaDaCobrancaDaOs,
  bloqueioParaReabrirOs,
  camposDescritivosDaOs,
  corDoStatusDaOs,
  erroDasNotasParaCancelarOs,
  idsDosTitulosGravados,
  lerPedidoDeCancelamentoDaOs,
  lerPedidoDeFinalizacaoDaOs,
  lerPedidoDeReaberturaDaOs,
  novoSaldoDoProduto,
  pecasQueSairamDoEstoque,
  planoDaFinalizacaoDaOs,
  planoDaReaberturaDaOs,
  planoDoCancelamentoDaOs,
  titulosQueSaemNaFinalizacao,
  totaisDaOs,
  type EntradaDaFinalizacao,
} from '../src/utils/osFechamentoDomain';
import { bloqueioParaAlterarPagamento, estornoDosTitulosDaVenda } from '../src/utils/cancelamentoVendaDomain';
import { reopenCommissionSnapshot, type PaymentRecord } from '../src/utils/financeDomain';
import { baseConsideradaCentavos, rotuloStatusComissao, type EntradaComissao } from '../src/utils/relatorioComissoesDomain';

/* Fatia 3d (19/10/2026): finalizar, reabrir e cancelar a OS -- a mesma regra na tela e no servidor. */

const OS = {
  numeroOS: '07',
  status: 'Em Manutenção',
  clienteId: 'cli1',
  clienteNome: 'JOSE',
  mecanicoId: 'mec1',
  mecanicoNome: 'PEDRO',
  servicos: [{ id: 's1', nome: 'TROCA DE OLEO', preco: 50, quantidade: 1 }],
  pecas: [{ id: 'p1', nome: 'FILTRO', preco: 25, quantidade: 2 }],
  desconto: { tipo: 'valor', valorInformado: 0 },
  estoqueBaixado: false,
  estoqueReservado: false,
};

const pix = (extra: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'pg1', indice: 1, formaPagamento: 'Pix', condicaoPagamento: 'avista', valorCentavos: 10000, valor: 100,
  status: 'confirmado', naturezaFinanceira: 'bancario_digital', movimentaCaixaFisico: false, bancoId: 'b1', bancoNome: 'SICOOB', ...extra,
});

const entrada = (extra: Partial<EntradaDaFinalizacao> = {}): EntradaDaFinalizacao => ({
  osId: 'os1',
  tenantId: 't1',
  usuarioId: 'u1',
  os: OS,
  dataSaida: '2026-10-19',
  pagamentos: [pix()],
  lotesPorLinha: {},
  mecanico: { nome: 'PEDRO', recebeComissaoServicos: true, comissaoPercentualServicos: 5 },
  percentualDoServico: (id) => (id === 's1' ? 20 : undefined),
  percentualDaPeca: () => undefined,
  comissaoPadraoPecas: 3,
  agoraIso: '2026-10-19T12:00:00.000Z',
  ...extra,
});

const plano = (r: ReturnType<typeof planoDaFinalizacaoDaOs>) => {
  if ('erro' in r) throw new Error(r.erro);
  return r.plano;
};

// ------------------------------------------------------------------ totais

test('totais da OS: servico por hora, peca por quantidade e desconto geral (a conta da tela)', () => {
  const t = totaisDaOs({
    servicos: [{ preco: 80, tempoHoras: 1.5 }, { preco: 30, quantidade: 2 }],
    pecas: [{ preco: 12.9, quantidade: 3 }],
    desconto: { tipo: 'percentual', valorInformado: 10 },
  });
  assert.equal(t.totalServicos, 180);
  assert.equal(Math.round(t.totalPecas * 100), 3870);
  assert.equal(t.descontoCentavos, 2187);
  assert.equal(t.valorTotalCentavos, 21870 - 2187);
  assert.equal(totaisDaOs({ servicos: [], pecas: [{ preco: 10, quantidade: 1 }], desconto: { tipo: 'valor', valorInformado: '3' } }).valorTotalCentavos, 700);
});

test('assinatura da cobranca: muda com preco, quantidade, desconto, cliente, tecnico e data de saida; unidade nao conta', () => {
  const base = assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19' });
  assert.equal(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', pecas: [{ ...OS.pecas[0], unidadeMedidaSigla: 'UN' }] }), base);
  assert.equal(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', clienteNome: ' jose ' }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', pecas: [{ ...OS.pecas[0], quantidade: 3 }] }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', servicos: [{ ...OS.servicos[0], preco: 60 }] }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', desconto: { tipo: 'valor', valorInformado: '5' } }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', clienteNome: 'MARIA' }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-19', mecanicoId: 'mec2' }), base);
  assert.notEqual(assinaturaDaCobrancaDaOs({ ...OS, dataSaida: '2026-10-20' }), base);
});

test('dados descritivos: so os campos que nao mexem em dinheiro', () => {
  const campos = camposDescritivosDaOs({ observacoes: 'ok', placa: 'ABC1D23', status: 'Finalizada', pecas: [], valorTotal: 9, clienteNome: 'X' });
  assert.deepEqual(campos, { observacoes: 'ok', placa: 'ABC1D23' });
});

test('cor da situacao: a mesma da lista de OS', () => {
  assert.equal(corDoStatusDaOs('Finalizada'), '#10b981');
  assert.equal(corDoStatusDaOs('Cancelada'), '#ef4444');
  assert.equal(corDoStatusDaOs('Aguardando conferência'), '#f97316');
  assert.equal(corDoStatusDaOs('qualquer'), '#6b7280');
});

// ------------------------------------------------------------- notas e bloqueios

test('nota da OS autorizada ou sem resposta impede cancelar; devolucao e cancelada nao', () => {
  assert.match(String(erroDasNotasParaCancelarOs([{ id: 'n1', tipo: 'NFS-e', status: 'authorized', number: 12 }], '07')), /NFS-e nº 12 da OS #07 está autorizada/);
  assert.match(String(erroDasNotasParaCancelarOs([{ id: 'n1', tipo: 'NF-e', status: 'processing', number: 3 }], '07')), /aguardando resposta/);
  assert.equal(erroDasNotasParaCancelarOs([{ id: 'n1', tipo: 'NF-e', status: 'authorized', finalidade: 'devolucao' }], '07'), null);
  assert.equal(erroDasNotasParaCancelarOs([{ id: 'n1', tipo: 'NFS-e', status: 'canceled' }], '07'), null);
});

test('reabrir: bloqueado com parcela recebida, parcial, boleto ou renegociada; pago na hora nao bloqueia', () => {
  assert.match(String(bloqueioParaReabrirOs([{ status: 'Paga', baixaManual: { origem: 'x' }, descricao: 'Recebimento OS #07', dataPagamento: '2026-10-19' }])), /já foi recebida em 19\/10\/2026.*antes de reabrir a OS/);
  assert.match(String(bloqueioParaReabrirOs([{ status: 'Pendente', pagoParcialCentavos: 500, descricao: 'X' }])), /recebidos por partes/);
  assert.match(String(bloqueioParaReabrirOs([{ status: 'Pendente', boleto: { status: 'emitido' }, descricao: 'X' }])), /boleto emitido.*antes de reabrir a OS/);
  assert.match(String(bloqueioParaReabrirOs([{ status: 'Renegociada', descricao: 'X' }])), /renegociada/);
  assert.equal(bloqueioParaReabrirOs([{ status: 'Paga', formaPagamento: 'Pix' }]), null);
});

test('bloqueio de alterar pagamento da venda continua com o texto de sempre', () => {
  assert.match(String(bloqueioParaAlterarPagamento([{ status: 'Paga', baixaManual: {}, descricao: 'X' }])), /antes de alterar a forma de pagamento/);
  assert.match(String(bloqueioParaAlterarPagamento([{ parcialDaTransacaoId: 't', valorCentavos: 100 }])), /^Esta venda tem um recebimento parcial/);
});

// ------------------------------------------------------------------ leitura do pedido

test('o que a tela manda: finalizar, cancelar e reabrir', () => {
  assert.match(String((lerPedidoDeFinalizacaoDaOs({ osId: '../x' }) as { erro: string }).erro), /OS inválida/);
  assert.match(String((lerPedidoDeFinalizacaoDaOs({ osId: 'os1', dataSaida: '19/10' }) as { erro: string }).erro), /data de saída/);
  assert.match(String((lerPedidoDeFinalizacaoDaOs({ osId: 'os1', dataSaida: '2026-10-19', pagamentos: [] }) as { erro: string }).erro), /forma de pagamento/);
  assert.match(String((lerPedidoDeFinalizacaoDaOs({ osId: 'os1', dataSaida: '2026-10-19', pagamentos: [{}], lotes: { 0: [{ loteId: 'l1', quantidade: 0 }] } }) as { erro: string }).erro), /Lote inválido/);
  const ok = lerPedidoDeFinalizacaoDaOs({ osId: 'os1', dataSaida: '2026-10-19', pagamentos: [{ forma: 'Pix' }], lotes: { 0: [{ loteId: 'l1', lote: 'A', quantidade: 2 }] } });
  assert.ok('pedido' in ok && ok.pedido.lotes['0'][0].quantidade === 2);

  assert.match(String((lerPedidoDeCancelamentoDaOs({ osId: 'os1', motivo: 'abc' }) as { erro: string }).erro), /mínimo 5/);
  const cancelar = lerPedidoDeCancelamentoDaOs({ osId: 'os1', motivo: ' cliente desistiu ', devolverEstoque: true });
  assert.deepEqual(cancelar, { osId: 'os1', motivo: 'cliente desistiu', devolverEstoque: true });
  assert.equal((lerPedidoDeCancelamentoDaOs({ osId: 'os1', motivo: 'cliente desistiu', devolverEstoque: 'sim' }) as { devolverEstoque: boolean }).devolverEstoque, false);

  assert.deepEqual(lerPedidoDeReaberturaDaOs({ osId: 'os1' }), { osId: 'os1', status: 'Em Manutenção' });
  assert.match(String((lerPedidoDeReaberturaDaOs({ osId: 'os1', status: 'Finalizada' }) as { erro: string }).erro), /situação/);
});

// ------------------------------------------------------------------ finalizar

test('finalizar: lancamentos com o id da OS, credito no banco, estoque e pecas que sairam', () => {
  const p = plano(planoDaFinalizacaoDaOs(entrada()));
  assert.equal(p.totais.valorTotalCentavos, 10000);
  assert.deepEqual(p.titulos.map((t) => t.id), ['os1']);
  assert.equal(p.titulos[0].campos.descricao, 'Recebimento OS #07 - Pix');
  assert.equal(p.titulos[0].campos.status, 'Paga');
  assert.equal(p.titulos[0].campos.idempotencyKey, 'os:os1:pagamento:1');
  assert.equal(p.creditoPorBanco.get('b1'), 10000);
  assert.deepEqual(p.estoque, [{ id: 'p1', nome: 'FILTRO', quantidadeDelta: -2, quantidadeReservadaDelta: 0 }]);
  assert.equal(p.camposDaOs.status, 'Finalizada');
  assert.equal(p.camposDaOs.statusPagamento, 'Paga');
  assert.deepEqual(p.camposDaOs.pecasBaixadas, [{ id: 'p1', nome: 'FILTRO', quantidade: 2 }]);
});

test('finalizar: comissao por item (servico proprio > tecnico > sistema) e sempre refeita', () => {
  const comissaoVelha = { status: 'reaberta', valorAtualCentavos: 0, regraVersion: 1 };
  const p = plano(planoDaFinalizacaoDaOs(entrada({ os: { ...OS, comissao: comissaoVelha } })));
  // servico: 20% (proprio) de 50 = 10,00; peca: tecnico nao recebe por peca -> 0
  assert.equal(p.comissao.status, 'gerada');
  assert.equal(p.comissao.valorAtualCentavos, 1000);
  assert.equal(p.comissao.geradaEm, '2026-10-19T12:00:00.000Z');
});

test('finalizar com reserva: libera a reserva e tira de verdade; OS antiga ja baixada nao baixa de novo', () => {
  const reservada = plano(planoDaFinalizacaoDaOs(entrada({ os: { ...OS, estoqueReservado: true } })));
  assert.deepEqual(reservada.estoque, [{ id: 'p1', nome: 'FILTRO', quantidadeDelta: -2, quantidadeReservadaDelta: -2 }]);
  const baixada = plano(planoDaFinalizacaoDaOs(entrada({ os: { ...OS, estoqueBaixado: true }, lotesPorLinha: { 0: [{ loteId: 'l1', lote: 'A', validade: null, quantidade: 2 }] } })));
  assert.deepEqual(baixada.estoque, []);
  assert.deepEqual(baixada.lotes, []);
  assert.equal('pecasBaixadas' in baixada.camposDaOs, false);
});

test('finalizar: a prazo parcelado gera um lancamento por parcela, todos pendentes', () => {
  const parcelas = [
    pix({ id: 'a', indice: 1, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', status: 'pendente', valorCentavos: 5000, valor: 50, bancoId: undefined, dataVencimento: '2026-11-18' }),
    pix({ id: 'b', indice: 2, formaPagamento: 'Pagamento a Prazo', condicaoPagamento: 'aprazo', status: 'pendente', valorCentavos: 5000, valor: 50, bancoId: undefined, dataVencimento: '2026-12-18' }),
  ];
  const p = plano(planoDaFinalizacaoDaOs(entrada({ pagamentos: parcelas })));
  assert.deepEqual(p.titulos.map((t) => t.id), ['os1', 'os1_pag_2']);
  assert.deepEqual(p.titulos.map((t) => t.campos.status), ['Pendente', 'Pendente']);
  assert.equal(p.creditoPorBanco.size, 0);
  assert.equal(p.camposDaOs.statusPagamento, 'Pendente');
});

test('finalizar: recusa credito de devolucao, soma errada, OS ja finalizada ou cancelada', () => {
  assert.match(String((planoDaFinalizacaoDaOs(entrada({ pagamentos: [pix({ formaPagamento: 'Crédito de Devolução' })] })) as { erro: string }).erro), /Crédito de devolução não pode ser usado em OS/);
  assert.match(String((planoDaFinalizacaoDaOs(entrada({ pagamentos: [pix({ valorCentavos: 9000, valor: 90 })] })) as { erro: string }).erro), /somam R\$ 90,00, mas a OS é de R\$ 100,00/);
  assert.match(String((planoDaFinalizacaoDaOs(entrada({ os: { ...OS, status: 'Finalizada' } })) as { erro: string }).erro), /já está finalizada/);
  assert.match(String((planoDaFinalizacaoDaOs(entrada({ os: { ...OS, status: 'Cancelada' } })) as { erro: string }).erro), /não volta a ser aberta/);
});

test('ids dos lancamentos gravados e os que saem ao finalizar', () => {
  assert.deepEqual(idsDosTitulosGravados('os1', []), ['os1']);
  assert.deepEqual(idsDosTitulosGravados('os1', [{ transactionId: 'os1' }, {}, { transactionId: 'x' }]), ['os1', 'os1_pag_2', 'x']);
  const existentes = [
    { id: 'os1', dados: { status: 'Cancelada' } },
    { id: 'os1_pag_2', dados: { status: 'Pendente' } },
    { id: 'os1_pag_3', dados: { status: 'Cancelada' } },
  ];
  assert.deepEqual(titulosQueSaemNaFinalizacao(existentes, ['os1']), ['os1_pag_2']);
});

// ------------------------------------------------------------------ reabrir

test('reabrir: banco estornado, lancamentos cancelados, pecas e lotes de volta, comissao reaberta', () => {
  const finalizada = {
    ...OS,
    status: 'Finalizada',
    estoqueBaixado: true,
    pecasBaixadas: [{ id: 'p1', nome: 'FILTRO', quantidade: 2 }],
    lotesBaixados: [{ loteId: 'l1', lote: 'A', validade: null, quantidade: 2 }],
    pagamentos: [pix({ transactionId: 'os1' })],
    comissao: { status: 'gerada', valorAtualCentavos: 1000, valorAtual: 10, regraVersion: 1 },
  };
  const r = planoDaReaberturaDaOs({
    os: finalizada,
    titulos: [{ id: 'os1', dados: { status: 'Paga', formaPagamento: 'Pix' } }, { id: 'velho', dados: { status: 'Cancelada' } }],
    status: 'Aguardando Peça',
    agoraIso: '2026-10-19T13:00:00.000Z',
  });
  assert.ok('plano' in r);
  assert.equal(r.plano.debitoPorBanco.get('b1'), 10000);
  assert.deepEqual(r.plano.titulosCancelados, ['os1']);
  assert.deepEqual(r.plano.estoque, [{ id: 'p1', nome: 'FILTRO', quantidadeDelta: 2, quantidadeReservadaDelta: 0 }]);
  assert.deepEqual(r.plano.lotes.map((l) => [l.loteId, l.quantidade]), [['l1', 2]]);
  assert.equal(r.plano.camposDaOs.status, 'Aguardando Peça');
  assert.equal(r.plano.camposDaOs.estoqueBaixado, false);
  const comissao = r.plano.camposDaOs.comissao as { status: string; valorAtualCentavos: number; reabertaEm: string };
  assert.equal(comissao.status, 'reaberta');
  assert.equal(comissao.valorAtualCentavos, 0);
  assert.equal(comissao.reabertaEm, '2026-10-19T13:00:00.000Z');
});

test('reabrir: so OS finalizada; parcela recebida bloqueia', () => {
  assert.match(String((planoDaReaberturaDaOs({ os: OS, titulos: [], status: 'Em Manutenção', agoraIso: '' }) as { erro: string }).erro), /não está finalizada/);
  const bloqueada = planoDaReaberturaDaOs({
    os: { ...OS, status: 'Finalizada' },
    titulos: [{ id: 'os1', dados: { status: 'Paga', baixaManual: {}, descricao: 'Recebimento OS #07' } }],
    status: 'Em Manutenção',
    agoraIso: '',
  });
  assert.match(String((bloqueada as { erro: string }).erro), /antes de reabrir a OS/);
});

test('pecas que sairam: as gravadas na finalizacao; OS antiga usa a lista de pecas', () => {
  assert.deepEqual(pecasQueSairamDoEstoque({ pecas: [{ id: 'p1', quantidade: 5 }], pecasBaixadas: [{ id: 'p1', quantidade: 2 }] }).map((p) => p.quantidade), [2]);
  assert.deepEqual(pecasQueSairamDoEstoque({ pecas: [{ id: 'p1', quantidade: 5 }, { id: 'avulso', quantidade: 1 }] }).map((p) => p.quantidade), [5]);
});

// ------------------------------------------------------------------ cancelar

const cancelamento = (extra: Partial<Parameters<typeof planoDoCancelamentoDaOs>[0]> = {}) => planoDoCancelamentoDaOs({
  osId: 'os1',
  os: { ...OS, status: 'Finalizada', estoqueBaixado: true, pecasBaixadas: [{ id: 'p1', nome: 'FILTRO', quantidade: 2 }], pagamentos: [pix({ transactionId: 'os1' })], comissao: { status: 'gerada', valorAtualCentavos: 1000, regraVersion: 1 } },
  titulos: [{ id: 'os1', dados: { status: 'Paga', formaPagamento: 'Pix', valor: 100, valorCentavos: 10000 } }],
  motivo: 'cliente desistiu',
  devolverEstoque: true,
  usuarioId: 'u1',
  usuarioNome: 'GERENTE',
  tenantId: 't1',
  hoje: '2026-10-19',
  agoraIso: '2026-10-19T14:00:00.000Z',
  ...extra,
});

test('cancelar OS finalizada: estorno do pago, banco, pecas de volta, comissao cancelada e motivo', () => {
  const r = cancelamento();
  assert.ok('plano' in r);
  assert.equal(r.plano.debitoPorBanco.get('b1'), 10000);
  assert.deepEqual(r.plano.estoque, [{ id: 'p1', nome: 'FILTRO', quantidadeDelta: 2, quantidadeReservadaDelta: 0 }]);
  const estorno = r.plano.titulos.criar[0];
  assert.equal(estorno.id, 'estorno_cancelamento_os1');
  assert.equal(estorno.campos.categoria, 'Cancelamento de OS');
  assert.equal(estorno.campos.sourceType, 'cancelamento_ordem_servico');
  assert.equal(estorno.campos.osId, 'os1');
  assert.equal(estorno.campos.descricao, 'Estorno do cancelamento da OS #07');
  assert.equal('pedidoId' in estorno.campos, false);
  assert.equal(r.plano.titulos.atualizar[0].nota, 'Estornada pelo cancelamento da OS');
  assert.equal(r.plano.camposDaOs.motivoCancelamento, 'cliente desistiu');
  assert.equal(r.plano.camposDaOs.estoqueBaixado, false);
  assert.equal((r.plano.camposDaOs.comissao as { status: string }).status, 'cancelada');
});

test('cancelar sem devolver: estoque fica; OS em aberto com reserva solta a reserva', () => {
  const semDevolver = cancelamento({ devolverEstoque: false });
  assert.ok('plano' in semDevolver);
  assert.deepEqual(semDevolver.plano.estoque, []);
  assert.equal('estoqueBaixado' in semDevolver.plano.camposDaOs, false);

  const aberta = cancelamento({ os: { ...OS, estoqueReservado: true }, titulos: [] });
  assert.ok('plano' in aberta);
  assert.deepEqual(aberta.plano.estoque, [{ id: 'p1', nome: 'FILTRO', quantidadeDelta: 0, quantidadeReservadaDelta: -2 }]);
  assert.equal(aberta.plano.debitoPorBanco.size, 0);
});

test('cancelar: ja cancelada ou com parcela renegociada e recusado', () => {
  assert.match(String((cancelamento({ os: { ...OS, status: 'Cancelada' } }) as { erro: string }).erro), /já foi cancelada/);
  assert.match(String((cancelamento({ titulos: [{ id: 'os1', dados: { status: 'Renegociada' } }] }) as { erro: string }).erro), /cancelar a OS/);
});

test('estorno da venda continua igual depois de servir a OS', () => {
  const e = estornoDosTitulosDaVenda([{ id: 'v1', dados: { status: 'Paga', valor: 20, valorCentavos: 2000, formaPagamento: 'Dinheiro', movimentaCaixaFisico: true } }],
    { pedidoId: 'v1', numeroPedido: '0154', clienteNome: 'MARIA', usuarioId: 'u1', tenantId: 't1', hoje: '2026-10-19' });
  assert.equal(e.criar[0].campos.pedidoId, 'v1');
  assert.equal(e.criar[0].campos.categoria, 'Cancelamento de Venda');
  assert.equal(e.criar[0].campos.descricao, 'Estorno do cancelamento da venda #0154');
  assert.equal(e.criar[0].campos.sourceType, 'cancelamento_pedido_venda');
  assert.equal(e.atualizar[0].nota, 'Estornada pelo cancelamento da venda');
});

// ------------------------------------------------------------------ estoque e comissao

test('novo saldo do produto: confere estoque e reserva so na saida', () => {
  assert.deepEqual(novoSaldoDoProduto({ id: 'p1', quantidadeDelta: -2, quantidadeReservadaDelta: 0 }, { quantidade: 5, quantidadeReservada: 1 }, false), { quantidade: 3, quantidadeReservada: 1 });
  assert.match(String((novoSaldoDoProduto({ id: 'p1', nome: 'FILTRO', quantidadeDelta: -6, quantidadeReservadaDelta: 0 }, { quantidade: 5 }, false) as { erro: string }).erro), /Estoque insuficiente para FILTRO/);
  assert.match(String((novoSaldoDoProduto({ id: 'p1', nome: 'FILTRO', quantidadeDelta: -2, quantidadeReservadaDelta: 0 }, { quantidade: 5, quantidadeReservada: 4 }, false) as { erro: string }).erro), /Estoque reservado/);
  assert.deepEqual(novoSaldoDoProduto({ id: 'p1', quantidadeDelta: -6, quantidadeReservadaDelta: 0 }, { quantidade: 5 }, true), { quantidade: -1, quantidadeReservada: 0 });
  assert.equal(novoSaldoDoProduto({ id: 'p1', quantidadeDelta: 2, quantidadeReservadaDelta: 0 }, null, false), null);
});

test('comissao reaberta: sem valor e fora da base do relatorio', () => {
  const reaberta = reopenCommissionSnapshot({ status: 'gerada', valorAtualCentavos: 900, valorAtual: 9 }, '2026-10-19T00:00:00.000Z');
  assert.equal(reaberta.status, 'reaberta');
  assert.equal(reaberta.valorAtualCentavos, 0);
  const linha = { status: 'reaberta', baseCents: 5000, valueCents: 0, historical: true } as EntradaComissao;
  assert.equal(baseConsideradaCentavos(linha), 0);
  assert.equal(rotuloStatusComissao('reaberta'), 'Reaberta');
});
