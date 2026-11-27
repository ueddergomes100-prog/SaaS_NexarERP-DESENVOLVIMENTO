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

test('quem entra no lote: so em aberto; no Receber nunca cheque nem cartao; no Pagar cheque entra (24/11/2026)', () => {
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Boleto' }, 'saida'), true);
  assert.equal(podeEntrarNoLote({ status: 'Paga', formaPagamento: 'Boleto' }, 'saida'), false);
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cheque' }, 'saida'), true, 'cheque emitido: baixa direto no Contas a Pagar');
  assert.equal(podeEntrarNoLote({ status: 'Paga', formaPagamento: 'Cheque' }, 'saida'), false);
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cheque' }, 'entrada'), false, 'cheque recebido: compensacao');
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cartão de Crédito' }, 'entrada'), false, 'cartao concilia no Banco');
  assert.equal(podeEntrarNoLote({ status: 'Pendente', formaPagamento: 'Cartão de Crédito' }, 'saida'), true);
  assert.equal(podeEntrarNoLote({ status: 'Pendente' }, 'entrada'), true, 'sem forma gravada entra');
});

test('formas: as mesmas do servidor; cheque so no Pagar', () => {
  assert.ok(FORMAS_DA_BAIXA_EM_LOTE.saida.includes('Cheque'));
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
  const itens = [{ valorCentavos: 10000, ajustes: { jurosCentavos: 100, multaCentavos: 150, descontoCentavos: 0 } }, { valorCentavos: 5050 }];
  assert.deepEqual(resumoDoLote(itens), { quantidade: 2, valorCentavos: 15050, acrescimoCentavos: 250, descontoCentavos: 0, totalCentavos: 15300 });
  // Desconto (15/10/2026) sai do total.
  const comDesconto = [...itens, { valorCentavos: 2000, ajustes: { jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 500 } }];
  assert.deepEqual(resumoDoLote(comDesconto), { quantidade: 3, valorCentavos: 17050, acrescimoCentavos: 250, descontoCentavos: 500, totalCentavos: 16800 });
});

// Desconto geral (27/11/2026): reparte pelo valor de cada conta, sem sobra nem falta.
import { descontoPercentualPorConta as percentualPorConta, ratearDescontoGeral as ratear } from '../src/utils/baixaEmLoteDomain';

test('desconto geral: reparte proporcional e fecha o total no centavo', () => {
  assert.deepEqual(ratear([10000, 5000, 5000], 2000), [1000, 500, 500]);
  const partes = ratear([3333, 3333, 3334], 100);
  assert.ok(partes);
  assert.equal(partes!.reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(ratear([1000, 2000], 0), [0, 0]);
  assert.deepEqual(ratear([1000, 2000], 3000), [1000, 2000], 'desconto do valor todo');
  assert.equal(ratear([1000, 2000], 3001), null, 'nao passa do valor das contas');
  assert.equal(ratear([1000], -5), null);
  const muitas = ratear([1, 1, 1, 997], 7);
  assert.ok(muitas && muitas.every((p, i) => p <= [1, 1, 1, 997][i]) && muitas.reduce((a, b) => a + b, 0) === 7);
});

test('desconto geral em %: cada conta com a sua parte', () => {
  assert.deepEqual(percentualPorConta([10000, 3333], 10), [1000, 333]);
  assert.deepEqual(percentualPorConta([5000], 100), [5000]);
  assert.equal(percentualPorConta([5000], 101), null);
  assert.equal(percentualPorConta([5000], Number.NaN), null);
});
