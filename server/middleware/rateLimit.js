/**
 * Limite de requisicoes (express-rate-limit).
 *
 * Tres niveis, todos com resposta 429 em portugues:
 *
 *  1. `limitadorGlobalApi` -- todo `/api/*`, por IP. Freio contra martelar o
 *     servidor (com ou sem token). Generoso: uma loja com 10 estacoes atras
 *     do mesmo IP (NAT) conta como um IP so'. Ajustavel por variavel
 *     (RATE_LIMIT_MAX / RATE_LIMIT_JANELA_MIN).
 *  2. `limitadorPublico(nome, ...)` -- rotas SEM token (onboarding, login
 *     do app): mais apertado, por IP.
 *  3. `limitadorPorChave(nome, chave, ...)` -- por e-mail, CNPJ, usuario...
 *     Independe do IP: mesmo que alguem tenha muitos IPs, o alvo (um e-mail,
 *     um vendedor) continua protegido.
 *
 * O IP vem de `req.ip`, resolvido pelo Express com `trust proxy` (ver
 * server.js) -- nao do cabecalho que o cliente escreve.
 *
 * O armazenamento e' em memoria e some quando o processo reinicia. Serve
 * pra uma instancia so' (a hospedagem atual); com mais de uma instancia,
 * trocar por um store compartilhado (Redis) -- e ai' o cron de backup
 * tambem precisaria de trava, ver services/scheduler.js.
 */
const { rateLimit } = require('express-rate-limit');

const MINUTO_MS = 60 * 1000;

const numeroDoAmbiente = (nome, padrao) => {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
};

const MENSAGEM_PADRAO = 'Muitas requisições em pouco tempo. Aguarde alguns minutos e tente de novo.';

const responder429 = (mensagem) => (req, res) => {
  res.status(429).json({ error: mensagem || MENSAGEM_PADRAO });
};

/**
 * Monta um limitador. `chave` opcional: funcao (req) => string; sem ela, o
 * limite e' por IP (o express-rate-limit ja' normaliza IPv6 pra /56).
 */
const criarLimitador = ({ janelaMs, limite, chave, mensagem, pular }) => rateLimit({
  windowMs: janelaMs,
  limit: limite,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ...(chave ? { keyGenerator: (req) => String(chave(req) || 'sem-chave') } : {}),
  ...(pular ? { skip: pular } : {}),
  handler: responder429(mensagem),
});

/** Todo /api/*: por IP. Webhook da Spedy fica de fora (tem segredo proprio,
 *  e a Spedy pode reenviar varios eventos de uma vez). */
const limitadorGlobalApi = criarLimitador({
  janelaMs: numeroDoAmbiente('RATE_LIMIT_JANELA_MIN', 15) * MINUTO_MS,
  limite: numeroDoAmbiente('RATE_LIMIT_MAX', 3000),
  pular: (req) => req.path.startsWith('/spedy-webhook'),
  mensagem: 'Este endereço fez requisições demais em pouco tempo. Aguarde alguns minutos e tente de novo.',
});

const limitadorPublico = (nome, { limite, janelaMs = 15 * MINUTO_MS, mensagem } = {}) => criarLimitador({
  janelaMs,
  limite,
  mensagem: mensagem || 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
});

const limitadorPorChave = (nome, chave, { limite, janelaMs = 15 * MINUTO_MS, mensagem } = {}) => criarLimitador({
  janelaMs,
  limite,
  chave,
  mensagem: mensagem || 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
});

/** Teto TOTAL da rota, somando todo mundo -- protege um provedor externo
 *  (Receita Federal, e-mail) de ser usado como proxy a partir daqui. */
const limitadorTotal = (nome, { limite, janelaMs = 60 * MINUTO_MS, mensagem } = {}) => criarLimitador({
  janelaMs,
  limite,
  chave: () => `total:${nome}`,
  mensagem: mensagem || 'Este serviço recebeu pedidos demais na última hora. Tente de novo mais tarde.',
});

module.exports = {
  limitadorGlobalApi,
  limitadorPublico,
  limitadorPorChave,
  limitadorTotal,
  criarLimitador,
  MINUTO_MS,
  MENSAGEM_PADRAO,
};
