import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  baixaEmLoteExigeBanco,
  estadoDaSelecao,
  FORMAS_DA_BAIXA_EM_LOTE,
  LIMITE_BAIXA_EM_LOTE,
  marcarNaSelecao,
  podeEntrarNoLote,
  resumoDoLote,
} from '../src/utils/baixaEmLoteDomain';

test('quem entra no lote: so em aberto, nunca cheque; no Receber nunca cartao', () => {
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Boleto' }, 'saida'), true);
  assert.equal(podeEntrarNoLote({ status: 'Paga', formaPagamento: 'Boleto' }, 'saida'), false);
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cheque' }, 'saida'), false, 'cheque emitido: compensacao');
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cheque' }, 'entrada'), false, 'cheque recebido: compensacao');
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cartão de Crédito' }, 'entrada'), false, 'cartao concilia no Banco');
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cartão de Crédito' }, 'saida'), true);
  assert.equal(podeEntrarNoLote({ status: 'Pendente' }, 'entrada'), true, 'sem forma gravada entra');
});

test('formas: as mesmas do servidor, sem cheque', () => {
  assert.ok(!FORMAS_DA_BAIXA_EM_LOTE.saida.includes('Cheque'));
  assert.ok(!FORMAS_DA_BAIXA_EM_LOTE.entrada.includes('Cheque'));
  assert.ok(FORMAS_DA_BAIXA_EM_LOTE.saida.includes('Boleto'));
  assert.ok(!FORMAS_DA_BAIXA_EM_LOTE.entrada.includes('Boleto'));
});

test('banco: Pagar exige em tudo menos dinheiro; Receber so onde a forma pede', () => {
  assert.equal(baixaEmLoteExigeBanco('saida', 'Dinheiro'), false);
  assert.equal(baixaEmLoteExigeBanco('saida', 'Outros'), true);
  assert.equal(baixaEmLoteExigeBanco('entrada', 'Pix'), true);
  assert.equal(baixaEmLoteExigeBanco('entrada', 'Outros'), false);
  assert.equal(baixaEmLoteExigeBanco('entrada', 'Dinheiro'), false);
});

test('selecao respeita o limite e conta quem ficou de fora', () => {
  const ids = Array.from({ length: LIMITE_BAIXA_EM_LOTE + 3 }, (_, i) => `t${i}`);
  const { selecao, deFora } = marcarNaSelecao(new Set(), ids, true);
  assert.equal(selecao.size, LIMITE_BAIXA_EM_LOTE);
  assert.equal(deFora, 3);
  const desmarcado = marcarNaSelecao(selecao, ['t0', 't1'], false);
  assert.equal(desmarcado.selecao.size, LIMITE_BAIXA_EM_LOTE - 2);
  assert.equal(marcarNaSelecao(new Set(['a']), ['a'], true).selecao.size, 1, 'marcar de novo nao duplica');
});

test('estado da caixa do grupo', () => {
  assert.equal(estadoDaSelecao(new Set(), ['a', 'b']), 'nenhum');
  assert.equal(estadoDaSelecao(new Set(['a']), ['a', 'b']), 'alguns');
  assert.equal(estadoDaSelecao(new Set(['a', 'b', 'x']), ['a', 'b']), 'todos');
  assert.equal(estadoDaSelecao(new Set(['a']), []), 'nenhum');
});

test('resumo: valor, juros so quando cobrados, total', () => {
  const itens = [{ valorCentavos: 10000, acrescimoSugeridoCentavos: 250 }, { valorCentavos: 5050 }];
  assert.deepEqual(resumoDoLote(itens, true), { quantidade: 2, valorCentavos: 15050, acrescimoCentavos: 250, totalCentavos: 15300 });
  assert.deepEqual(resumoDoLote(itens, false), { quantidade: 2, valorCentavos: 15050, acrescimoCentavos: 0, totalCentavos: 15050 });
});
