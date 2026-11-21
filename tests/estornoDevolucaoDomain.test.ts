import test from 'node:test';
import assert from 'node:assert/strict';
import { creditoDaDevolucaoAposEstorno, planoDoEstornoDaDevolucao, type ItemDaDevolucao } from '../src/utils/estornoDevolucaoDomain';

const clipe: ItemDaDevolucao = { id: 'p1', nome: 'CLIPE NIVELADOR', quantidadeDevolvida: 4, subtotal: 108, precoUnitario: 27, descontoProporcional: 0 };
const piso: ItemDaDevolucao = { id: 'p2', nome: 'PISO', quantidadeDevolvida: 2.5, subtotal: 100, descontoProporcional: 10, fatorConversao: 1 };

test('caso Jomarly: devolveu 4 clipes, o certo eram 3 -> estorna 1, R$ 27, devolucao fica com 3', () => {
  const r = planoDoEstornoDaDevolucao([clipe], [1]);
  assert.ok(!('erro' in r));
  assert.equal(r.valorCentavos, 2700);
  assert.equal(r.total, false);
  assert.deepEqual(r.estornados, [{ id: 'p1', nome: 'CLIPE NIVELADOR', quantidade: 1, valorCentavos: 2700 }]);
  assert.equal(r.restantes[0].quantidadeDevolvida, 3);
  assert.equal(r.restantes[0].subtotal, 81);
  assert.equal(r.restantes[0].precoUnitario, 27, 'os outros campos do item ficam');
});

test('estornar tudo = devolucao estornada, com o subtotal inteiro (sem sobra de centavo)', () => {
  const r = planoDoEstornoDaDevolucao([clipe, piso], [4, '2,5']);
  assert.ok(!('erro' in r));
  assert.equal(r.total, true);
  assert.equal(r.valorCentavos, 20800);
  assert.deepEqual(r.restantes, []);
  assert.equal(r.estornados[1].fatorConversao, 1);
});

test('fracionado: proporcional ao subtotal, desconto acompanha; item com 0 fica inteiro', () => {
  const r = planoDoEstornoDaDevolucao([clipe, piso], [0, 1]);
  assert.ok(!('erro' in r));
  assert.equal(r.valorCentavos, 4000);
  assert.equal(r.restantes.length, 2);
  assert.equal(r.restantes[0], clipe);
  assert.equal(r.restantes[1].quantidadeDevolvida, 1.5);
  assert.equal(r.restantes[1].subtotal, 60);
  assert.equal(r.restantes[1].descontoProporcional, 6);
});

test('quantidade errada recusa dizendo o que fazer', () => {
  assert.match((planoDoEstornoDaDevolucao([clipe], [0]) as { erro: string }).erro, /pelo menos um item/);
  assert.match((planoDoEstornoDaDevolucao([clipe], [5]) as { erro: string }).erro, /no máximo 4/);
  assert.match((planoDoEstornoDaDevolucao([clipe], ['-1']) as { erro: string }).erro, /Quantidade inválida em CLIPE/);
  assert.match((planoDoEstornoDaDevolucao([clipe], ['abc']) as { erro: string }).erro, /Quantidade inválida/);
});

test('credito da devolucao depois do estorno', () => {
  // Jomarly: credito de R$ 108 ja' gasto (saldo 0); estorno de R$ 27 coberto pelo cancelamento.
  assert.deepEqual(
    creditoDaDevolucaoAposEstorno({ valorOriginalCentavos: 10800, saldoCentavos: 0, valorEstornoCentavos: 2700, doProprioCentavos: 0 }),
    { valorOriginalCentavos: 8100, saldoCentavos: 0, status: 'esgotado' },
  );
  assert.deepEqual(
    creditoDaDevolucaoAposEstorno({ valorOriginalCentavos: 10800, saldoCentavos: 10800, valorEstornoCentavos: 2700, doProprioCentavos: 2700 }),
    { valorOriginalCentavos: 8100, saldoCentavos: 8100, status: 'disponivel' },
  );
  assert.deepEqual(
    creditoDaDevolucaoAposEstorno({ valorOriginalCentavos: 10800, saldoCentavos: 5000, valorEstornoCentavos: 2700, doProprioCentavos: 2700 }),
    { valorOriginalCentavos: 8100, saldoCentavos: 2300, status: 'usado_parcial' },
  );
  assert.equal(creditoDaDevolucaoAposEstorno({ valorOriginalCentavos: 10800, saldoCentavos: 0, valorEstornoCentavos: 10800, doProprioCentavos: 0 }).status, 'cancelado');
});
