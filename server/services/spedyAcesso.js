const { db } = require('../config/firebase');

/**
 * Acesso a Spedy compartilhado pelas rotas fiscais: URLs, quem pode usar o
 * modulo fiscal, de qual empresa e' a chamada e a chave/ambiente dela. Antes
 * morava dentro de routes/spedy.routes.js; foi separado pra as rotas novas
 * (devolucao de venda) usarem exatamente o mesmo codigo.
 */

const BASE_URLS = {
  sandbox: 'https://sandbox-api.spedy.com.br/v1',
  production: 'https://api.spedy.com.br/v1'
};

const canUseFiscal = (user, action = 'emit') => {
  if (!user) return false;
  if (user.isPlatformAdmin || user.isTenantManager) return true;
  const permissions = Array.isArray(user.permissoes) ? user.permissoes : [];
  return action === 'delete'
    ? permissions.includes('fiscal.excluir')
    : permissions.includes('fiscal.emitir');
};

const resolveTenantId = (req) => {
  const requestedTenantId = req.query.tenantId || req.body?.tenantId;
  if (req.user.isPlatformAdmin) return requestedTenantId || req.user.tenantId;
  return req.user.tenantId;
};

const loadSpedyConfig = async (tenantId) => {
  if (!tenantId) {
    const error = new Error('Tenant nao informado.');
    error.status = 400;
    throw error;
  }

  const [publicSnap, privateSnap] = await Promise.all([
    db.collection('configuracoes').doc(tenantId).get(),
    db.collection('configuracoes_privadas').doc(tenantId).get()
  ]);

  const publicConfig = publicSnap.exists ? publicSnap.data() : {};
  const privateConfig = privateSnap.exists ? privateSnap.data() : {};
  const apiKey = privateConfig.spedyApiKey || publicConfig.spedyApiKey;

  if (!publicConfig.spedyEnabled || !apiKey) {
    const error = new Error('Integracao Spedy nao configurada para esta empresa.');
    error.status = 400;
    throw error;
  }

  const env = publicConfig.spedyEnvironment === 'production' ? 'production' : 'sandbox';
  return {
    apiKey,
    env,
    baseUrl: BASE_URLS[env]
  };
};

module.exports = { BASE_URLS, canUseFiscal, resolveTenantId, loadSpedyConfig };
