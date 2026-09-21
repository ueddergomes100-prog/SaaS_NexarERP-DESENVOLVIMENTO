import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ETAPAS_EMISSAO,
  INTERVALO_CONSULTA_MS,
  LIMITE_ESPERA_MS,
  codigoDaRejeicao,
  desfechoDoStatus,
  deveContinuarConsultando,
  estaEmProcessamento,
  orgaoAutorizador,
  rotuloDaEtapa,
  situacaoDaEtapa,
  textoDoDesfecho,
} from '../src/utils/emissaoProgressoDomain';

test('so enqueued, processing e created contam como em processamento', () => {
  for (const s of ['enqueued', 'processing', 'created']) assert.equal(estaEmProcessamento(s), true, s);
  for (const s of ['authorized', 'rejected', 'denied', 'canceled', '', null, undefined]) assert.equal(estaEmProcessamento(s), false, String(s));
});

test('desfecho do status: autorizada, rejeitada (rejected e denied) e o resto e nulo', () => {
  assert.equal(desfechoDoStatus('authorized'), 'autorizada');
  assert.equal(desfechoDoStatus('rejected'), 'rejeitada');
  assert.equal(desfechoDoStatus('denied'), 'rejeitada');
  assert.equal(desfechoDoStatus('processing'), null);
  assert.equal(desfechoDoStatus('canceled'), null);
  assert.equal(desfechoDoStatus('qualquer-coisa-nova'), null); // nunca vira sucesso por engano
});

test('para de consultar quando termina ou passa do limite', () => {
  const inicio = 1_000_000;
  assert.equal(deveContinuarConsultando({ iniciouEmMs: inicio, agoraMs: inicio + 3000, status: 'processing' }), true);
  assert.equal(deveContinuarConsultando({ iniciouEmMs: inicio, agoraMs: inicio + LIMITE_ESPERA_MS - 1, status: 'enqueued' }), true);
  assert.equal(deveContinuarConsultando({ iniciouEmMs: inicio, agoraMs: inicio + LIMITE_ESPERA_MS, status: 'processing' }), false);
  assert.equal(deveContinuarConsultando({ iniciouEmMs: inicio, agoraMs: inicio + 1000, status: 'authorized' }), false);
  assert.equal(deveContinuarConsultando({ iniciouEmMs: inicio, agoraMs: inicio + 1000, status: 'rejected' }), false);
});

test('prazos: consulta a cada 3s e espera no maximo 90s', () => {
  assert.equal(INTERVALO_CONSULTA_MS, 3000);
  assert.equal(LIMITE_ESPERA_MS, 90_000);
});

test('as tres etapas aparecem na ordem certa', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => e.id), ['validando', 'enviando', 'transmitindo']);
});

test('em andamento: etapas anteriores feitas, atual em andamento, seguintes pendentes', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'validando', null)), ['andamento', 'pendente', 'pendente']);
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'enviando', null)), ['feita', 'andamento', 'pendente']);
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'transmitindo', null)), ['feita', 'feita', 'andamento']);
});

test('autorizada: tudo feito', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'transmitindo', 'autorizada')), ['feita', 'feita', 'feita']);
});

test('rejeitada pela SEFAZ: o erro cai na ultima etapa, as anteriores ficam feitas', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'transmitindo', 'rejeitada')), ['feita', 'feita', 'erro']);
});

test('falha no envio: o erro cai na etapa de envio e a seguinte fica pendente', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'enviando', 'falha_envio')), ['feita', 'erro', 'pendente']);
});

test('demorando: a transmissao segue em andamento, sem marcar erro', () => {
  assert.deepEqual(ETAPAS_EMISSAO.map((e) => situacaoDaEtapa(e.id, 'transmitindo', 'demorando')), ['feita', 'feita', 'andamento']);
});

