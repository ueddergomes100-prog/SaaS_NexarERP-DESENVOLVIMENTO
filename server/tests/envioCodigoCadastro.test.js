const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ESTADO_ENVIO,
  MOTIVO_ESTADO_DESCONHECIDO,
  estadoDoEventoResend,
  estadoDeEnvioEhFinal,
  respostaPublicaDoEnvio,
  consultarEnvioNoResend,
} = require('../services/envioCodigoCadastro');

const resposta = (status, corpo) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => corpo,
});

test('evento do Resend vira o estado que a tela entende', () => {
  for (const evento of ['delivered', 'opened', 'clicked', 'complained']) {
    assert.equal(estadoDoEventoResend(evento), ESTADO_ENVIO.ENTREGUE, evento);
  }
  for (const evento of ['sent', 'queued', 'scheduled', 'delivery_delayed']) {
    assert.equal(estadoDoEventoResend(evento), ESTADO_ENVIO.A_CAMINHO, evento);
  }
  assert.equal(estadoDoEventoResend('bounced'), ESTADO_ENVIO.DEVOLVIDO);
  assert.equal(estadoDoEventoResend('failed'), ESTADO_ENVIO.DEVOLVIDO);
  // O caso do incidente de 23/11/2026: endereco na lista de bloqueio.
  assert.equal(estadoDoEventoResend('suppressed'), ESTADO_ENVIO.BLOQUEADO);
  assert.equal(estadoDoEventoResend(' Suppressed '), ESTADO_ENVIO.BLOQUEADO);
});

test('evento novo, vazio ou cancelado nao alarma ninguem: desconhecido', () => {
  for (const evento of ['canceled', 'evento_que_nao_existe', '', null, undefined, 42]) {
    assert.equal(estadoDoEventoResend(evento), ESTADO_ENVIO.DESCONHECIDO, String(evento));
  }
});

test('so entregue, devolvido e bloqueado sao estados finais', () => {
  assert.equal(estadoDeEnvioEhFinal('entregue'), true);
  assert.equal(estadoDeEnvioEhFinal('devolvido'), true);
  assert.equal(estadoDeEnvioEhFinal('bloqueado'), true);
  assert.equal(estadoDeEnvioEhFinal('a_caminho'), false);
  assert.equal(estadoDeEnvioEhFinal('desconhecido'), false);
  assert.equal(estadoDeEnvioEhFinal(null), false);
  assert.equal(estadoDeEnvioEhFinal(undefined), false);
});

test('resposta para a tela leva so o estado, nunca dado do e-mail', () => {
  assert.deepEqual(respostaPublicaDoEnvio('bloqueado'), { ok: true, estado: 'bloqueado' });
  assert.deepEqual(respostaPublicaDoEnvio('qualquer coisa'), { ok: true, estado: 'desconhecido' });
  assert.deepEqual(respostaPublicaDoEnvio(undefined), { ok: true, estado: 'desconhecido' });
});

test('consulta: chama GET /emails/{id} com a chave e traduz o last_event', async () => {
  const chamadas = [];
  const buscar = async (url, opcoes, controle) => {
    chamadas.push({ url, opcoes, controle });
    return resposta(200, { object: 'email', id: 'abc-123', to: ['cliente@gmail.com'], last_event: 'suppressed' });
  };

  const resultado = await consultarEnvioNoResend('abc-123', { apiKey: 're_teste', buscar });

  assert.deepEqual(resultado, { estado: 'bloqueado' });
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://api.resend.com/emails/abc-123');
  assert.equal(chamadas[0].opcoes.method, 'GET');
  assert.equal(chamadas[0].opcoes.headers.Authorization, 'Bearer re_teste');
  assert.ok(chamadas[0].controle.timeoutMs > 0, 'consulta com tempo limite');
});

test('consulta: devolvido pelo servidor do destinatario', async () => {
  const buscar = async () => resposta(200, { last_event: 'bounced' });
  assert.deepEqual(await consultarEnvioNoResend('abc', { apiKey: 're_teste', buscar }), { estado: 'devolvido' });
});

test('consulta: id estranho nao vira caminho de URL', async () => {
  let urlChamada = '';
  const buscar = async (url) => { urlChamada = url; return resposta(404, {}); };
  await consultarEnvioNoResend('../suppressions?x=1', { apiKey: 're_teste', buscar });
  assert.equal(urlChamada, 'https://api.resend.com/emails/..%2Fsuppressions%3Fx%3D1');
});

test('consulta: sem id ou sem chave nem chama o Resend', async () => {
  let chamou = false;
  const buscar = async () => { chamou = true; return resposta(200, {}); };
  assert.deepEqual(await consultarEnvioNoResend('', { apiKey: 're_teste', buscar }), { estado: 'desconhecido', motivo: MOTIVO_ESTADO_DESCONHECIDO.SEM_ID });
  assert.deepEqual(await consultarEnvioNoResend('abc', { apiKey: '', buscar }), { estado: 'desconhecido', motivo: MOTIVO_ESTADO_DESCONHECIDO.SEM_CHAVE });
  assert.equal(chamou, false);
});

test('consulta: chave so de envio (401 restricted_api_key) vira desconhecido com o motivo certo', async () => {
  const buscar = async () => resposta(401, { name: 'restricted_api_key', message: 'This API key is restricted to only send emails.' });
  assert.deepEqual(
    await consultarEnvioNoResend('abc', { apiKey: 're_teste', buscar }),
    { estado: 'desconhecido', motivo: MOTIVO_ESTADO_DESCONHECIDO.CHAVE_SEM_PERMISSAO },
  );
});

test('consulta: 404, 429, 500 e resposta sem JSON viram desconhecido, sem lancar erro', async () => {
  const com = (r) => consultarEnvioNoResend('abc', { apiKey: 're_teste', buscar: async () => r });
  assert.equal((await com(resposta(404, {}))).motivo, MOTIVO_ESTADO_DESCONHECIDO.NAO_ENCONTRADO);
  assert.equal((await com(resposta(429, {}))).motivo, MOTIVO_ESTADO_DESCONHECIDO.LIMITE);
  assert.equal((await com(resposta(500, {}))).motivo, MOTIVO_ESTADO_DESCONHECIDO.FALHA);
  const semJson = { status: 200, ok: true, json: async () => { throw new Error('nao e json'); } };
  assert.deepEqual(await com(semJson), { estado: 'desconhecido' });
});

test('consulta: Resend fora do ar ou lento nunca derruba o cadastro', async () => {
  const buscar = async () => { throw new Error('O serviço de e-mail não respondeu em 20 segundos.'); };
  assert.deepEqual(
    await consultarEnvioNoResend('abc', { apiKey: 're_teste', buscar }),
    { estado: 'desconhecido', motivo: MOTIVO_ESTADO_DESCONHECIDO.FALHA },
  );
});
