import test from 'node:test';
import assert from 'node:assert/strict';
import { resumirComprasDoCliente, vendaDoCliente } from '../src/utils/comprasDoClienteDomain';

const pedido = (id: string, extra: Record<string, unknown>) => ({
  id, numeroPedido: id.toUpperCase(), status: 'Finalizada', dataVenda: '2026-11-10', valorTotal: 100,
  pagamentos: [{ formaPagamento: 'Pix' }], itens: [], ...extra,
});

const pedidos = [
  pedido('p1', {
    dataVenda: '2026-09-01', valorTotal: 50, valorTotalCentavos: 5000,
    itens: [{ id: 'prod-a', nome: 'COPO 200ML', quantidade: 2, subtotal: 30, unidadeMedidaSigla: 'PCT' }, { id: 'prod-b', nome: 'PRATO', quantidade: 1, subtotal: 20, unidadeMedidaSigla: 'UN' }],
  }),
  pedido('p2', {
    dataVenda: '2026-11-20', valorTotal: 80,
    pagamentos: [{ formaPagamento: 'Boleto' }, { formaPagamento: 'Pix' }, { formaPagamento: 'Boleto' }],
    itens: [{ id: 'prod-a', nome: 'COPO 200ML', quantidade: 3, subtotal: 45, unidadeMedidaSigla: 'PCT' }, { id: 'prod-a', nome: 'COPO 200ML', quantidade: 5, subtotal: 35, unidadeMedidaSigla: 'UN' }],
  }),
  // Pre-venda em aberto e cancelada: na lista, fora das contas.
  pedido('p3', { status: 'Pré-venda', dataVenda: '2026-11-25', valorTotal: 999 }),
  pedido('p4', { status: 'Cancelada', dataVenda: '2026-11-15', valorTotal: 777 }),
  // Bonificacao: brinde, nao e' compra.
  pedido('p5', { tipoPedido: 'bonificacao', dataVenda: '2026-11-20', valorTotal: 0, itens: [{ id: 'prod-c', nome: 'BRINDE', quantidade: 1, subtotal: 0, bonificado: true }] }),
];

test('compras do cliente: so venda faturada conta; lista mais recente primeiro', () => {
  const r = resumirComprasDoCliente(pedidos);
  assert.deepEqual(r.vendas.map((v) => v.id), ['p3', 'p5', 'p2', 'p4', 'p1']);
  assert.equal(r.compras, 2);
  assert.equal(r.totalCentavos, 13000);
  assert.equal(r.ticketMedioCentavos, 6500);
  assert.equal(r.ultimaCompra, '2026-11-20');
  assert.equal(r.primeiraCompra, '2026-09-01');
  assert.equal(r.vendas.find((v) => v.id === 'p2')?.formas, 'Boleto + Pix');
  assert.equal(r.vendas.find((v) => v.id === 'p4')?.cancelada, true);
  assert.equal(r.vendas.find((v) => v.id === 'p3')?.conta, false);
});

test('compras do cliente: produtos mais comprados por vezes, sem somar unidades diferentes', () => {
  const r = resumirComprasDoCliente(pedidos);
  const copoPct = r.produtos.find((p) => p.nome === 'COPO 200ML' && p.unidade === 'PCT');
  assert.deepEqual(copoPct && { q: copoPct.quantidade, v: copoPct.valorCentavos, vezes: copoPct.vezes }, { q: 5, v: 7500, vezes: 2 });
  assert.equal(r.produtos[0].nome, 'COPO 200ML');
  assert.ok(r.produtos.some((p) => p.nome === 'COPO 200ML' && p.unidade === 'UN' && p.quantidade === 5));
  assert.ok(!r.produtos.some((p) => p.nome === 'BRINDE'));
});

test('compras do cliente: periodo corta pela data da venda; cliente sem compras', () => {
  const r = resumirComprasDoCliente(pedidos, { desde: '2026-10-01' });
  assert.equal(r.compras, 1);
  assert.equal(r.totalCentavos, 8000);
  assert.ok(!r.vendas.some((v) => v.id === 'p1'));
  const vazio = resumirComprasDoCliente([]);
  assert.equal(vazio.compras, 0);
  assert.equal(vazio.ultimaCompra, '');
  assert.equal(vazio.ticketMedioCentavos, 0);
});

test('compras do cliente: venda sem dataVenda usa a data de criacao', () => {
  const v = vendaDoCliente('x', { status: 'Finalizada', createdAt: { toDate: () => new Date('2026-11-27T02:00:00Z') }, valorTotal: 10 });
  assert.equal(v.data, '2026-11-26', 'no horario do Brasil');
  assert.equal(v.totalCentavos, 1000);
});
