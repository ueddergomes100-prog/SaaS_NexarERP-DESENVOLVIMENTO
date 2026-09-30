/**
 * Diagnostico das variaveis de ambiente -- so' PRESENCA, nunca o valor.
 *
 * Existe porque o incidente de 2026-08-27 (backend "online" com credencial
 * quebrada) e a chave de backup nunca configurada em producao so' foram
 * percebidos meses depois: nada dizia o que faltava. Agora o servidor loga
 * as pendencias ao subir e o /health as expoe (ver services/saude.js).
 *
 * Nunca derruba o processo por variavel faltando: uma API fora do ar por
 * causa de um aviso e' pior que a API no ar avisando.
 */

const presente = (env, nome) => Boolean(String(env[nome] || '').trim());

const emProducao = (env = process.env) => env.NODE_ENV === 'production';

/** Quantos proxies confiaveis existem na frente do Node (TRUST_PROXY_HOPS).
 *  1 = o padrao da hospedagem (um proxy que acrescenta o IP real). 0 = sem
 *  proxy (local). Confira no /health: `seuIp` tem que ser o seu IP publico. */
const trustProxyHops = (env = process.env) => {
  const valor = Number(env.TRUST_PROXY_HOPS);
  return Number.isInteger(valor) && valor >= 0 ? valor : 1;
};

const diagnosticoConfiguracao = (env = process.env) => ({
  ambiente: env.NODE_ENV || 'development',
  credencialFirebase: presente(env, 'FIREBASE_SERVICE_ACCOUNT_BASE64')
    || (presente(env, 'FIREBASE_CLIENT_EMAIL') && presente(env, 'FIREBASE_PRIVATE_KEY'))
    || presente(env, 'GOOGLE_APPLICATION_CREDENTIALS'),
  backupCriptografado: presente(env, 'BACKUP_ENCRYPTION_KEY'),
  onboardingSecret: presente(env, 'ONBOARDING_CODE_SECRET'),
  emailOnboarding: (presente(env, 'RESEND_API_KEY') || presente(env, 'SENDGRID_API_KEY')) && presente(env, 'EMAIL_FROM'),
  webhookSpedy: presente(env, 'SPEDY_WEBHOOK_SECRET'),
  corsRestrito: presente(env, 'CORS_ORIGINS'),
  proxyHops: trustProxyHops(env),
});

/** O que falta pra rodar em producao, em portugues, na ordem do que doi mais. */
const pendenciasDeProducao = (diagnostico) => {
  const pendencias = [];
  if (!diagnostico.credencialFirebase) pendencias.push('Credencial do Firebase Admin ausente (FIREBASE_SERVICE_ACCOUNT_BASE64): toda rota que toca o banco vai falhar.');
  if (!diagnostico.backupCriptografado) pendencias.push('BACKUP_ENCRYPTION_KEY ausente: todo backup falha em produção.');
  if (!diagnostico.onboardingSecret) pendencias.push('ONBOARDING_CODE_SECRET ausente: o cadastro de empresa nova falha.');
  if (!diagnostico.emailOnboarding) pendencias.push('E-mail do cadastro não configurado (RESEND_API_KEY ou SENDGRID_API_KEY + EMAIL_FROM): o código de verificação não é enviado.');
  if (!diagnostico.webhookSpedy) pendencias.push('SPEDY_WEBHOOK_SECRET ausente: o webhook da Spedy responde 404 e o status das notas só atualiza por consulta.');
  if (!diagnostico.corsRestrito) pendencias.push('CORS_ORIGINS ausente: só as origens padrão (localhost e *.web.app) são aceitas.');
  return pendencias;
};

module.exports = { diagnosticoConfiguracao, pendenciasDeProducao, trustProxyHops, emProducao };
