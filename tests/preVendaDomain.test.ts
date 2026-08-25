import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contaComoFaturamento,
  isPedidoAberto,
  isPedidoCancelado,
  parseAlterarPagamentoVendaFinalizada,
  parseTrabalhaComPreVenda,
  resolveOrigemPedido,
  STATUS_CANCELADA,
  STATUS_EM_ANALISE,
  STATUS_FINALIZADA,
  STATUS_PRE_VENDA,
} from '../src/utils/preVendaDomain';

test('isPedidoAberto cobre os dois estados abertos e nada mais', () => {
  assert.equal(isPedidoAberto(STATUS_PRE_VENDA), true);
  assert.equal(isPedidoAberto(STATUS_EM_ANALISE), true);
  assert.equal(isPedidoAberto(STATUS_FINALIZADA), false);
  assert.equal(isPedidoAberto(STATUS_CANCELADA), false);
});

test('isPedidoAberto tolera espaco em volta e valor ausente', () => {
  assert.equal(isPedidoAberto('  Pré-venda  '), true);
  assert.equal(isPedidoAberto(undefined), false);
  assert.equal(isPedidoAberto(null), false);
  assert.equal(isPedidoAberto(''), false);
});

test('contaComoFaturamento exclui pedido aberto -- o ponto da feature', () => {
  // Pre-venda e pedido do agente NAO podem somar em receita/caixa: nenhum
  // dos dois gerou lancamento financeiro.
  assert.equal(contaComoFaturamento(STATUS_PRE_VENDA), false);
  assert.equal(contaComoFaturamento(STATUS_EM_ANALISE), false);
});

test('contaComoFaturamento exclui cancelada e inclui finalizada', () => {
  assert.equal(contaComoFaturamento(STATUS_CANCELADA), false);
  assert.equal(contaComoFaturamento(STATUS_FINALIZADA), true);
});

test('contaComoFaturamento preserva venda legada com status desconhecido', () => {
  // Regressao: pedidos antigos gravados com outros status sempre contaram
  // como venda. Trocar por "e' Finalizada" sumiria com faturamento historico.
  assert.equal(contaComoFaturamento('concluida'), true);
  assert.equal(contaComoFaturamento('Concluída'), true);
  assert.equal(contaComoFaturamento(undefined), true);
});

test('isPedidoCancelado so reconhece o status de cancelamento', () => {
  assert.equal(isPedidoCancelado(STATUS_CANCELADA), true);
  assert.equal(isPedidoCancelado(STATUS_PRE_VENDA), false);
  assert.equal(isPedidoCancelado(undefined), false);
});

test('resolveOrigemPedido respeita a origem gravada', () => {
  assert.equal(resolveOrigemPedido({ status: STATUS_PRE_VENDA, origem: 'balcao' }), 'balcao');
  assert.equal(resolveOrigemPedido({ status: STATUS_EM_ANALISE, origem: 'agente' }), 'agente');
  // Origem gravada vence o fallback por status.
  assert.equal(resolveOrigemPedido({ status: STATUS_EM_ANALISE, origem: 'balcao' }), 'balcao');
});

test('resolveOrigemPedido trata pedido legado Em Analise como do agente', () => {
  // Antes desta feature nenhuma tela gravava 'Em Análise' -- so o agente de
  // WhatsApp criava esse documento, entao pedido sem `origem` so pode ser dele.
  assert.equal(resolveOrigemPedido({ status: STATUS_EM_ANALISE }), 'agente');
  assert.equal(resolveOrigemPedido({ status: STATUS_EM_ANALISE, origem: '' }), 'agente');
  assert.equal(resolveOrigemPedido({ status: STATUS_EM_ANALISE, origem: 'lixo' }), 'agente');
});

test('resolveOrigemPedido trata qualquer outro pedido sem origem como do balcao', () => {
  assert.equal(resolveOrigemPedido({ status: STATUS_FINALIZADA }), 'balcao');
  assert.equal(resolveOrigemPedido({}), 'balcao');
  assert.equal(resolveOrigemPedido(null), 'balcao');
  assert.equal(resolveOrigemPedido(undefined), 'balcao');
});

test('as configs so ligam com true explicito', () => {
  assert.equal(parseTrabalhaComPreVenda(true), true);
  assert.equal(parseTrabalhaComPreVenda('true'), false);
  assert.equal(parseTrabalhaComPreVenda(1), false);
  assert.equal(parseTrabalhaComPreVenda(undefined), false);
  assert.equal(parseAlterarPagamentoVendaFinalizada(true), true);
  assert.equal(parseAlterarPagamentoVendaFinalizada(undefined), false);
});
