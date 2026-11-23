import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumoDosDebitos } from '../src/utils/debitosClienteAppDomain';

test('sem saldo: diz que nao ha debito', () => {
  assert.deepEqual(resumoDosDebitos({ saldoCentavos: 0, maiorAtrasoDias: 0 }), { nivel: 'sem-debito', titulo: 'Sem débitos em aberto', detalhe: '' });
  assert.equal(resumoDosDebitos({ saldoCentavos: -500, maiorAtrasoDias: 3 }).nivel, 'sem-debito');
});

test('saldo sem atraso: valor em reais e nenhuma vencida', () => {
  const r = resumoDosDebitos({ saldoCentavos: 27203205, maiorAtrasoDias: 0 });
  assert.equal(r.nivel, 'em-aberto');
  assert.equal(r.titulo, 'Débitos em aberto: R$ 272.032,05');
  assert.equal(r.detalhe, 'Nenhuma conta vencida.');
});

test('saldo com atraso: avisa os dias, no singular e no plural', () => {
  assert.equal(resumoDosDebitos({ saldoCentavos: 15000, maiorAtrasoDias: 1 }).detalhe, 'Tem conta vencida há 1 dia. Confira com o financeiro antes de vender a prazo.');
  const r = resumoDosDebitos({ saldoCentavos: 15000, maiorAtrasoDias: 42 });
  assert.equal(r.nivel, 'atrasado');
  assert.equal(r.titulo, 'Débitos em aberto: R$ 150,00');
  assert.match(r.detalhe, /há 42 dias/);
});
