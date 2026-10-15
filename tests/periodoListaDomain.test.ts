import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diasDoPeriodoLista, janelaDoPeriodoNotas, PERIODO_LISTA_PADRAO, PERIODO_NOTAS_PADRAO, segundaDaSemana } from '../src/utils/periodoListaDomain';

const HOJE = '2026-10-14';

test('padrao das listas e o mes atual (decisao de 14/10)', () => {
  assert.equal(PERIODO_LISTA_PADRAO, 'mes');
  assert.deepEqual(diasDoPeriodoLista('mes', HOJE), { de: '2026-10-01', ate: HOJE });
  assert.deepEqual(diasDoPeriodoLista('mes', '2026-10-01'), { de: '2026-10-01', ate: '2026-10-01' }, 'dia 1: so o dia 1');
});

test('Todas = sem corte no banco', () => {
  assert.equal(diasDoPeriodoLista('', HOJE), null);
});

test('hoje, ontem e 7 dias (inclusive), virando o mes', () => {
  assert.deepEqual(diasDoPeriodoLista('hoje', HOJE), { de: HOJE, ate: HOJE });
  assert.deepEqual(diasDoPeriodoLista('ontem', '2026-10-01'), { de: '2026-09-30', ate: '2026-09-30' });
  assert.deepEqual(diasDoPeriodoLista('7dias', '2026-10-03'), { de: '2026-09-27', ate: '2026-10-03' });
});

test('personalizado: incompleto fica no mes atual; invertido e trocado', () => {
  assert.deepEqual(diasDoPeriodoLista('personalizado', HOJE, '2026-09-01', ''), { de: '2026-10-01', ate: HOJE });
  assert.deepEqual(diasDoPeriodoLista('personalizado', HOJE, '2026-09-01', '2026-09-30'), { de: '2026-09-01', ate: '2026-09-30' });
  assert.deepEqual(diasDoPeriodoLista('personalizado', HOJE, '2026-09-30', '2026-09-01'), { de: '2026-09-01', ate: '2026-09-30' });
});

test('periodo da lista de notas: mes, mes passado (virando o ano), 90 dias e tudo', () => {
  assert.equal(PERIODO_NOTAS_PADRAO, 'mes');
  assert.deepEqual(janelaDoPeriodoNotas('mes', HOJE), { de: '2026-10-01', ate: HOJE });
  assert.deepEqual(janelaDoPeriodoNotas('mesPassado', HOJE), { de: '2026-09-01', ate: '2026-09-30' });
  assert.deepEqual(janelaDoPeriodoNotas('mesPassado', '2027-01-15'), { de: '2026-12-01', ate: '2026-12-31' });
  assert.deepEqual(janelaDoPeriodoNotas('90dias', HOJE), { de: '2026-07-17', ate: HOJE });
  assert.equal(janelaDoPeriodoNotas('tudo', HOJE), null);
});

test('notas: hoje e esta semana (segunda ate hoje, virando o mes) -- pedido de 15/10/2026', () => {
  assert.deepEqual(janelaDoPeriodoNotas('hoje', HOJE), { de: HOJE, ate: HOJE });
  // 14/10/2026 e' quarta: a semana comeca na segunda 12/10.
  assert.deepEqual(janelaDoPeriodoNotas('semana', HOJE), { de: '2026-10-12', ate: HOJE });
  assert.deepEqual(janelaDoPeriodoNotas('semana', '2026-10-12'), { de: '2026-10-12', ate: '2026-10-12' }, 'segunda: so o proprio dia');
  assert.deepEqual(janelaDoPeriodoNotas('semana', '2026-10-18'), { de: '2026-10-12', ate: '2026-10-18' }, 'domingo fecha a semana');
  assert.deepEqual(janelaDoPeriodoNotas('semana', '2026-11-01'), { de: '2026-10-26', ate: '2026-11-01' }, 'domingo 01/11: semana comecou em outubro');
  assert.equal(segundaDaSemana('2026-10-15'), '2026-10-12');
});

test('notas: data personalizada com a regra das outras listas', () => {
  assert.deepEqual(janelaDoPeriodoNotas('personalizado', HOJE, '2026-09-01', '2026-09-10'), { de: '2026-09-01', ate: '2026-09-10' });
  assert.deepEqual(janelaDoPeriodoNotas('personalizado', HOJE, '2026-09-10', '2026-09-01'), { de: '2026-09-01', ate: '2026-09-10' });
  assert.deepEqual(janelaDoPeriodoNotas('personalizado', HOJE, '', '2026-09-10'), { de: '2026-10-01', ate: HOJE }, 'incompleto fica no mes');
});
