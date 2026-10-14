import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONSULTA_PENDENTES_LENTA_MS,
  CONSULTA_PENDENTES_MEDIA_MS,
  CONSULTA_PENDENTES_RAPIDA_MS,
  intervaloConsultaPendentes,
} from '../src/utils/consultaPendentesDomain';

const AGORA = Date.parse('2026-10-14T15:00:00.000Z');
const ha = (minutos: number) => new Date(AGORA - minutos * 60_000).toISOString();

test('sem nota pendente nao consulta', () => {
  assert.equal(intervaloConsultaPendentes([], AGORA), null);
});

test('nota recem-enviada consulta rapido; desacelera com a idade', () => {
  assert.equal(intervaloConsultaPendentes([ha(1)], AGORA), CONSULTA_PENDENTES_RAPIDA_MS);
  assert.equal(intervaloConsultaPendentes([ha(5)], AGORA), CONSULTA_PENDENTES_MEDIA_MS);
  assert.equal(intervaloConsultaPendentes([ha(45)], AGORA), CONSULTA_PENDENTES_LENTA_MS);
});

test('vale a nota pendente mais recente (uma travada nao atrasa a nova)', () => {
  assert.equal(intervaloConsultaPendentes([ha(240), ha(1)], AGORA), CONSULTA_PENDENTES_RAPIDA_MS);
});

test('sem data legivel conta como recem-enviada', () => {
  assert.equal(intervaloConsultaPendentes(['', ha(240)], AGORA), CONSULTA_PENDENTES_RAPIDA_MS);
  assert.equal(intervaloConsultaPendentes([undefined], AGORA), CONSULTA_PENDENTES_RAPIDA_MS);
});
