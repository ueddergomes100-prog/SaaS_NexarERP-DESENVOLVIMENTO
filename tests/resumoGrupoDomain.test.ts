import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataDoPedido, resumoDaFilial, somarAReceber, somarVendas, totalDoGrupo, valorEmEstoque } from '../src/utils/resumoGrupoDomain';

test('vendas: so as que contam como faturamento, pelo total em centavos (ou valorTotal antigo)', () => {
  const r = somarVendas([
    { status: 'Finalizada', valorTotalCentavos: 10000 },
    { status: 'Finalizada', valorTotal: 25.5 },
    { status: 'Pré-venda', valorTotalCentavos: 99999 },
    { status: 'Cancelada', valorTotalCentavos: 50000 },
  ]);
  assert.deepEqual(r, { centavos: 12550, quantidade: 2 });
});

test('vendas no periodo: vale a data da venda; sem ela, a criacao no fuso de Brasilia', () => {
  // 02:30 UTC de 01/10 = 23:30 de 30/09 em Brasilia.
  assert.equal(dataDoPedido({ createdAt: new Date('2026-10-01T02:30:00Z') }), '2026-09-30');
  assert.equal(dataDoPedido({ dataVenda: '2026-09-15', createdAt: new Date('2026-10-01T12:00:00Z') }), '2026-09-15');
  assert.equal(dataDoPedido({ createdAt: { seconds: Date.parse('2026-10-05T15:00:00Z') / 1000 } }), '2026-10-05');
  const r = somarVendas([
    { status: 'Finalizada', valorTotalCentavos: 1000, dataVenda: '2026-10-01' },
    { status: 'Finalizada', valorTotalCentavos: 2000, dataVenda: '2026-09-30' },
    { status: 'Finalizada', valorTotalCentavos: 4000, createdAt: new Date('2026-10-31T12:00:00Z') },
  ], { inicio: '2026-10-01', fim: '2026-10-31' });
  assert.deepEqual(r, { centavos: 5000, quantidade: 2 });
});

test('a receber: entrada pendente sem cartao; estoque: quantidade positiva x custo, sem inativos', () => {
  const aReceber = somarAReceber([
    { tipo: 'entrada', status: 'Pendente', valorCentavos: 5000, formaPagamento: 'Boleto' },
    { tipo: 'entrada', status: 'Pendente', valorCentavos: 3000, formaPagamento: 'Cartão de Crédito' },
    { tipo: 'entrada', status: 'Pago', valorCentavos: 7000 },
    { tipo: 'saida', status: 'Pendente', valorCentavos: 9000 },
  ]);
  assert.equal(aReceber, 5000);
  assert.equal(valorEmEstoque([
    { quantidade: 10, precoCusto: 2.5 },
    { quantidade: -3, precoCusto: 100 },
    { quantidade: 5, precoCusto: 10, ativo: false },
  ]), 2500);
});

test('resumo por filial e total do grupo com ticket medio', () => {
  const a = resumoDaFilial({ tenantId: 'a', codigo: '10', nome: 'CENTRO' }, { pedidos: [{ status: 'Finalizada', valorTotalCentavos: 3000 }, { status: 'Finalizada', valorTotalCentavos: 1000 }], transacoes: [], produtos: [] });
  const b = resumoDaFilial({ tenantId: 'b', codigo: '20', nome: 'BAIXADA' }, { pedidos: [{ status: 'Finalizada', valorTotalCentavos: 2000 }], transacoes: [], produtos: [{ quantidade: 1, precoCusto: 1 }] });
  assert.equal(a.ticketMedioCentavos, 2000);
  const t = totalDoGrupo([a, b]);
  assert.deepEqual([t.vendasCentavos, t.pedidos, t.ticketMedioCentavos, t.estoqueCentavos], [6000, 3, 2000, 100]);
});
