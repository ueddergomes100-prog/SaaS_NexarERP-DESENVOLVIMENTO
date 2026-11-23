import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ehACaixaGaveta,
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
