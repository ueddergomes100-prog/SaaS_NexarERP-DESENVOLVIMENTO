import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inferirMapeamentoHistorico,
  lerPedidosHistorico,
  montarPedidoHistorico,
  sementeIdHistorico,
  ultimosPedidosAnteriores,
} from '../src/utils/historicoSistemaAnteriorDomain';

const CAB = ['CPF/CNPJ', 'Cliente', 'Pedido', 'Data', 'Total do pedido', 'Codigo do produto', 'Produto', 'Quantidade', 'Unidade', 'Valor unitario', 'Valor total'];

test('historico: o cabecalho da migracao e reconhecido coluna a coluna', () => {
  assert.deepEqual(inferirMapeamentoHistorico(CAB), {
    documento: 0, cliente: 1, pedido: 2, data: 3, totalPedido: 4, codigoProduto: 5, produto: 6, quantidade: 7, unidade: 8, valorUnitario: 9, valorTotal: 10,
  });
});

test('historico: linhas do mesmo cliente + pedido viram um pedido com os itens', () => {
  const mapa = inferirMapeamentoHistorico(CAB);
  const pedidos = lerPedidosHistorico([
    ['787.159.896-15', 'JOSEANE', '113695A', '21/11/2026', '407.29', '3492', 'papel toalha', '5', 'PCT', '22.1', '110.5'],
    ['787.159.896-15', 'JOSEANE', '113695A', '21/11/2026', '407.29', '4205', 'TOALHA BELI', '12', 'PCT', '4.45', '53.4'],
    ['', 'PADARIA X', '100A', '2026-10-01', '', '1', 'COPO', '2', 'UN', '1,5', ''],
    ['', '', '', '', '', '', '', '', '', '', ''],
  ], mapa);
  assert.equal(pedidos.length, 2);
  const [a, b] = pedidos;
  assert.equal(a.documentoCliente, '78715989615');
  assert.equal(a.data, '2026-11-21');
  assert.equal(a.total, 407.29);
  assert.equal(a.itens.length, 2);
  assert.equal(a.itens[0].descricao, 'PAPEL TOALHA');
  assert.equal(a.problema, '');
  // Sem total na planilha: soma dos itens; sem valor total do item: qtd x unitario.
  assert.equal(b.nomeCliente, 'PADARIA X');
  assert.equal(b.itens[0].valorTotal, 3);
  assert.equal(b.total, 3);
});

test('historico: data ilegivel ou pedido sem cliente ficam com o motivo em portugues', () => {
  const mapa = inferirMapeamentoHistorico(CAB);
  const [semData, semCliente] = lerPedidosHistorico([
    ['1', 'A', '1', 'ontem', '', '', 'X', '1', 'UN', '1', '1'],
    ['', '', '2', '01/01/2026', '', '', 'Y', '1', 'UN', '1', '1'],
  ], mapa);
  assert.match(semData.problema, /data "ontem" não reconhecida/);
  assert.match(semCliente.problema, /sem cliente/);
});

test('historico: documento final sem undefined, id fixo por tenant + cliente + pedido', () => {
  const mapa = inferirMapeamentoHistorico(CAB);
  const [p] = lerPedidosHistorico([['', 'A', '7', '01/02/2026', '', '', 'X', '1', '', '2', '']], mapa);
  const docFinal = montarPedidoHistorico(p, { id: 'c1', nome: 'A' }, 'T1', { importadoPor: 'u' });
  assert.equal(JSON.stringify(docFinal).includes('undefined'), false);
  assert.equal(Object.values(docFinal).some((v) => v === undefined), false);
  assert.equal(docFinal.origemImportacao, 'migracao_historico');
  assert.equal(sementeIdHistorico('T1', 'c1', ' 7 '), 'historico-anterior|T1|c1|7');
  assert.notEqual(sementeIdHistorico('T1', 'c1', '7'), sementeIdHistorico('T2', 'c1', '7'));
});

test('historico: ultimos N, mais recente primeiro', () => {
  const lista = ['2026-01-01', '2026-03-01', '2025-12-31', '2026-02-01'].map((data, i) => ({ data, pedido: String(i) }));
  assert.deepEqual(ultimosPedidosAnteriores(lista, 2).map((p) => p.data), ['2026-03-01', '2026-02-01']);
});
