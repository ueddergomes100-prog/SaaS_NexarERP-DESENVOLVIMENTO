import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DIAS_PARA_FECHAR_ATRASADO,
  aberturaConfereComAGaveta,
  avisoDaAbertura,
  comporPorDia,
  composicaoDaSessao,
  diasParaFechar,
  ehACaixaGaveta,
  erroDoTroco,
  inicioDaComposicao,
  lerPedidoDeAcerto,
  lerPedidoDeCofreNoFechamento,
  planejarAcerto,
  saldoNoFimDoDia,
  tituloAteODia,
  esperadoNoFechamento,
  lerConfigGaveta,
  montarConfigGaveta,
  movimentoDoTitulo,
  movimentoNoPeriodo,
  movimentosDaSessao,
  resultadoDaContagem,
  saldoDosMovimentos,
} from '../src/utils/gavetaDinheiroDomain';

/*
 * Dinheiro das vendas na gaveta (23/11/2026, Embala Minas): a chave da empresa,
 * o que vira movimento do CAIXA (titulo pago em dinheiro, sangria, diferenca do
 * fechamento) e o saldo esperado no fechamento do PDV.
 */

test('chave: desligada por padrao; a data nasce ao ligar e nao muda mais', () => {
  assert.deepEqual(lerConfigGaveta(null), { ativo: false, desde: '' });
  assert.deepEqual(lerConfigGaveta({ gavetaDinheiro: { ativo: true } }), { ativo: false, desde: '' }, 'sem data valida vale como desligada');
  assert.deepEqual(lerConfigGaveta({ gavetaDinheiro: { ativo: true, desde: '2026-11-23' } }), { ativo: true, desde: '2026-11-23' });

  const ligada = montarConfigGaveta(true, { ativo: false, desde: '' }, '2026-11-23');
  assert.deepEqual(ligada, { ativo: true, desde: '2026-11-23' });
  const desligada = montarConfigGaveta(false, ligada, '2026-12-01');
  assert.deepEqual(desligada, { ativo: false, desde: '2026-11-23' });
  assert.deepEqual(montarConfigGaveta(true, desligada, '2026-12-10'), { ativo: true, desde: '2026-11-23' }, 'religar nao repete nem apaga o que ja contou');
  assert.deepEqual(montarConfigGaveta(false, { ativo: false, desde: '' }, '2026-11-23'), { ativo: false, desde: '' });
});

test('a gaveta e o CAIXA padrao ativo (COFRE e caixa criado a mao nao)', () => {
  assert.equal(ehACaixaGaveta({ nome: 'CAIXA', padrao: true, ativo: true }), true);
  assert.equal(ehACaixaGaveta({ nome: 'CAIXA', padrao: true }), true);
  assert.equal(ehACaixaGaveta({ nome: 'COFRE', padrao: true, ativo: true }), false);
  assert.equal(ehACaixaGaveta({ nome: 'CAIXA', padrao: false, ativo: true }), false);
  assert.equal(ehACaixaGaveta({ nome: 'CAIXA', padrao: true, ativo: false }), false);
});

