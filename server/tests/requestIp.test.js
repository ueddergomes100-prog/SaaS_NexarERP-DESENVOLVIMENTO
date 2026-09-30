const test = require('node:test');
const assert = require('node:assert/strict');
const { ipDoCliente, normalizarIp } = require('../utils/requestIp');

test('normaliza IPv4 mapeado em IPv6 e o loopback', () => {
  assert.equal(normalizarIp('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(normalizarIp('::1'), '127.0.0.1');
  assert.equal(normalizarIp(' 198.51.100.7 '), '198.51.100.7');
  assert.equal(normalizarIp(undefined), '');
});

test('usa o IP que o Express resolveu (req.ip), nunca o cabecalho X-Forwarded-For', () => {
  const req = {
    ip: '::ffff:203.0.113.5',
    headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.5' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  assert.equal(ipDoCliente(req), '203.0.113.5');
});

test('sem req.ip (fora de uma requisicao real) cai no socket', () => {
  assert.equal(ipDoCliente({ socket: { remoteAddress: '::ffff:10.0.0.9' } }), '10.0.0.9');
  assert.equal(ipDoCliente({}), '');
});
