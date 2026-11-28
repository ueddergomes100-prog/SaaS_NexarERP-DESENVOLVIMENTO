import assert from 'node:assert/strict';
import { test } from 'node:test';
import { painelDoContasAPagar } from '../src/utils/painelContasPagarDomain';

test('painel do Contas a Pagar (28/11/2026): vencidas, hoje, semana, em aberto e pago hoje', () => {
  // 28/11/2026 e' sabado: a semana vai de 23/11 (segunda) a 29/11 (domingo).
  const p = painelDoContasAPagar([
    { status: 'Pendente', data: '2026-11-20', valor: 100 },
    { status: 'Pendente', data: '2026-11-24', valor: 50 },
    { status: 'Pendente', data: '2026-11-28', valor: 30.5 },
    { status: 'Pendente', data: '2026-11-29', valor: 20 },
    { status: 'Pendente', data: '2026-12-10', valor: 1000 },
    { status: 'Paga', data: '2026-11-28', dataPagamento: '2026-11-28', valor: 200, descontoCentavos: 1000 },
    { status: 'Paga', data: '2026-11-27', dataPagamento: '2026-11-27', valor: 999 },
    { status: 'Cancelada', data: '2026-11-28', valor: 77 },
  ], '2026-11-28');
  assert.deepEqual(p.vencidas, { quantidade: 2, centavos: 15000 });
  assert.deepEqual(p.hoje, { quantidade: 1, centavos: 3050 });
  assert.deepEqual(p.semana, { quantidade: 3, centavos: 10050 });
  assert.deepEqual(p.emAberto, { quantidade: 5, centavos: 120050 });
  assert.deepEqual(p.pagoHoje, { quantidade: 1, centavos: 19000 }, 'pago hoje desconta o desconto da baixa');
});
