import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularDesempenho,
  diaDoCampo,
  inicioDaBuscaDoDesempenho,
  metaDoVendedor,
  segundaDaSemana,
  type VendaParaDesempenho,
} from '../src/utils/desempenhoVendedorDomain';

const venda = (id: string, dia: string, valor: number, extra: Partial<VendaParaDesempenho> = {}): VendaParaDesempenho => ({
  id, status: 'Finalizada', valorTotal: valor, dataVenda: dia, clienteId: 'c1', clienteNome: 'MERCEARIA', ...extra,
});

test('segunda da semana e inicio da busca (mes anterior)', () => {
  assert.equal(segundaDaSemana('2026-10-30'), '2026-10-26'); // sexta -> segunda
  assert.equal(segundaDaSemana('2026-10-26'), '2026-10-26');
  assert.equal(segundaDaSemana('2026-11-01'), '2026-10-26'); // domingo
  assert.equal(inicioDaBuscaDoDesempenho('2026-10-30'), '2026-09-01');
  assert.equal(inicioDaBuscaDoDesempenho('2026-01-15'), '2025-12-01');
});

test('diaDoCampo: AAAA-MM-DD, {seconds} e Timestamp no fuso da empresa', () => {
  assert.equal(diaDoCampo('2026-10-30'), '2026-10-30');
  // 30/10 01:30 UTC = 29/10 22:30 em Sao Paulo
  assert.equal(diaDoCampo({ seconds: Date.UTC(2026, 9, 30, 1, 30) / 1000 }), '2026-10-29');
  assert.equal(diaDoCampo({ toDate: () => new Date(Date.UTC(2026, 9, 30, 15)) }), '2026-10-30');
  assert.equal(diaDoCampo(null), null);
});

test('desempenho: hoje/semana/mes, cancelada fora, pre-venda em "aguardando", comparacao justa com o mes passado', () => {
  const vendas = [
    venda('1', '2026-10-30', 100),
    venda('2', '2026-10-27', 50),
    venda('3', '2026-10-05', 200, { clienteId: 'c2', clienteNome: 'PADARIA' }),
    venda('4', '2026-10-30', 999, { status: 'Cancelada' }),
    venda('5', '2026-10-30', 70, { status: 'Pré-venda' }),
    venda('6', '2026-09-10', 100),
    venda('7', '2026-09-29', 300), // depois do dia 30? nao: 29 <= 30, entra no mesmo periodo
    venda('8', '2026-09-30', 40),
  ];
  const d = calcularDesempenho(vendas, '2026-10-30', 1000);
  assert.deepEqual(d.hoje, { totalCentavos: 10000, quantidade: 1 });
  assert.deepEqual(d.semana, { totalCentavos: 15000, quantidade: 2 });
  assert.equal(d.mes.totalCentavos, 35000);
  assert.equal(d.mes.quantidade, 3);
  assert.equal(d.mes.ticketMedioCentavos, 11667);
  assert.deepEqual(d.aguardandoFaturamento, { totalCentavos: 7000, quantidade: 1 });
  assert.deepEqual(d.mesPassadoMesmoPeriodo, { totalCentavos: 44000, quantidade: 3 });
  assert.equal(d.variacaoPercentual, -20.5);
  assert.equal(d.porDia.length, 30);
  assert.equal(d.porDia[29].totalCentavos, 10000);
  assert.equal(d.topClientes[0].nome, 'PADARIA');
  assert.deepEqual(d.meta, { valorCentavos: 100000, percentual: 35, faltaCentavos: 65000 });
});

test('desempenho: semana que comeca no mes passado conta os dias de la; mes passado inteiro x mesmo periodo', () => {
  const vendas = [venda('1', '2026-09-28', 10), venda('2', '2026-10-01', 20), venda('3', '2026-09-30', 5)];
  const d = calcularDesempenho(vendas, '2026-10-01');
  assert.deepEqual(d.semana, { totalCentavos: 3500, quantidade: 3 });
  assert.deepEqual(d.mes, { totalCentavos: 2000, quantidade: 1, ticketMedioCentavos: 2000 });
  assert.deepEqual(d.mesPassadoMesmoPeriodo, { totalCentavos: 0, quantidade: 0 });
  assert.deepEqual(d.mesPassadoInteiro, { totalCentavos: 1500, quantidade: 2 });
  assert.equal(d.variacaoPercentual, null);
  assert.equal(d.meta, null);
});

test('desempenho: top produtos pelo valor e comissao so da gerada', () => {
  const vendas = [
    venda('1', '2026-10-10', 30, {
      itens: [{ id: 'p1', nome: 'ARROZ', quantidade: 2, subtotal: 20 }, { id: 'p2', nome: 'FEIJAO', quantidade: 1, subtotal: 10 }],
      comissao: { status: 'gerada', valorAtualCentavos: 150 },
    }),
    venda('2', '2026-10-11', 15, {
      itens: [{ id: 'p2', nome: 'FEIJAO', quantidade: 3, subtotal: 15 }],
      comissao: { status: 'nao_aplicavel', valorAtualCentavos: 0 },
    }),
  ];
  const d = calcularDesempenho(vendas, '2026-10-30');
  assert.deepEqual(d.topProdutos.map((p) => [p.nome, p.totalCentavos, p.quantidade]), [['FEIJAO', 2500, 4], ['ARROZ', 2000, 2]]);
  assert.equal(d.comissaoMesCentavos, 150);
});

test('meta do vendedor nas configuracoes', () => {
  assert.equal(metaDoVendedor({ u1: 5000 }, 'u1'), 5000);
  assert.equal(metaDoVendedor({ u1: 0 }, 'u1'), null);
  assert.equal(metaDoVendedor(undefined, 'u1'), null);
});
