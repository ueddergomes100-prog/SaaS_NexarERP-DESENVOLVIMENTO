import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ESPERAS_CONSULTA_ENVIO_MS,
  avisoDoEstadoDeEnvio,
  deveConsultarEnvioDeNovo,
  normalizarEstadoEnvio,
} from '../src/utils/envioCodigoDomain';

test('estado que o servidor manda fora da lista vira desconhecido', () => {
  for (const estado of ['entregue', 'a_caminho', 'devolvido', 'bloqueado', 'desconhecido']) {
    assert.equal(normalizarEstadoEnvio(estado), estado);
  }
  for (const estranho of ['suppressed', 'bounced', '', null, undefined, 42, {}]) {
    assert.equal(normalizarEstadoEnvio(estranho), 'desconhecido', String(estranho));
  }
});

test('entregue, a caminho e desconhecido nao geram aviso: o caminho feliz segue igual', () => {
  assert.equal(avisoDoEstadoDeEnvio('entregue', 'jo***@gmail.com'), null);
  assert.equal(avisoDoEstadoDeEnvio('a_caminho', 'jo***@gmail.com'), null);
  assert.equal(avisoDoEstadoDeEnvio('desconhecido', 'jo***@gmail.com'), null);
});

test('devolvido: diz o que houve, cita o endereco e manda conferir, trocar ou falar com o suporte', () => {
  const aviso = avisoDoEstadoDeEnvio('devolvido', 'jo***@gmail.com');
  assert.ok(aviso);
  assert.match(aviso.titulo, /não foi entregue/);
  assert.match(aviso.texto, /jo\*\*\*@gmail\.com/);
  assert.match(aviso.texto, /Voltar/);
  assert.match(aviso.texto, /informe outro/);
  assert.match(aviso.texto, /suporte/);
});

test('bloqueado: avisa que reenviar nao resolve e aponta outro e-mail ou o suporte', () => {
  const aviso = avisoDoEstadoDeEnvio('bloqueado', 'jo***@gmail.com');
  assert.ok(aviso);
  assert.match(aviso.texto, /bloqueado/);
  assert.match(aviso.texto, /de novo não resolve/);
  assert.match(aviso.texto, /outro e-mail/);
  assert.match(aviso.texto, /suporte/);
});

test('aviso nunca usa termo tecnico do servico de e-mail', () => {
  for (const estado of ['devolvido', 'bloqueado'] as const) {
    const aviso = avisoDoEstadoDeEnvio(estado, 'jo***@gmail.com');
    assert.ok(aviso);
    assert.doesNotMatch(`${aviso.titulo} ${aviso.texto}`, /resend|bounce|suppress|\bapi\b|undefined|null/i);
  }
});

test('sem o e-mail mascarado o aviso continua legivel', () => {
  const devolvido = avisoDoEstadoDeEnvio('devolvido', undefined);
  assert.ok(devolvido);
  assert.match(devolvido.texto, /^O e-mail informado não existe/);
  const bloqueado = avisoDoEstadoDeEnvio('bloqueado', '  ');
  assert.ok(bloqueado);
  assert.match(bloqueado.texto, /para o e-mail informado já voltou/);
});

test('pergunta de novo so enquanto nao ha resposta definitiva e ate o limite de consultas', () => {
  assert.equal(ESPERAS_CONSULTA_ENVIO_MS.length, 3);
  assert.equal(deveConsultarEnvioDeNovo('a_caminho', 1), true);
  assert.equal(deveConsultarEnvioDeNovo('desconhecido', 2), true);
  assert.equal(deveConsultarEnvioDeNovo('a_caminho', 3), false);
  assert.equal(deveConsultarEnvioDeNovo('entregue', 1), false);
  assert.equal(deveConsultarEnvioDeNovo('devolvido', 1), false);
  assert.equal(deveConsultarEnvioDeNovo('bloqueado', 1), false);
});