test('titulo: so o pago em dinheiro vira movimento; venda cancelada e o estorno se anulam', () => {
  const venda = movimentoDoTitulo('t1', { tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 7710, descricao: 'Venda Direta #0004 - Dinheiro', dataPagamento: '2026-11-23', data: '2026-11-23' });
  assert.deepEqual(venda, { id: 'titulo:t1', tipo: 'dinheiro_entrada', direcao: 'credito', valorCentavos: 7710, descricao: 'Venda Direta #0004 - Dinheiro', data: '2026-11-23', criadoEmIso: '' });

  // Estorno da venda cancelada: saida paga, so com `data`.
  const estorno = movimentoDoTitulo('t2', { tipo: 'saida', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: true, valorCentavos: 7710, descricao: 'Estorno', data: '2026-11-23' });
  assert.equal(estorno?.direcao, 'debito');
  assert.equal(saldoDosMovimentos([venda!, estorno!]), 0);

  // Valor antigo so em reais; lancamento do Fluxo de Caixa sem o campo booleano.
  assert.equal(movimentoDoTitulo('t3', { tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', valor: 12.5, data: '2026-11-22' })?.valorCentavos, 1250);

  assert.equal(movimentoDoTitulo('p', { tipo: 'entrada', status: 'Paga', formaPagamento: 'Pix', movimentaCaixaFisico: false, valorCentavos: 100, dataPagamento: '2026-11-23' }), null, 'pix nao e gaveta');
  assert.equal(movimentoDoTitulo('a', { tipo: 'entrada', status: 'Pendente', formaPagamento: 'Dinheiro', valorCentavos: 100, data: '2026-11-23' }), null, 'em aberto nao entrou');
  assert.equal(movimentoDoTitulo('c', { tipo: 'entrada', status: 'Cancelada', formaPagamento: 'Dinheiro', movimentaCaixaFisico: false, valorCentavos: 100, data: '2026-11-23' }), null);
  assert.equal(movimentoDoTitulo('e', { tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', movimentaCaixaFisico: false, valorCentavos: 100, dataPagamento: '2026-11-23' }), null, 'baixa estornada deixa de mover o caixa');
  assert.equal(movimentoDoTitulo('z', { tipo: 'entrada', status: 'Paga', formaPagamento: 'Dinheiro', valorCentavos: 0, data: '2026-11-23' }), null);
});

test('sessao do PDV: sangria sempre sai; diferenca so quando o fechamento foi pela gaveta', () => {
  const fechadoEm = new Date('2026-11-23T21:30:00.000Z');
  const sessao = {
    status: 'fechado',
    operadorNome: 'CAIXA',
    terminalNome: 'Caixa 1',
    sangrias: [
      { id: 'g1', valorCentavos: 5000, motivo: 'Troco para o motoboy', registradoEm: '2026-11-23T15:00:00.000Z' },
      { id: 'g2', valorCentavos: 0, motivo: 'vazia', registradoEm: '2026-11-23T15:00:00.000Z' },
      { id: 'g3', valorCentavos: 100, motivo: 'sem data' },
    ],
    diferencaCentavos: -250,
    fechamentoPelaGaveta: true,
    fechadoEm,
  };
  const movimentos = movimentosDaSessao('s1', sessao);
  assert.deepEqual(movimentos.map((m) => [m.id, m.tipo, m.direcao, m.valorCentavos, m.data]), [
    ['sangria:s1:g1', 'sangria_pdv', 'debito', 5000, '2026-11-23'],
    ['fechamento:s1', 'diferenca_fechamento', 'debito', 250, '2026-11-23'],
  ]);
  assert.equal(movimentos[0].descricao, 'Sangria do PDV: Troco para o motoboy (Caixa 1 — CAIXA)');
  assert.equal(movimentos[1].descricao, 'Falta no fechamento do caixa (Caixa 1 — CAIXA)');

  const sobra = movimentosDaSessao('s2', { ...sessao, sangrias: [], diferencaCentavos: 300 });
  assert.deepEqual([sobra[0].direcao, sobra[0].valorCentavos, sobra[0].descricao], ['credito', 300, 'Sobra no fechamento do caixa (Caixa 1 — CAIXA)']);

  // Fechamento por sessao (mais de um caixa aberto, ou chave desligada na hora): a diferenca fica so na sessao.
  assert.deepEqual(movimentosDaSessao('s3', { ...sessao, sangrias: [], fechamentoPelaGaveta: false }), []);
  // Caixa ainda aberto: a sangria ja saiu da gaveta.
  assert.equal(movimentosDaSessao('s4', { status: 'aberto', sangrias: sessao.sangrias }).length, 1);
  // Sangria de madrugada (UTC) cai no dia certo do Brasil.
  assert.equal(movimentosDaSessao('s5', { status: 'aberto', sangrias: [{ id: 'n', valorCentavos: 100, registradoEm: '2026-11-24T01:30:00.000Z' }] })[0].data, '2026-11-23');
});

test('periodo e saldo dos movimentos', () => {
  assert.equal(movimentoNoPeriodo({ data: '2026-11-23' }, '2026-11-23'), true);
  assert.equal(movimentoNoPeriodo({ data: '2026-11-22' }, '2026-11-23'), false);
  assert.equal(movimentoNoPeriodo({ data: '2026-11-24' }, '2026-11-01', '2026-11-23'), false);
  assert.equal(saldoDosMovimentos([
    { direcao: 'credito', valorCentavos: 50000 },
    { direcao: 'debito', valorCentavos: 5000 },
    { direcao: 'credito', valorCentavos: 300 },
  ]), 45300);
});

test('fechamento: pela gaveta com um caixa aberto; por sessao com mais de um ou chave desligada', () => {
  const sessao = { saldoInicialCentavos: 10000, dinheiroDaSessaoCentavos: 30000, totalSangriasCentavos: 5000 };

  const gaveta = esperadoNoFechamento({ ...sessao, gavetaAtiva: true, saldoDaGavetaCentavos: 62000, caixasAbertos: 1 });
  assert.equal(gaveta.modo, 'gaveta');
  assert.equal(gaveta.saldoEsperadoCentavos, 62000, 'inclui o dinheiro dos pedidos de venda fora do PDV');

  const doisAbertos = esperadoNoFechamento({ ...sessao, gavetaAtiva: true, saldoDaGavetaCentavos: 62000, caixasAbertos: 2 });
  assert.equal(doisAbertos.modo, 'sessao');
  assert.equal(doisAbertos.saldoEsperadoCentavos, 35000);
  assert.match(doisAbertos.explicacao, /mais de um caixa aberto/);

  const desligada = esperadoNoFechamento({ ...sessao, gavetaAtiva: false, saldoDaGavetaCentavos: null, caixasAbertos: 1 });
  assert.deepEqual([desligada.modo, desligada.saldoEsperadoCentavos], ['sessao', 35000]);

  // Chave ligada mas sem o CAIXA padrao (inativado): segue por sessao.
  assert.equal(esperadoNoFechamento({ ...sessao, gavetaAtiva: true, saldoDaGavetaCentavos: null, caixasAbertos: 1 }).modo, 'sessao');

  assert.match(resultadoDaContagem(0), /Conferido/);
  assert.match(resultadoDaContagem(250), /Sobrou R\$ 2,50/);
  assert.match(resultadoDaContagem(-1000), /Faltou R\$ 10,00/);
});

/*
 * O que compoe o "Esperado agora", acerto de um dia, troco/COFRE, fechar com a
 * data de ontem e abertura conferida (pedido do dono, 24/11/2026, Embala Minas).
 */
test('composicao por dia: saldo anterior + dias = saldo; caso Embala 1.060,68 + 184,95', () => {
  const mov = (id: string, data: string, valorCentavos: number, direcao: 'credito' | 'debito' = 'credito') => ({ id, tipo: 'dinheiro_entrada', direcao, valorCentavos, descricao: id, data, criadoEmIso: `${data}T12:00:00.000Z` });
  const c = comporPorDia(124563, [mov('pedidos de 23/11', '2026-11-23', 106068), mov('PDV #113733', '2026-11-24', 18495)], '2026-11-23');
  assert.equal(c.saldoAnteriorCentavos, 0);
  assert.deepEqual(c.dias.map((d) => [d.data, d.liquidoCentavos, d.saldoNoFimCentavos]), [['2026-11-23', 106068, 106068], ['2026-11-24', 18495, 124563]]);

  // Comecando em 24/11, o dia 23 vira o "saldo anterior".
  const c2 = comporPorDia(124563, [mov('a', '2026-11-23', 106068), mov('b', '2026-11-24', 20000), mov('c', '2026-11-24', 1505, 'debito')], '2026-11-24');
  assert.equal(c2.saldoAnteriorCentavos, 106068);
  assert.deepEqual([c2.dias[0].entradasCentavos, c2.dias[0].saidasCentavos, c2.dias[0].saldoNoFimCentavos], [20000, 1505, 124563]);
  assert.equal(saldoNoFimDoDia(124563, [mov('a', '2026-11-23', 106068), mov('b', '2026-11-24', 18495)], '2026-11-23'), 106068);
});

test('inicio da composicao: ultima conferencia, senao a chave, nunca mais de 31 dias', () => {
  assert.equal(inicioDaComposicao({ desde: '2026-11-23', hoje: '2026-11-24', ultimaConferencia: '' }), '2026-11-23');
  assert.equal(inicioDaComposicao({ desde: '2026-11-23', hoje: '2026-11-30', ultimaConferencia: '2026-11-29' }), '2026-11-29');
  assert.equal(inicioDaComposicao({ desde: '2026-01-10', hoje: '2026-11-24', ultimaConferencia: '' }), '2026-10-24');
});

test('troco, acerto e envio ao COFRE: leitura e conta', () => {
  assert.equal(erroDoTroco(10000, 0), '');
  assert.equal(erroDoTroco(10000, 10000), '');
  assert.match(erroDoTroco(10000, 10001), /não pode ser maior/);
  assert.deepEqual(lerPedidoDeCofreNoFechamento({ sessaoId: 's1', trocoCentavos: 7710 }), { pedido: { sessaoId: 's1', trocoCentavos: 7710 } });
  assert.ok('erro' in lerPedidoDeCofreNoFechamento({ sessaoId: 'a/b', trocoCentavos: 0 }));
  assert.ok('erro' in lerPedidoDeCofreNoFechamento({ sessaoId: 's1', trocoCentavos: -1 }));

  assert.deepEqual(lerPedidoDeAcerto({ data: '2026-11-23', contadoCentavos: 106068, trocoCentavos: 7710 }, '2026-11-24', '2026-11-23'), { pedido: { data: '2026-11-23', contadoCentavos: 106068, trocoCentavos: 7710 } });
  assert.match((lerPedidoDeAcerto({ data: '2026-11-24', contadoCentavos: 0, trocoCentavos: 0 }, '2026-11-24', '2026-11-23') as { erro: string }).erro, /já passou/);
  assert.match((lerPedidoDeAcerto({ data: '2026-11-20', contadoCentavos: 0, trocoCentavos: 0 }, '2026-11-24', '2026-11-23') as { erro: string }).erro, /23\/11\/2026/);
  assert.ok('erro' in lerPedidoDeAcerto({ data: '2026-11-23', contadoCentavos: 100, trocoCentavos: 200 }, '2026-11-24', '2026-11-23'));
  assert.deepEqual(planejarAcerto(106068, 100000, 7710), { diferencaCentavos: -6068, paraCofreCentavos: 92290 });
});

test('fechar com a data de um dia anterior: dias possiveis e titulos ate o dia', () => {
  assert.deepEqual(diasParaFechar('2026-11-24', '2026-11-24'), ['2026-11-24']);
  assert.deepEqual(diasParaFechar('2026-11-23', '2026-11-24'), ['2026-11-23', '2026-11-24']);
  assert.equal(diasParaFechar('2026-10-01', '2026-11-24').length, DIAS_PARA_FECHAR_ATRASADO + 1);
  assert.equal(diasParaFechar('2026-10-01', '2026-11-24')[0], '2026-11-17');
  assert.equal(tituloAteODia({ dataPagamento: '2026-11-23' }, '2026-11-23'), true);
  assert.equal(tituloAteODia({ dataPagamento: '2026-11-24' }, '2026-11-23'), false);
  assert.equal(tituloAteODia({ data: '2026-11-24T10:00' }, '2026-11-23'), false);
  assert.equal(tituloAteODia({ dataPagamento: '2026-11-24' }, ''), true, 'sem data de corte, tudo entra');
});

test('abertura conferida contra a gaveta: so com um caixa e a chave ligada; aviso e movimento', () => {
  assert.equal(aberturaConfereComAGaveta({ ativo: true, saldoCentavos: 106068, caixasAbertos: 0 }), true);
  assert.equal(aberturaConfereComAGaveta({ ativo: true, saldoCentavos: 106068, caixasAbertos: 1 }), false);
  assert.equal(aberturaConfereComAGaveta({ ativo: false, saldoCentavos: null, caixasAbertos: 0 }), false);
  assert.equal(aberturaConfereComAGaveta(null), false);
  assert.equal(avisoDaAbertura(7710, 7710), '');
  assert.match(avisoDaAbertura(106068, 7710), /faltam R\$\s983,58/);

  const abertoEm = new Date('2026-11-24T13:00:47.000Z');
  const [m] = movimentosDaSessao('s1', { status: 'aberto', terminalNome: 'Caixa 1', operadorNome: 'CAIXA', aberturaPelaGaveta: true, diferencaAberturaCentavos: -98358, abertoEm });
  assert.deepEqual([m.tipo, m.direcao, m.valorCentavos, m.data], ['diferenca_abertura', 'debito', 98358, '2026-11-24']);
  assert.match(m.descricao, /Falta na abertura do caixa \(Caixa 1 — CAIXA\)/);
  assert.deepEqual(movimentosDaSessao('s1', { status: 'aberto', aberturaPelaGaveta: false, diferencaAberturaCentavos: -98358, abertoEm }), []);
});

test('caixa conferido por sessao: saldo inicial + vendas em dinheiro - sangrias, no mesmo formato', () => {
  const c = composicaoDaSessao({
    abertoEm: new Date('2026-11-24T13:00:47.000Z'),
    saldoInicialCentavos: 7710,
    lancamentosEmDinheiro: [{ id: 't1', descricao: 'PDV #113733 - Dinheiro', clienteNome: 'CONSUMIDOR', valorCentavos: 18495, criadoEm: new Date('2026-11-24T17:15:00.000Z') }],
    sangrias: [{ id: 'g1', valorCentavos: 5000, motivo: 'Troco', registradoEm: '2026-11-24T18:00:00.000Z' }],
  });
  assert.equal(c.saldoCentavos, 7710 + 18495 - 5000);
  assert.equal(c.saldoAnteriorCentavos, 0);
  assert.deepEqual(c.dias[0].movimentos.map((m) => [m.tipo, m.direcao, m.valorCentavos]), [['saldo_inicial', 'credito', 7710], ['dinheiro_entrada', 'credito', 18495], ['sangria_pdv', 'debito', 5000]]);
  assert.equal(c.dias[0].movimentos[1].clienteNome, 'CONSUMIDOR');
  assert.equal(composicaoDaSessao({ abertoEm: new Date(), saldoInicialCentavos: 0, lancamentosEmDinheiro: [], sangrias: [] }).dias.length, 0);
});

// Suprimento na Frente de Caixa (27/11/2026): o contrario da sangria.
import {
  composicaoDaSessao as composicaoComSuprimento,
  esperadoNoFechamento as esperadoComSuprimento,
  movimentosDaSessao as movimentosComSuprimento,
} from '../src/utils/gavetaDinheiroDomain';

test('suprimento: soma no esperado por sessao e explica na conta', () => {
  const e = esperadoComSuprimento({ gavetaAtiva: false, saldoDaGavetaCentavos: null, caixasAbertos: 1, saldoInicialCentavos: 10000, dinheiroDaSessaoCentavos: 5000, totalSangriasCentavos: 2000, totalSuprimentosCentavos: 3000 });
  assert.equal(e.saldoEsperadoCentavos, 16000);
  assert.match(e.explicacao, /\+ suprimentos − sangrias/);
  const sem = esperadoComSuprimento({ gavetaAtiva: false, saldoDaGavetaCentavos: null, caixasAbertos: 1, saldoInicialCentavos: 10000, dinheiroDaSessaoCentavos: 5000, totalSangriasCentavos: 2000 });
  assert.equal(sem.saldoEsperadoCentavos, 13000, 'sem suprimento, como sempre');
  assert.doesNotMatch(sem.explicacao, /suprimento/);
});

test('suprimento: entra no extrato da gaveta como credito e na composicao do esperado', () => {
  const quando = '2026-11-27T13:00:00.000Z';
  const movimentos = movimentosComSuprimento('cx1', {
    status: 'aberto', operadorNome: 'MARIA',
    sangrias: [{ id: 's1', valorCentavos: 2000, motivo: 'COFRE', registradoEm: quando }],
    suprimentos: [{ id: 'p1', valorCentavos: 5000, motivo: 'Reforço de troco', registradoEm: quando }, { id: 'p2', valorCentavos: 0, registradoEm: quando }],
  });
  const suprimento = movimentos.find((m) => m.tipo === 'suprimento_pdv');
  assert.ok(suprimento);
  assert.equal(suprimento!.direcao, 'credito');
  assert.equal(suprimento!.valorCentavos, 5000);
  assert.match(suprimento!.descricao, /Suprimento do PDV: Reforço de troco \(MARIA\)/);
  assert.equal(movimentos.filter((m) => m.tipo === 'suprimento_pdv').length, 1, 'valor zero nao entra');
  const composicao = composicaoComSuprimento({
    abertoEm: new Date('2026-11-27T11:00:00.000Z'), saldoInicialCentavos: 10000, lancamentosEmDinheiro: [],
    sangrias: [{ id: 's1', valorCentavos: 2000, registradoEm: quando }],
    suprimentos: [{ id: 'p1', valorCentavos: 5000, registradoEm: quando }],
  });
  assert.equal(composicao.saldoCentavos, 13000);
});
