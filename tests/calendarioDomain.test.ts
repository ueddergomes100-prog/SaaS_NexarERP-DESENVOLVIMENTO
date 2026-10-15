import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  anoForaDosLimites,
  anosDaPagina,
  diasNoMes,
  foraDosLimites,
  gradeDoMes,
  hojeIso,
  lerIso,
  mesForaDosLimites,
  paraIso,
  rotuloDoDia,
  rotuloDoMes,
  somarMeses,
} from '../src/utils/calendarioDomain';

test('lerIso aceita so data valida no formato do campo', () => {
  assert.deepEqual(lerIso('2026-10-15'), { ano: 2026, mes: 10, dia: 15 });
  assert.deepEqual(lerIso('2028-02-29'), { ano: 2028, mes: 2, dia: 29 });
  assert.equal(lerIso('2026-02-29'), null);
  assert.equal(lerIso('2026-13-01'), null);
  assert.equal(lerIso('15/10/2026'), null);
  assert.equal(lerIso(''), null);
  assert.equal(lerIso(undefined), null);
});

test('paraIso e hojeIso usam o dia local com zeros', () => {
  assert.equal(paraIso(2026, 1, 5), '2026-01-05');
  assert.equal(hojeIso(new Date(2026, 9, 15, 23, 59)), '2026-10-15');
});

test('diasNoMes conhece fevereiro bissexto', () => {
  assert.equal(diasNoMes(2026, 2), 28);
  assert.equal(diasNoMes(2028, 2), 29);
  assert.equal(diasNoMes(2026, 10), 31);
});

test('somarMeses vira o ano nos dois sentidos', () => {
  assert.deepEqual(somarMeses({ ano: 2026, mes: 12 }, 1), { ano: 2027, mes: 1 });
  assert.deepEqual(somarMeses({ ano: 2026, mes: 1 }, -1), { ano: 2025, mes: 12 });
  assert.deepEqual(somarMeses({ ano: 2026, mes: 10 }, -120), { ano: 2016, mes: 10 });
});

test('gradeDoMes tem 6 semanas comecando no domingo', () => {
  const grade = gradeDoMes({ ano: 2026, mes: 10 });
  assert.equal(grade.length, 42);
  // 01/10/2026 e' quinta: a grade comeca no domingo 27/09.
  assert.deepEqual(grade[0], { iso: '2026-09-27', dia: 27, doMes: false });
  assert.deepEqual(grade[4], { iso: '2026-10-01', dia: 1, doMes: true });
  assert.equal(grade.filter((d) => d.doMes).length, 31);
  assert.equal(grade[41].iso, '2026-11-07');
});

test('min/max do campo desligam dias, meses e anos fora do limite', () => {
  assert.equal(foraDosLimites('2026-10-16', '', '2026-10-15'), true);
  assert.equal(foraDosLimites('2026-10-15', '', '2026-10-15'), false);
  assert.equal(foraDosLimites('2026-01-01', '2026-02-01', ''), true);
  assert.equal(foraDosLimites('2026-01-01', 'lixo', null), false);
  assert.equal(mesForaDosLimites({ ano: 2026, mes: 11 }, '', '2026-10-15'), true);
  assert.equal(mesForaDosLimites({ ano: 2026, mes: 10 }, '', '2026-10-15'), false);
  assert.equal(mesForaDosLimites({ ano: 2026, mes: 9 }, '2026-10-02', ''), true);
  assert.equal(anoForaDosLimites(2027, '', '2026-10-15'), true);
  assert.equal(anoForaDosLimites(2026, '', '2026-10-15'), false);
});

test('pagina de anos: a decada com um ano antes e um depois', () => {
  assert.deepEqual(anosDaPagina(2026), [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030]);
  assert.equal(anosDaPagina(2030)[1], 2030);
});

test('rotulos em portugues', () => {
  assert.equal(rotuloDoMes({ ano: 2026, mes: 3 }), 'março de 2026');
  assert.equal(rotuloDoDia('2026-10-15'), '15 de outubro de 2026');
});
