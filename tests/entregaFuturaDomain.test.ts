import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cfopDaRemessa,
  cfopDoFaturamento,
  entregaAtrasada,
  entregueDepois,
  erroParaCancelarComEntregaFutura,
  erroParaEntregar,
  infoComplementarDaRemessa,
  lerPedidoDeEntrega,
  parseEntregaFuturaExigeEstoque,
  parsePrevisaoEntrega,
  parseTrabalhaComEntregaFutura,
  saldoAEntregar,
  situacaoDaEntrega,
  tituloDaEntrega,
} from '../src/utils/entregaFuturaDomain';

/*
 * Venda com entrega futura (23/10/2026): CFOPs, saldo a entregar, leitura de
 * uma entrega, situacao do pedido e bloqueios.
 */

const ITENS = [
  { id: 'p1', nome: 'RAÇÃO 15KG', quantidade: 10 },
  { id: 'p2', nome: 'COLEIRA', quantidade: 2, fatorConversao: 1 },
];
const erroDe = (r: { erro: string } | object): string => ('erro' in r ? r.erro : '');

test('config e CFOPs', () => {
  assert.equal(parseTrabalhaComEntregaFutura(true), true);
  assert.equal(parseTrabalhaComEntregaFutura('true'), false);
  assert.equal(parseEntregaFuturaExigeEstoque(undefined), false);
  assert.equal(cfopDoFaturamento(false), '5922');
  assert.equal(cfopDoFaturamento(true), '6922');
  assert.equal(cfopDaRemessa(true, false), '5116', 'producao propria');
  assert.equal(cfopDaRemessa(false, false), '5117', 'revenda');
  assert.equal(cfopDaRemessa(true, true), '6116');
  assert.equal(cfopDaRemessa(false, true), '6117');
});

test('previsao de entrega e atraso', () => {
  assert.equal(parsePrevisaoEntrega('2026-11-05'), '2026-11-05');
  assert.equal(parsePrevisaoEntrega('05/11/2026'), '');
  assert.equal(parsePrevisaoEntrega(undefined), '');
  assert.equal(entregaAtrasada('2026-11-05', '2026-11-06'), true);
  assert.equal(entregaAtrasada('2026-11-05', '2026-11-05'), false);
  assert.equal(entregaAtrasada('', '2026-11-05'), false);
});

test('saldo a entregar, situacao e entregue depois', () => {
  const nada = saldoAEntregar(ITENS, undefined);
  assert.deepEqual(nada.map((s) => [s.saldo, s.entregue]), [[10, 0], [2, 0]]);
  assert.equal(situacaoDaEntrega(nada), 'pendente');
  const parte = saldoAEntregar(ITENS, [4, 0]);
  assert.equal(situacaoDaEntrega(parte), 'parcial');
  assert.equal(parte[0].saldo, 6);
  const tudo = saldoAEntregar(ITENS, [10, 2]);
  assert.equal(situacaoDaEntrega(tudo), 'entregue');
  assert.equal(saldoAEntregar(ITENS, [99, 0])[0].saldo, 0, 'entregue a mais nunca vira saldo negativo');
  const leitura = lerPedidoDeEntrega({ itens: [{ indice: 0, quantidade: 2.5 }, { indice: 1, quantidade: 0 }] }, parte);
  assert.ok('entrega' in leitura);
  assert.deepEqual(entregueDepois([4, 0], 2, leitura.entrega), [6.5, 0]);
});

test('ler a entrega: mensagens em portugues', () => {
  const saldos = saldoAEntregar(ITENS, [4, 0]);
  assert.match(erroDe(lerPedidoDeEntrega({}, saldos)), /Informe o que/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [] }, saldos)), /pelo menos um item/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [{ indice: 0, quantidade: 0 }] }, saldos)), /pelo menos um item/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [{ indice: 0, quantidade: 7 }] }, saldos)), /RAÇÃO 15KG: falta entregar 6/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [{ indice: 5, quantidade: 1 }] }, saldos)), /inválido/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [{ indice: 0, quantidade: 1 }, { indice: 0, quantidade: 1 }] }, saldos)), /duas vezes/);
  assert.match(erroDe(lerPedidoDeEntrega({ itens: [{ indice: 0, quantidade: 1 }], romaneioId: 'a b' }, saldos)), /Rota inválida/);
  const ok = lerPedidoDeEntrega({ itens: [{ indice: 1, quantidade: '2' }], romaneioId: 'rota1', observacao: '  deixar   na portaria ' }, saldos);
  assert.ok('entrega' in ok);
  assert.deepEqual(ok.entrega, { itens: [{ indice: 1, quantidade: 2 }], romaneioId: 'rota1', observacao: 'deixar na portaria' });
});

test('bloqueios: entregar e cancelar', () => {
  const saldos = saldoAEntregar(ITENS, [0, 0]);
  assert.match(erroParaEntregar({ status: 'Finalizada', entregaFutura: false, numeroPedido: '0035' }, saldos) || '', /não é uma venda para entrega futura/);
  assert.match(erroParaEntregar({ status: 'Pré-venda', entregaFutura: true, numeroPedido: '0035' }, saldos) || '', /ainda não foi faturado/);
  assert.equal(erroParaEntregar({ status: 'Finalizada', entregaFutura: true }, saldos), null);
  assert.match(erroParaEntregar({ status: 'Finalizada', entregaFutura: true, numeroPedido: '0035' }, saldoAEntregar(ITENS, [10, 2])) || '', /já foi entregue por completo/);
  assert.equal(erroParaCancelarComEntregaFutura({ entregaFutura: true, itens: ITENS, entregaFuturaEntregue: [0, 0] }), null);
  assert.match(erroParaCancelarComEntregaFutura({ entregaFutura: true, numeroPedido: '0035', itens: ITENS, entregaFuturaEntregue: [1, 0] }) || '', /Devolução de Venda/);
  assert.equal(erroParaCancelarComEntregaFutura({ entregaFutura: false, itens: ITENS, entregaFuturaEntregue: [1, 0] }), null);
});

test('textos', () => {
  assert.equal(tituloDaEntrega('0035', 2), 'Pedido #0035 · entrega 2');
  const txt = infoComplementarDaRemessa({ numeroPedido: '0035', numeroEntrega: 1, notaNumero: 120, notaChave: '3526' + '0'.repeat(40), notaData: '23/10/2026' });
  assert.match(txt, /entrega futura \(Pedido #0035 · entrega 1\), faturada na NF-e nº 120 de 23\/10\/2026, chave 3526/);
  assert.match(txt, /sem cobrança/);
});
