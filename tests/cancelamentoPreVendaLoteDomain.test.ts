import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avisosDaSelecao,
  ehPreVendaCancelavelEmLote,
  listaDeNumeros,
  resumoDoCancelamentoEmLote,
  separarPreVendasParaCancelar,
} from '../src/utils/cancelamentoPreVendaLoteDomain';

const PEDIDOS = [
  { id: 'a', numeroPedido: '0041', clienteNome: 'INFINITY', status: 'Pré-venda' },
  { id: 'b', numeroPedido: '0040', clienteNome: 'UEDDER', status: 'Pré-venda', origem: 'balcao' },
  { id: 'c', numeroPedido: '0039', clienteNome: 'INFINITY', status: 'Finalizada' },
  { id: 'd', numeroPedido: '0038', clienteNome: 'UEDDER', status: 'Pré-venda' },
  { id: 'e', numeroPedido: '0037', clienteNome: 'AGENTE', status: 'Em Análise' },
  { id: 'f', numeroPedido: '0036', clienteNome: 'X', status: 'Cancelada' },
  { id: 'g', numeroPedido: '0035', clienteNome: 'Y', status: 'Pré-venda', origem: 'agente' },
];

test('so pre-venda do balcao em aberto entra no lote', () => {
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[0]), true);
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[1]), true);
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[2]), false); // venda
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[4]), false); // pedido do agente (Recusar)
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[5]), false); // ja' cancelado
  assert.equal(ehPreVendaCancelavelEmLote(PEDIDOS[6]), false); // origem agente
});

test('separa os marcados: cancelaveis em ordem de numero, outros contados, em edicao fora', () => {
  const marcados = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'nao-existe']);
  const s = separarPreVendasParaCancelar(PEDIDOS, marcados, (id) => id === 'b');
  assert.deepEqual(s.cancelaveis.map((p) => p.numero), ['0038', '0041']);
  assert.deepEqual(s.emEdicao.map((p) => p.numero), ['0040']);
  assert.equal(s.naoSaoPreVenda, 4);
  // Nao marcado nao entra.
  const so1 = separarPreVendasParaCancelar(PEDIDOS, new Set(['d']), () => false);
  assert.deepEqual(so1, { cancelaveis: [{ id: 'd', numero: '0038', cliente: 'UEDDER' }], naoSaoPreVenda: 0, emEdicao: [] });
});

test('lista de numeros com "e" e corte em "e mais N"', () => {
  const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), numero: String(i + 1).padStart(4, '0'), cliente: '' }));
  assert.equal(listaDeNumeros(itens(0)), '');
  assert.equal(listaDeNumeros(itens(1)), '#0001');
  assert.equal(listaDeNumeros(itens(3)), '#0001, #0002 e #0003');
  assert.equal(listaDeNumeros(itens(5), 3), '#0001, #0002, #0003 e mais 2');
});

test('avisos da confirmacao em portugues, singular e plural', () => {
  assert.deepEqual(avisosDaSelecao({ cancelaveis: [], naoSaoPreVenda: 0, emEdicao: [] }), []);
  assert.deepEqual(avisosDaSelecao({ cancelaveis: [], naoSaoPreVenda: 1, emEdicao: [{ id: 'b', numero: '0040', cliente: '' }] }), [
    '1 pedido marcado não é pré-venda em aberto e fica como está.',
    '#0040 está aberta para editar por outra pessoa e não será cancelada.',
  ]);
  assert.match(avisosDaSelecao({ cancelaveis: [], naoSaoPreVenda: 3, emEdicao: [] })[0], /^3 pedidos marcados não são pré-venda/);
});

test('resumo final: tudo certo, parcial e nenhuma', () => {
  const p = (numero: string) => ({ id: numero, numero, cliente: '' });
  const tudo = resumoDoCancelamentoEmLote({ canceladas: [p('0038'), p('0041')], falhas: [] });
  assert.equal(tudo.titulo, '2 pré-vendas canceladas');
  assert.equal(tudo.tudoCerto, true);
  assert.match(tudo.texto, /#0038 e #0041/);
  const parcial = resumoDoCancelamentoEmLote({ canceladas: [p('0038')], falhas: [{ ...p('0041'), motivo: 'Esta pré-venda não está mais em aberto. Recarregue a tela.' }] });
  assert.equal(parcial.titulo, '1 de 2 pré-vendas canceladas');
  assert.equal(parcial.tudoCerto, false);
  assert.match(parcial.texto, /Não canceladas:\n#0041: Esta pré-venda não está mais em aberto/);
  const nenhuma = resumoDoCancelamentoEmLote({ canceladas: [], falhas: [{ ...p('0041'), motivo: 'sem permissão' }] });
  assert.equal(nenhuma.titulo, 'Nenhuma pré-venda foi cancelada');
});
