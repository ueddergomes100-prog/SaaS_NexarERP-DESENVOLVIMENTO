const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIG_PADRAO,
  configEfetiva,
  precisaDeBackup,
  situacaoDoBackup,
  ultimoHorarioPrevisto,
} = require('../services/backupAgenda');

/* Agenda do backup automatico (12/11/2026): ligado por padrao, ronda de 10 em 10 minutos. */

/** Instante de um horario de Brasilia (UTC-3). */
const br = (iso) => Date.parse(`${iso}:00-03:00`);
const HORA = 60 * 60 * 1000;

test('sem nada gravado o backup automatico vem LIGADO, diario, 02:00', () => {
  assert.deepEqual(configEfetiva(null), { ...CONFIG_PADRAO, padrao: true });
  assert.equal(configEfetiva(undefined).enabled, true);
});

test('gravado vale o que esta gravado: desligado continua desligado; lixo vira diario 02:00', () => {
  assert.deepEqual(configEfetiva({ enabled: false, frequency: 'semanal', time: '23:30' }), { enabled: false, frequency: 'semanal', time: '23:30', padrao: false });
  assert.deepEqual(configEfetiva({ enabled: true, frequency: 'x', time: '99:99' }), { enabled: true, frequency: 'diario', time: '02:00', padrao: false });
  // enabled que nao e' exatamente true nao liga.
  assert.equal(configEfetiva({ enabled: 'sim' }).enabled, false);
});

test('ultimo horario previsto: diario (hoje ou ontem), no relogio de Brasilia', () => {
  const diario = configEfetiva({ enabled: true, frequency: 'diario', time: '02:00' });
  assert.equal(ultimoHorarioPrevisto(diario, br('2026-11-12T15:00')), br('2026-11-12T02:00'));
  assert.equal(ultimoHorarioPrevisto(diario, br('2026-11-12T01:59')), br('2026-11-11T02:00'));
  assert.equal(ultimoHorarioPrevisto(diario, br('2026-11-12T02:00')), br('2026-11-12T02:00'));
  // Virada de mes e de ano.
  assert.equal(ultimoHorarioPrevisto(diario, br('2027-01-01T00:30')), br('2026-12-31T02:00'));
  // 23:30 de Brasilia ja' e' o dia seguinte em UTC: nao pode pular o dia.
  const noite = configEfetiva({ enabled: true, frequency: 'diario', time: '23:30' });
  assert.equal(ultimoHorarioPrevisto(noite, br('2026-11-12T23:45')), br('2026-11-12T23:30'));
  assert.equal(ultimoHorarioPrevisto(noite, br('2026-11-12T23:00')), br('2026-11-11T23:30'));
});

test('ultimo horario previsto: semanal no domingo, mensal no dia 1', () => {
  const semanal = configEfetiva({ enabled: true, frequency: 'semanal', time: '02:00' });
  // 12/11/2026 e' quinta; o domingo anterior e' 08/11.
  assert.equal(ultimoHorarioPrevisto(semanal, br('2026-11-12T15:00')), br('2026-11-08T02:00'));
  assert.equal(ultimoHorarioPrevisto(semanal, br('2026-11-08T01:00')), br('2026-11-01T02:00'));
  assert.equal(ultimoHorarioPrevisto(semanal, br('2026-11-08T02:00')), br('2026-11-08T02:00'));
  const mensal = configEfetiva({ enabled: true, frequency: 'mensal', time: '02:00' });
  assert.equal(ultimoHorarioPrevisto(mensal, br('2026-11-12T15:00')), br('2026-11-01T02:00'));
  assert.equal(ultimoHorarioPrevisto(mensal, br('2026-11-01T01:00')), br('2026-10-01T02:00'));
  assert.equal(ultimoHorarioPrevisto(mensal, br('2027-01-01T01:00')), br('2026-12-01T02:00'));
});

test('ronda: faz backup de quem nao tem um depois do horario previsto; desligado nunca', () => {
  const padrao = configEfetiva(null);
  const agora = br('2026-11-12T02:10');
  assert.equal(precisaDeBackup(padrao, 0, agora), true, 'empresa que nunca teve backup');
  assert.equal(precisaDeBackup(padrao, br('2026-11-11T02:05'), agora), true, 'o de ontem nao vale para hoje');
  assert.equal(precisaDeBackup(padrao, br('2026-11-12T02:05'), agora), false, 'ja fez hoje');
  // Servidor ficou fora do ar as 02:00: a ronda das 09:00 ainda faz.
  assert.equal(precisaDeBackup(padrao, br('2026-11-11T02:05'), br('2026-11-12T09:00')), true);
  // Backup manual a tarde nao dispensa o das 02:00 do dia seguinte.
  assert.equal(precisaDeBackup(padrao, br('2026-11-11T15:00'), agora), true);
  assert.equal(precisaDeBackup(configEfetiva({ enabled: false }), 0, agora), false);
});

test('situacao para o painel: em dia, atrasado (passou da tolerancia), nunca e desligado', () => {
  const padrao = configEfetiva(null);
  const previsto = br('2026-11-12T02:00');
  assert.equal(situacaoDoBackup(padrao, br('2026-11-12T02:05'), br('2026-11-12T15:00')).situacao, 'em_dia');
  // Logo depois do horario a ronda ainda vai rodar: nao e' atraso.
  assert.equal(situacaoDoBackup(padrao, br('2026-11-11T02:05'), previsto + 1 * HORA).situacao, 'em_dia');
  const atrasado = situacaoDoBackup(padrao, br('2026-11-09T02:05'), previsto + 7 * HORA);
  assert.equal(atrasado.situacao, 'atrasado');
  assert.equal(atrasado.diasSemBackup, 3);
  assert.deepEqual(situacaoDoBackup(padrao, 0, previsto + 7 * HORA), { situacao: 'nunca', diasSemBackup: null });
  assert.equal(situacaoDoBackup(configEfetiva({ enabled: false }), br('2026-11-01T02:00'), previsto).situacao, 'desligado');
});
