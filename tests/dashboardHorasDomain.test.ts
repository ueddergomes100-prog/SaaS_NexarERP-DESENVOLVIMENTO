import test from 'node:test';
import assert from 'node:assert/strict';
import { horasDoEixoDoDia, momentoNoDiaDoPagamento } from '../src/utils/dashboardHorasDomain';

// Partes do dia em UTC: deixa o teste independente do fuso da maquina.
const partes = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const dia = new Date('2026-11-21T00:00:00Z');

test('hora do lancamento: a criacao quando e no mesmo dia (venda a vista)', () => {
  const criado = new Date('2026-11-21T14:35:00Z');
  assert.equal(momentoNoDiaDoPagamento(dia, [criado, new Date('2026-11-21T18:00:00Z')], partes), criado);
});

test('hora do lancamento: titulo antigo recebido hoje usa a alteracao (a baixa)', () => {
  const criado = new Date('2026-10-30T09:00:00Z');
  const baixa = new Date('2026-11-21T16:10:00Z');
  assert.equal(momentoNoDiaDoPagamento(dia, [criado, baixa], partes), baixa);
});

test('hora do lancamento: nenhum horario no dia do pagamento = sem hora conhecida', () => {
  assert.equal(momentoNoDiaDoPagamento(dia, [new Date('2026-10-30T09:00:00Z'), null, undefined], partes), null);
  assert.equal(momentoNoDiaDoPagamento(null, [new Date('2026-11-21T09:00:00Z')], partes), null);
});

test('eixo do Hoje: das 7h ate a hora atual; estende se houve movimento fora disso', () => {
  assert.deepEqual(horasDoEixoDoDia([], 10), [7, 8, 9, 10]);
  assert.deepEqual(horasDoEixoDoDia([9, 14], 20), [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(horasDoEixoDoDia([5], 8), [5, 6, 7, 8]);
  assert.deepEqual(horasDoEixoDoDia([], 3), [3], 'madrugada: o eixo comeca na hora atual, nunca fica vazio');
  assert.deepEqual(horasDoEixoDoDia([30, -1], 8), [7, 8], 'hora invalida e ignorada');
});
