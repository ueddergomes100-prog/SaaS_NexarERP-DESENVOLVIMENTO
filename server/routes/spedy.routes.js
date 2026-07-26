const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { db } = require('../config/firebase');

const BASE_URLS = {
  sandbox: 'https://sandbox-api.spedy.com.br/v1',
  production: 'https://api.spedy.com.br/v1'
};

const TYPE_PATHS = {
  service: 'service-invoices',
  product: 'product-invoices',
  consumer: 'consumer-invoices'
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

const proxyJson = async (res, response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return res.status(response.status).json({
      error: data.errors?.[0]?.message || data.error || 'Erro ao comunicar com a Spedy.'
    });
  }

  return res.json(data);
};

const handleSpedyRequest = async (req, res, method, action) => {
  try {
    if (!canUseFiscal(req.user, method === 'DELETE' ? 'delete' : 'emit')) {
      return res.status(403).json({ error: 'Acesso negado ao modulo fiscal.' });
    }

    const tenantId = resolveTenantId(req);
    const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);
    const typePath = TYPE_PATHS[req.params.type];

    if (!typePath) {
      return res.status(400).json({ error: 'Tipo de documento fiscal invalido.' });
    }

    const response = await action({ tenantId, apiKey, baseUrl, typePath });
    return proxyJson(res, response);
  } catch (error) {
    console.error('[Spedy Proxy]', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Erro interno ao processar integracao fiscal.'
    });
  }
};

router.use(authenticate);

router.get('/config', async (req, res) => {
  try {
    if (!canUseFiscal(req.user)) {
      return res.status(403).json({ error: 'Acesso negado ao modulo fiscal.' });
    }

    const tenantId = resolveTenantId(req);
    const [publicSnap, privateSnap] = await Promise.all([
      db.collection('configuracoes').doc(tenantId).get(),
      db.collection('configuracoes_privadas').doc(tenantId).get()
    ]);
    const publicConfig = publicSnap.exists ? publicSnap.data() : {};
    const privateConfig = privateSnap.exists ? privateSnap.data() : {};

    return res.json({
      spedyEnabled: publicConfig.spedyEnabled === true,
      spedyApiKeyConfigured: Boolean(privateConfig.spedyApiKey || publicConfig.spedyApiKey),
      spedyEnvironment: publicConfig.spedyEnvironment === 'production' ? 'production' : 'sandbox'
    });
  } catch (error) {
    console.error('[Spedy Config]', error);
    return res.status(500).json({ error: 'Erro ao carregar configuracao fiscal.' });
  }
});

router.get('/:type', (req, res) => handleSpedyRequest(req, res, 'GET', ({ apiKey, baseUrl, typePath }) => {
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 20);
  return fetch(`${baseUrl}/${typePath}?page=${page}&pageSize=${pageSize}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey }
  });
}));

router.get('/:type/:id', (req, res) => handleSpedyRequest(req, res, 'GET', ({ apiKey, baseUrl, typePath }) => {
  return fetch(`${baseUrl}/${typePath}/${req.params.id}`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey }
  });
}));

router.post('/:type', (req, res) => handleSpedyRequest(req, res, 'POST', ({ apiKey, baseUrl, typePath }) => {
  return fetch(`${baseUrl}/${typePath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey
    },
    body: JSON.stringify(req.body.invoiceData || req.body)
  });
}));

router.delete('/:type/:id', (req, res) => handleSpedyRequest(req, res, 'DELETE', ({ apiKey, baseUrl, typePath }) => {
  return fetch(`${baseUrl}/${typePath}/${req.params.id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey
    },
    body: JSON.stringify({ justification: req.body.justification })
  });
}));

router.get('/:type/:id/:fileType', async (req, res) => {
  try {
    if (!canUseFiscal(req.user)) {
      return res.status(403).json({ error: 'Acesso negado ao modulo fiscal.' });
    }

    const typePath = TYPE_PATHS[req.params.type];
    if (!typePath || !['pdf', 'xml'].includes(req.params.fileType)) {
      return res.status(400).json({ error: 'Arquivo fiscal invalido.' });
    }

    const tenantId = resolveTenantId(req);
    const { apiKey, baseUrl } = await loadSpedyConfig(tenantId);
    const response = await fetch(`${baseUrl}/${typePath}/${req.params.id}/${req.params.fileType}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: data.errors?.[0]?.message || 'Erro ao baixar arquivo fiscal.'
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const isPdf = req.params.fileType === 'pdf';
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'application/xml');
    res.setHeader('Content-Disposition', `${isPdf ? 'inline' : 'attachment'}; filename="${req.params.id}.${req.params.fileType}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('[Spedy File Proxy]', error);
    return res.status(error.status || 500).json({
      error: error.message || 'Erro interno ao baixar arquivo fiscal.'
    });
  }
});

module.exports = router;
