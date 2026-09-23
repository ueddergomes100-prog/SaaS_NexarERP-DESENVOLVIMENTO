import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enriquecerVendas,
  filtrarVendasFaturadas,
  resumoPorVendedor,
  totaisVendas,
  vendaNoPeriodo,
  type DadosRelatorioVendas,
} from '../src/utils/relatorioVendasDomain';
import { dateInputToUtcEnd, dateInputToUtcStart } from '../src/utils/dateTime';

const dados = (parcial: Partial<DadosRelatorioVendas>): DadosRelatorioVendas => ({
  sales: [], transactions: [], users: {}, products: {}, returns: [], ...parcial,
});

test('faturamento: pré-venda, pedido em análise e cancelado ficam fora do relatório', () => {
  const vendas = [
    { id: '1', status: 'Finalizada' },
    { id: '2', status: 'Pré-venda' },
    { id: '3', status: 'Em Análise' },
    { id: '4', status: 'Cancelada' },
    { id: '5', status: 'concluida' },
  ];
  assert.deepEqual(filtrarVendasFaturadas(vendas).map((v) => v.id), ['1', '5']);
});

test('venda: data da venda manda sobre a data de criação (bug #0154)', () => {
  const [venda] = enriquecerVendas(dados({
    sales: [{ id: 'a', status: 'Finalizada', dataVenda: '2026-09-20', createdAt: new Date('2026-09-21T15:00:00Z'), valorTotal: 10 }],
  }));
  const inicio = dateInputToUtcStart('2026-09-20');
  const fim = dateInputToUtcEnd('2026-09-20');
  assert.equal(vendaNoPeriodo(venda, inicio, fim), true);
});

test('venda: bruto, desconto, devolução e recebido em centavos', () => {
  const [venda] = enriquecerVendas(dados({
    sales: [{
      id: 'a', status: 'Finalizada', vendedorId: 'u1', vendedorNome: 'Leo',
      valorTotalItensCentavos: 60000, valorTotalDescontosCentavos: 10000, valorTotalCentavos: 50000,
      pagamentos: [{ formaPagamento: 'Dinheiro', condicaoPagamento: 'avista', valorCentavos: 50000 }],
    }],
    returns: [{ status: 'concluida', pedidoVendaId: 'a', valorTotalDevolvidoCentavos: 5000 }],
    transactions: [{ pedidoId: 'a', tipo: 'entrada', status: 'Paga', valorCentavos: 45000 }],
  }));
  assert.equal(venda.grossCents, 60000);
  assert.equal(venda.discountCents, 10000);
  assert.equal(venda.returnedCents, 5000);
  assert.equal(venda.netCents, 45000);
  assert.equal(venda.receivedCents, 45000);
  assert.equal(venda.pendingCents, 0);
  assert.equal(venda.sellerName, 'Leo');
});

test('resumo por vendedor: agrupa, soma, calcula ticket médio e ordena pela receita', () => {
  const vendas = enriquecerVendas(dados({
    sales: [
      { id: 'a', status: 'Finalizada', vendedorId: 'u1', vendedorNome: 'Leo', valorTotalCentavos: 50000 },
      { id: 'b', status: 'Finalizada', vendedorId: 'u2', vendedorNome: 'Juliano', valorTotalCentavos: 2800 },
      { id: 'c', status: 'Finalizada', vendedorId: 'u2', vendedorNome: 'Juliano', valorTotalCentavos: 26400 },
    ],
  }));
  const resumo = resumoPorVendedor(vendas);
  assert.deepEqual(resumo.map((r) => [r.name, r.sales, r.netCents, r.averageCents]), [
    ['Leo', 1, 50000, 50000],
    ['Juliano', 2, 29200, 14600],
  ]);
  const totais = totaisVendas(vendas);
  assert.equal(totais.count, 3);
  assert.equal(totais.netCents, 79200);
  assert.equal(totais.averageCents, 26400);
});
