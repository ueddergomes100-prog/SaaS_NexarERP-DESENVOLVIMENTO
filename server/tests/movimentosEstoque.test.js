const test = require('node:test');
const assert = require('node:assert/strict');
const { criarBancoFalso, carregarComBancoFalso } = require('./helpers/firestoreFalso');

/*
 * Movimentacao de produtos (26/10/2026): o servidor junta as origens, corta pelo
 * periodo, completa os itens (codigo, tipo, saldo) e monta o extrato de um item.
 */

const carregar = (db) => carregarComBancoFalso(db, 'services/movimentosEstoque')[3];

const dia = (ymd, hora = 15) => { const [a, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d, hora)); };

const base = () => ({
  'estoque/pa': { tenantId: 'loja', nome: 'PAO DE QUEIJO', codigo: 10, categoria: 'CONGELADOS', quantidade: 30, unidadeMedidaSigla: 'UN' },
  'estoque/rev': { tenantId: 'loja', nome: 'REFRIGERANTE', codigo: 20, categoria: 'BEBIDAS', quantidade: 5 },
  'materias_primas/mp': { tenantId: 'loja', nome: 'POLVILHO', codigo: 1, categoria: 'FARINACEOS', quantidade: 96, unidade: 'KG' },
  'produtos_composicao/pa': { tenantId: 'loja', produtoId: 'pa', itens: [{ componenteId: 'mp' }] },
  'pedidos_venda/v1': { tenantId: 'loja', numeroPedido: '0001', status: 'Finalizada', dataVenda: '2026-10-10', clienteNome: 'MARIA', itens: [{ id: 'pa', nome: 'PAO DE QUEIJO', quantidade: 5 }, { id: 'rev', quantidade: 2 }] },
  'pedidos_venda/v0': { tenantId: 'loja', numeroPedido: '0000', status: 'Cancelada', dataVenda: '2026-09-20', canceladaEm: dia('2026-10-12'), itens: [{ id: 'rev', quantidade: 1 }] },
  'pedidos_venda/pv': { tenantId: 'loja', numeroPedido: '0002', status: 'Pré-venda', dataVenda: '2026-10-11', itens: [{ id: 'pa', quantidade: 9 }] },
  'pedidos_venda/outra': { tenantId: 'outra', numeroPedido: '0099', status: 'Finalizada', dataVenda: '2026-10-10', itens: [{ id: 'pa', quantidade: 50 }] },
  'ordens_producao/op': { tenantId: 'loja', numero: '0001', status: 'finalizada', produtoId: 'pa', produtoNome: 'PAO DE QUEIJO', quantidadeProduzida: 20, dataFim: dia('2026-10-05'), itensConsumidos: [{ componenteId: 'mp', componenteNome: 'POLVILHO', quantidadeConsumida: 4 }] },
  'ajustes_estoque/a1': { tenantId: 'loja', produtoId: 'pa', produtoNome: 'PAO DE QUEIJO', tipo: 'saida', quantidade: 1, motivo: 'perda', createdAt: dia('2026-10-20') },
  'ajustes_estoque/a2': { tenantId: 'loja', produtoId: 'mp', produtoNome: 'POLVILHO', origem: 'materia_prima', tipo: 'entrada', quantidade: 100, motivo: 'balanco', createdAt: dia('2026-09-01') },
});

test('lista do periodo: junta as origens, corta pela data e pela empresa, completa os itens', async () => {
  const s = carregar(criarBancoFalso(base(), { consultas: true }).db);
  const r = await s.consultar({ tenantId: 'loja', de: '2026-10-01', ate: '2026-10-31' });
  const resumo = r.movimentos.map((m) => `${m.origem}:${m.itemId}:${m.tipo}:${m.quantidade}`);
  assert.deepEqual(resumo, [
    'ajuste:pa:saida:1',
    'venda_cancelada:rev:entrada:1',
    'venda:pa:saida:5',
    'venda:rev:saida:2',
    'producao_consumo:mp:saida:4',
    'producao_entrada:pa:entrada:20',
  ], 'pre-venda, outra empresa e o balanco de setembro ficam fora; mais novos primeiro');
  assert.equal(r.itens['estoque:pa'].tipo, 'acabado');
  assert.equal(r.itens['estoque:rev'].tipo, 'revenda');
  assert.equal(r.itens['materias_primas:mp'].tipo, 'materia_prima');
  assert.equal(r.itens['materias_primas:mp'].unidade, 'KG');
  assert.equal(r.itens['estoque:pa'].codigo, '10');
});

test('extrato do item: saldo antes/depois a partir do saldo atual, ate hoje', async () => {
  const s = carregar(criarBancoFalso(base(), { consultas: true }).db);
  const r = await s.consultar({ tenantId: 'loja', de: '2026-10-01', ate: '2026-10-31', itemId: 'pa', colecao: 'estoque' });
  // saldo atual 30 = inicial + 20 (producao) - 5 (venda) - 1 (perda) => inicial 16
  assert.equal(r.extrato.saldoInicial, 16);
  assert.equal(r.extrato.saldoFinal, 30);
  assert.deepEqual(r.extrato.linhas.map((l) => [l.origem, l.saldoAntes, l.saldoDepois]), [
    ['ajuste', 31, 30], ['venda', 36, 31], ['producao_entrada', 16, 36],
  ]);
  assert.deepEqual([r.extrato.totalEntradas, r.extrato.totalSaidas], [20, 6]);
});
