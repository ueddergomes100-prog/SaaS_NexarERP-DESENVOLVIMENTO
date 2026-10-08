import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMITE_TENTATIVAS,
  NUMERO_OS_PROVISORIO,
  esperaAposFalhaMs,
  fotosPendentesDaOs,
  ordenarPendencias,
  podeTentarAgora,
  resumoPendencias,
  rotuloNumeroOS,
  temAssinaturaPendente,
  textoDaFaixaOffline,
  type Pendencia,
} from '../src/utils/offlineDomain';

const base = { tenantId: 't', usuarioId: 'u', osId: 'os1', tentativas: 0, ultimoErro: '', ultimaTentativaEm: '' };
const lista: Pendencia[] = [
  { ...base, id: 'f2', tipo: 'foto', criadoEm: '2026-10-08T10:02:00Z', legenda: 'depois', nomeArquivo: 'b.jpg' },
  { ...base, id: 'n1', tipo: 'numero_os', criadoEm: '2026-10-08T10:03:00Z' },
  { ...base, id: 'f1', tipo: 'foto', criadoEm: '2026-10-08T10:01:00Z', legenda: 'antes', nomeArquivo: 'a.jpg' },
  { ...base, id: 'a1', tipo: 'assinatura', criadoEm: '2026-10-08T10:04:00Z', nomeAssinante: 'Maria' },
  { ...base, id: 'r1', tipo: 'reserva_os', criadoEm: '2026-10-08T10:00:30Z' },
];

test('ordem de envio: numero, reserva, assinatura, fotos na ordem feita', () => {
  assert.deepEqual(ordenarPendencias(lista).map((p) => p.id), ['n1', 'r1', 'a1', 'f1', 'f2']);
});

test('numero provisorio e rotulo', () => {
  assert.equal(rotuloNumeroOS(NUMERO_OS_PROVISORIO, true), 'nº pendente');
  assert.equal(rotuloNumeroOS('', false), 'nº pendente');
  assert.equal(rotuloNumeroOS('14', false), '#14');
});

test('nova tentativa: espacamento cresce, trava no limite', () => {
  assert.equal(esperaAposFalhaMs(1), 30_000);
  assert.equal(esperaAposFalhaMs(2), 60_000);
  assert.equal(esperaAposFalhaMs(20), 30 * 60_000);
  assert.equal(podeTentarAgora({ tentativas: 0, ultimaTentativaEm: '' }, '2026-10-08T10:00:00Z'), true);
  assert.equal(podeTentarAgora({ tentativas: 1, ultimaTentativaEm: '2026-10-08T10:00:00Z' }, '2026-10-08T10:00:10Z'), false);
  assert.equal(podeTentarAgora({ tentativas: 1, ultimaTentativaEm: '2026-10-08T10:00:00Z' }, '2026-10-08T10:00:31Z'), true);
  assert.equal(podeTentarAgora({ tentativas: LIMITE_TENTATIVAS, ultimaTentativaEm: '2026-10-08T10:00:00Z' }, '2026-10-09T10:00:00Z'), false);
});

test('resumo e faixa em portugues', () => {
  assert.equal(resumoPendencias([]).texto, 'Tudo enviado');
  assert.equal(resumoPendencias([{ tentativas: 0 }]).texto, '1 pendência para enviar');
  assert.equal(resumoPendencias([{ tentativas: 0 }, { tentativas: LIMITE_TENTATIVAS }]).texto, '2 pendências para enviar (1 com erro — toque para ver)');
  assert.equal(textoDaFaixaOffline(false, resumoPendencias([]), false), 'Sem conexão — o que você fizer fica guardado no aparelho');
  assert.equal(textoDaFaixaOffline(false, resumoPendencias([{ tentativas: 0 }]), false), 'Sem conexão — 1 pendência para enviar quando a rede voltar');
  assert.equal(textoDaFaixaOffline(true, resumoPendencias([{ tentativas: 0 }]), true), 'Enviando pendências…');
  assert.equal(textoDaFaixaOffline(true, resumoPendencias([]), false), null);
});

test('fotos e assinatura pendentes de uma OS', () => {
  assert.deepEqual(fotosPendentesDaOs(lista, 'os1').map((f) => f.legenda), ['antes', 'depois']);
  assert.deepEqual(fotosPendentesDaOs(lista, 'outra'), []);
  assert.equal(temAssinaturaPendente(lista, 'os1'), true);
  assert.equal(temAssinaturaPendente(lista, 'outra'), false);
});