test('acha o numero da rejeicao no codigo ou no texto', () => {
  assert.equal(codigoDaRejeicao('232', null), '232');
  assert.equal(codigoDaRejeicao(null, 'Rejeição 778: NCM inexistente'), '778');
  assert.equal(codigoDaRejeicao('SPD003', 'Rejeicao: 539 duplicidade'), '539');
  assert.equal(codigoDaRejeicao('SPD003', 'Ambiente: 0'), null);
  assert.equal(codigoDaRejeicao(null, null), null);
});

test('texto de nota autorizada traz o numero e nao traz orientacao de erro', () => {
  const t = textoDoDesfecho({ desfecho: 'autorizada', tipo: 'NF-e', numero: 5 });
  assert.equal(t.titulo, 'NF-e Nº 5 autorizada');
  assert.equal(t.orientacao, '');
});

test('rejeicao conhecida (232) manda cadastrar a IE do cliente', () => {
  const t = textoDoDesfecho({ desfecho: 'rejeitada', tipo: 'NF-e', codigo: '232', mensagem: 'Rejeição 232: IE do destinatário não informada' });
  assert.equal(t.titulo, 'NF-e rejeitada');
  assert.match(t.detalhe, /IE do destinat/);
  assert.match(t.orientacao, /Cadastre a IE no cliente/);
});

test('rejeicao conhecida (778) manda corrigir o NCM', () => {
  const t = textoDoDesfecho({ desfecho: 'rejeitada', tipo: 'NF-e', mensagem: 'Rejeição 778: NCM inválido' });
  assert.match(t.orientacao, /NCM/);
});

test('rejeicao desconhecida: mostra a mensagem da SEFAZ e manda retransmitir/consultar', () => {
  const t = textoDoDesfecho({ desfecho: 'rejeitada', tipo: 'NF-e', codigo: '999', mensagem: 'Erro qualquer da SEFAZ' });
  assert.match(t.detalhe, /999/);
  assert.match(t.detalhe, /Erro qualquer da SEFAZ/);
  assert.match(t.orientacao, /Retransmitir/);
  assert.match(t.orientacao, /Consultar na Spedy/);
});

test('rejeicao sem mensagem nao fica em branco', () => {
  const t = textoDoDesfecho({ desfecho: 'rejeitada', tipo: 'NFC-e', mensagem: null });
  assert.match(t.detalhe, /não informou o motivo/);
});

test('NFS-e e autorizada pela prefeitura, as demais pela SEFAZ', () => {
  assert.equal(orgaoAutorizador('NFS-e'), 'prefeitura');
  assert.equal(orgaoAutorizador('NF-e'), 'SEFAZ');
  assert.equal(orgaoAutorizador('NFC-e'), 'SEFAZ');
  assert.equal(rotuloDaEtapa('transmitindo', 'NFS-e'), 'Transmitindo para a prefeitura');
  assert.equal(rotuloDaEtapa('transmitindo', 'NF-e'), 'Transmitindo para a SEFAZ');
  assert.equal(rotuloDaEtapa('enviando', 'NFS-e'), 'Enviando para a Spedy');
  assert.match(textoDoDesfecho({ desfecho: 'autorizada', tipo: 'NFS-e', numero: 9 }).detalhe, /prefeitura autorizou/);
  assert.match(textoDoDesfecho({ desfecho: 'demorando', tipo: 'NFS-e' }).titulo, /prefeitura ainda não respondeu/);
});

test('demorando avisa que segue processando e pede pra nao emitir de novo', () => {
  const t = textoDoDesfecho({ desfecho: 'demorando', tipo: 'NF-e' });
  assert.match(t.detalhe, /continua sendo processada/);
  assert.match(t.orientacao, /Não emita de novo/);
});

test('falha no envio deixa claro que a nota NAO foi emitida', () => {
  const t = textoDoDesfecho({ desfecho: 'falha_envio', tipo: 'NF-e', erroEnvio: 'Dados inválidos para a Spedy: NCM' });
  assert.match(t.titulo, /Não foi possível enviar/);
  assert.match(t.detalhe, /Dados inválidos/);
  assert.match(t.orientacao, /não foi emitida/);
});
