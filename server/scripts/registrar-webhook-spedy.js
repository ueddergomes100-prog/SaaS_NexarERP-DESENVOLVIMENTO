/*
 * REGISTRA O WEBHOOK DA SPEDY (status da nota em tempo real).
 *
 * Hoje o status das notas e' atualizado por consulta (polling). Com o webhook
 * `invoice.status_changed` registrado na Spedy, a rejeicao/autorizacao chega
 * na hora em POST /api/spedy-webhook/<SPEDY_WEBHOOK_SECRET> (ver
 * server/routes/spedyWebhook.routes.js). Uma conta Spedy so', com todos os
 * CNPJs dentro: um webhook cobre todas as empresas.
 *
 * A CHAVE DA SPEDY NUNCA ENTRA NO CODIGO NEM NO CHAT: passe pela variavel de
 * ambiente na hora de rodar. Rode da pasta `server`:
 *
 *   # listar os webhooks que ja existem
 *   SPEDY_API_KEY=xxxx node scripts/registrar-webhook-spedy.js --listar
 *
 *   # registrar (producao). SPEDY_WEBHOOK_SECRET vem do server/.env ou do ambiente.
 *   SPEDY_API_KEY=xxxx node scripts/registrar-webhook-spedy.js --registrar
 *
 *   # sandbox:  --ambiente sandbox      outra URL publica:  --url https://...
 *
 * No PowerShell: $env:SPEDY_API_KEY="xxxx"; node scripts/registrar-webhook-spedy.js --listar
 *
 * Campos do corpo (url, events) seguem a documentacao da Spedy
 * (https://docs.spedy.com.br). O script imprime a resposta inteira: se a API
 * recusar algum campo, a mensagem dela aparece aqui para ajustar.
 */
require('dotenv').config();
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');

const BASE_URLS = {
  sandbox: 'https://sandbox-api.spedy.com.br/v1',
  production: 'https://api.spedy.com.br/v1',
};

const args = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
};

const apiKey = (process.env.SPEDY_API_KEY || '').trim();
const ambiente = opcao('--ambiente', 'production') === 'sandbox' ? 'sandbox' : 'production';
const secret = (process.env.SPEDY_WEBHOOK_SECRET || '').trim();
const urlPublica = opcao('--url', 'https://api.nexarcompany.com.br');

const sair = (mensagem) => { console.error(mensagem); process.exit(1); };

if (!apiKey) sair('Informe a chave da Spedy na variável SPEDY_API_KEY (não cole no código).');

const chamar = async (metodo, caminho, corpo) => {
  const resposta = await fetchComTimeout(`${BASE_URLS[ambiente]}${caminho}`, {
    method: metodo,
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  }, PERFIS.spedyLeitura);
  const texto = await resposta.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: resposta.status, dados };
};

(async () => {
  if (args.includes('--listar')) {
    const r = await chamar('GET', '/webhooks');
    console.log(`GET /webhooks (${ambiente}) -> ${r.status}`);
    console.log(JSON.stringify(r.dados, null, 2));
    return;
  }
  if (args.includes('--registrar')) {
    if (!secret) sair('SPEDY_WEBHOOK_SECRET não está definido (server/.env ou ambiente). Use o MESMO valor que está na Hostinger.');
    const url = `${urlPublica.replace(/\/$/, '')}/api/spedy-webhook/${secret}`;
    console.log(`Registrando webhook (${ambiente}) para: ${url.replace(secret, secret.slice(0, 4) + '…')}`);
    const r = await chamar('POST', '/webhooks', { url, events: ['invoice.status_changed'] });
    console.log(`POST /webhooks -> ${r.status}`);
    console.log(JSON.stringify(r.dados, null, 2));
    if (r.status >= 200 && r.status < 300) {
      console.log('\nPronto. Emita uma nota de teste e confira no log da Hostinger: [req] POST /api/spedy-webhook/... 200');
    }
    return;
  }
  console.log('Use --listar ou --registrar (opções: --ambiente sandbox|production, --url https://...).');
})().catch((erro) => sair(`Falhou: ${erro.message}`));
