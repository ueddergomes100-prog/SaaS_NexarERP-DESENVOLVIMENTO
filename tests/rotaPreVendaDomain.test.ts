import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decidirRota,
  erroDePreVendaParaLiberar,
  ordenarRotas,
  parseModoRotaPreVenda,
  pedidosSemFaturar,
  perguntaRotaNaPreVenda,
  preVendaEntraNaRota,
  rotaSemPerguntar,
  textoDaRotaEscolhida,
  textoDoResultadoDaRota,
} from '../src/utils/rotaPreVendaDomain';
import { erroDoPedidoParaRomaneio } from '../src/utils/romaneioDomain';

/*
 * Rota na pre-venda (21/10/2026): configuracao em tres modos, decisao da
 * rota (pergunta / sozinha / sem rota) e a trava do "Liberar".
 */

const R1 = { id: 'r1', titulo: 'Rota 01 DANIELA', quantidadePedidos: 3 };
const R2 = { id: 'r2', titulo: 'Rota 02 MARCOS', quantidadePedidos: 0 };

test('configuracao: tres modos; qualquer outra coisa cai no padrao "nao"', () => {
  assert.equal(parseModoRotaPreVenda('na_pre_venda'), 'na_pre_venda');
  assert.equal(parseModoRotaPreVenda('ao_faturar'), 'ao_faturar');
  assert.equal(parseModoRotaPreVenda(undefined), 'nao');
  assert.equal(parseModoRotaPreVenda(true), 'nao');
  assert.equal(perguntaRotaNaPreVenda('nao'), false);
  assert.equal(perguntaRotaNaPreVenda('ao_faturar'), true);
  assert.equal(preVendaEntraNaRota('na_pre_venda'), true);
  assert.equal(preVendaEntraNaRota('ao_faturar'), false);
});

test('decidir: duas abertas pergunta; uma entra sozinha; nenhuma fica sem rota; escolhida antes vale se ainda aberta', () => {
  assert.deepEqual(decidirRota([R1, R2]), { acao: 'perguntar', rotas: [R1, R2] });
  assert.deepEqual(decidirRota([R2]), { acao: 'automatica', rota: R2 });
  assert.deepEqual(decidirRota([]), { acao: 'sem_rota' });
  assert.deepEqual(decidirRota([R1, R2], 'r2'), { acao: 'automatica', rota: R2 });
  // A Rota 1 foi liberada: a escolha antiga nao vale mais, e sobrou so' a 2.
  assert.deepEqual(decidirRota([R2], 'r1'), { acao: 'automatica', rota: R2 });
});

test('sem perguntar (envio do app, faturamento): escolhida, senao a unica, senao nenhuma', () => {
  assert.equal(rotaSemPerguntar([R1, R2], 'r1'), R1);
  assert.equal(rotaSemPerguntar([R1, R2]), null);
  assert.equal(rotaSemPerguntar([R2], 'r1'), R2);
  assert.equal(rotaSemPerguntar([], 'r1'), null);
  assert.deepEqual(ordenarRotas([R2, R1]).map((r) => r.id), ['r1', 'r2']);
});

test('liberar: pre-venda na rota trava com a lista dos pedidos', () => {
  const entregas = [{ pedidoId: 'a', numeroPedido: '0231' }, { pedidoId: 'b', numeroPedido: '0232' }, { pedidoId: 'c', numeroPedido: '0233' }];
  assert.deepEqual(pedidosSemFaturar(entregas, { a: 'Finalizada', b: 'Pré-venda', c: 'Finalizada' }), ['0232']);
  // Pedido que sumiu do banco tambem nao sai (nao da' pra garantir que foi faturado).
  assert.deepEqual(pedidosSemFaturar(entregas, { a: 'Finalizada' }), ['0232', '0233']);
  assert.equal(erroDePreVendaParaLiberar([]), null);
  assert.match(erroDePreVendaParaLiberar(['0232'])!, /pré-venda #0232 ainda não foi faturada/);
  assert.match(erroDePreVendaParaLiberar(['0232', '0233'])!, /2 pré-vendas sem faturar nesta rota: #0232, #0233/);
});

test('pedido para a rota: pre-venda entra apenas quando a configuracao aceita', () => {
  assert.equal(erroDoPedidoParaRomaneio({ id: 'x', numeroPedido: '0231', status: 'Pré-venda' }), 'O pedido #0231 ainda não foi faturado (situação: Pré-venda). Fature o pedido antes de colocá-lo na rota.');
  assert.equal(erroDoPedidoParaRomaneio({ id: 'x', numeroPedido: '0231', status: 'Pré-venda' }, true), null);
  assert.equal(erroDoPedidoParaRomaneio({ id: 'x', numeroPedido: '0231', status: 'Finalizada' }, true), null);
  // Pedido pendente do agente (WhatsApp) nao e' pre-venda confirmada: nao entra nem com a configuracao ligada.
  assert.match(erroDoPedidoParaRomaneio({ id: 'x', numeroPedido: '0231', status: 'Em Análise' }, true)!, /ainda não foi faturado/);
  assert.match(erroDoPedidoParaRomaneio({ id: 'x', numeroPedido: '0231', status: 'Cancelada' }, true)!, /cancelado/);
});

test('textos para a tela', () => {
  assert.equal(textoDoResultadoDaRota({ acao: 'desligado' }), '');
  assert.equal(textoDoResultadoDaRota({ acao: 'colocado', rota: R1 }), 'Colocado na Rota 01 DANIELA.');
  assert.equal(textoDoResultadoDaRota({ acao: 'anotada', rota: R2 }), 'Vai para a Rota 02 MARCOS quando for faturado.');
  assert.match(textoDoResultadoDaRota({ acao: 'sem_rota' }), /Nenhuma rota em montagem/);
  assert.match(textoDoResultadoDaRota({ acao: 'falhou', erro: 'sem permissão' }), /sem permissão/);
  assert.equal(textoDaRotaEscolhida(R1, 'nao'), '');
  assert.equal(textoDaRotaEscolhida(R1, 'na_pre_venda'), 'Vai para a Rota 01 DANIELA.');
  assert.equal(textoDaRotaEscolhida(R1, 'ao_faturar'), 'Vai para a Rota 01 DANIELA quando for faturado.');
  assert.match(textoDaRotaEscolhida(null, 'ao_faturar'), /Nenhuma rota em montagem/);
});
