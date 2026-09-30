/**
 * IP de quem chamou.
 *
 * Antes cada rota lia o PRIMEIRO valor de `X-Forwarded-For` por conta
 * propria. Esse valor e' escrito por quem faz a requisicao: bastava mandar
 * `X-Forwarded-For: 1.2.3.4` pra virar "outro IP" e zerar o limite de
 * tentativas (auditoria de 2026-09-30). Agora quem resolve o IP e' o
 * proprio Express, com `trust proxy` configurado em server.js
 * (TRUST_PROXY_HOPS): ele descarta o que o cliente escreveu e fica com o
 * endereco que o proxy da hospedagem acrescentou.
 *
 * `req.ip` vem vazio so' fora de uma requisicao HTTP de verdade (testes);
 * o socket cobre esse caso.
 */
const normalizarIp = (ip) => String(ip || '')
  .trim()
  .replace(/^::ffff:/, '')
  .replace(/^::1$/, '127.0.0.1');

const ipDoCliente = (req) => normalizarIp(
  (req && req.ip) || (req && req.socket && req.socket.remoteAddress) || '',
);

module.exports = { ipDoCliente, normalizarIp };
