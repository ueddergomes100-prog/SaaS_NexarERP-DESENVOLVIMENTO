const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { db } = require('../config/firebase');

// Cadastro de empresa+certificado na Spedy, pelo admin da PLATAFORMA (nao
// do tenant) -- automatiza o que hoje e feito na mao (pedir a chave pro
// consultor da Spedy e colar em Configuracoes). Documentacao usada:
// https://docs.spedy.com.br/api-reference/empresas/criar-empresa
// https://docs.spedy.com.br/api-reference/empresas/adicionar-certificado
// (2026-09-09, endpoints confirmados com o consultor Claudionor da Spedy).

const BASE_URLS = {
  sandbox: 'https://sandbox-api.spedy.com.br/v1',
  production: 'https://api.spedy.com.br/v1',
};

// Regime tributario do Hennder (src/utils/fiscalDomain.ts) -> TaxRegime da
// Spedy. So simples_nacional tem equivalente direto; lucro_presumido e
// lucro_real caem em "regimeNormal" (aproximacao -- a Spedy nao distingue
// os dois na criacao da empresa, so no calculo de imposto por nota).
const TAX_REGIME_MAP = {
  simples_nacional: 'simplesNacional',
  lucro_presumido: 'regimeNormal',
  lucro_real: 'regimeNormal',
};

const requirePlatformAdmin = (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    res.status(403).json({ error: 'Acesso negado. Apenas administradores da plataforma podem gerenciar o cadastro de empresas na Spedy.' });
    return false;
  }
  return true;
};

const loadMasterApiKey = async (environment) => {
  const snap = await db.collection('plataforma').doc('spedy').get();
  const data = snap.exists ? snap.data() : {};
  const key = environment === 'production' ? data.masterApiKeyProducao : data.masterApiKeySandbox;
  if (!key) {
    const error = new Error(`Chave mestra da Spedy (${environment === 'production' ? 'produção' : 'sandbox'}) ainda não foi configurada.`);
    error.status = 400;
    throw error;
  }
  return key;
};

const spedyErrorMessage = async (response, fallback) => {
  const data = await response.json().catch(() => ({}));
  return data.errors?.[0]?.message || data.error || data.title || fallback;
};

/** Monta o corpo de criacao de empresa a partir do que ja esta salvo em
 * configuracoes/{tenantId} -- nao pede nada de novo pro admin da
 * plataforma alem do CNPJ da empresa (que ja esta la). Endereco e cidade
 * IBGE reaproveitam os mesmos campos que a tela de Configuracoes do
 * tenant ja preenche pra NFS-e (nfseCidadeCodigo/Nome/Estado). */
// O elemento <IE> da NFe (tipo TIe do schema da Sefaz) so aceita digitos --
// achado ao vivo (2026-09-11): "002131194.00-14" (formato que o usuario
// digitou em Configuracoes) foi rejeitado com "The Pattern constraint
// failed". "ISENTO" (texto livre no campo, convencao ja usada na tela pra
// empresa sem IE) fica de fora dessa limpeza -- so os numeros/pontuacao
// digitados por engano no meio de uma IE numerica sao removidos.
const sanitizarInscricaoEstadual = (valor) => {
  const raw = String(valor || '').trim();
  if (!raw) return '';
  if (/^isento$/i.test(raw)) return raw.toUpperCase();
  return raw.replace(/\D/g, '');
};

const buildCompanyPayload = (config) => {
  const nome = String(config.nomeOficina || '').trim();
  const cnpj = String(config.cnpj || '').replace(/\D/g, '');
  const inscricaoEstadual = sanitizarInscricaoEstadual(config.inscricaoEstadual);

  return {
    name: nome,
    legalName: nome,
    federalTaxNumber: cnpj,
    ...(inscricaoEstadual ? { stateTaxNumber: inscricaoEstadual } : {}),
    ...(config.email ? { email: String(config.email).trim() } : {}),
    // Campo "phone" DESLIGADO de proposito (2026-09-11). A doc da Spedy so
    // diz "string, max 15 caracteres" -- sem regex nem exemplo. Ja testamos
    // formatado ("(27) 3735-5002") e so digitos ("27373550028"), os dois
    // deram "The field Phone is invalid". Telefone e opcional no cadastro
    // de empresa, entao ficou de fora ate confirmar o formato certo com o
    // suporte da Spedy -- nao vale travar o cadastro chutando de novo.
    // Reativar preenchendo aqui quando o formato for confirmado.
    address: {
      ...(config.rua || config.endereco ? { street: String(config.rua || config.endereco).trim() } : {}),
      ...(config.numero ? { number: String(config.numero).trim() } : {}),
      ...(config.bairro ? { district: String(config.bairro).trim() } : {}),
      ...(config.cep ? { postalCode: String(config.cep).replace(/\D/g, '') } : {}),
      ...(config.nfseCidadeCodigo ? {
        city: {
          code: config.nfseCidadeCodigo,
          name: config.nfseCidadeNome || undefined,
          state: (config.nfseCidadeEstado || '').toLowerCase() || undefined,
        },
      } : {}),
    },
    taxRegime: TAX_REGIME_MAP[config.regimeTributario] || 'simplesNacional',
  };
};

router.use(authenticate);

/** GET /master-key -- nunca devolve a chave em si, so se esta configurada,
 * pra tela poder mostrar "configurada"/"nao configurada" sem expor o
 * segredo pro navegador sem necessidade. */
router.get('/master-key', async (req, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const snap = await db.collection('plataforma').doc('spedy').get();
    const data = snap.exists ? snap.data() : {};
    return res.json({
      sandboxConfigured: Boolean(data.masterApiKeySandbox),
      productionConfigured: Boolean(data.masterApiKeyProducao),
    });
  } catch (error) {
    console.error('[Spedy Master Key]', error);
    return res.status(500).json({ error: 'Erro ao carregar a chave mestra da Spedy.' });
  }
});

router.post('/master-key', async (req, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { environment, apiKey } = req.body;
    if (environment !== 'sandbox' && environment !== 'production') {
      return res.status(400).json({ error: 'Ambiente inválido -- use "sandbox" ou "production".' });
    }
    const trimmedKey = String(apiKey || '').trim();
    if (!trimmedKey) {
      return res.status(400).json({ error: 'Informe a chave mestra antes de salvar.' });
    }

    const field = environment === 'production' ? 'masterApiKeyProducao' : 'masterApiKeySandbox';
    await db.collection('plataforma').doc('spedy').set({
      [field]: trimmedKey,
      atualizadoPor: req.user.uid,
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });

    return res.json({ success: true });
  } catch (error) {
    console.error('[Spedy Master Key Save]', error);
    return res.status(500).json({ error: 'Erro ao salvar a chave mestra da Spedy.' });
  }
});

/** POST /companies -- cria a empresa do tenant na Spedy usando a chave
 * mestra, e ja grava a chave exclusiva devolvida direto em
 * configuracoes_privadas/{tenantId}.spedyApiKey (mesmo campo que a tela de
 * Configuracoes do tenant le/edita manualmente hoje) -- do ponto de vista
 * do tenant, o resultado e identico a colar a chave na mao. */
router.post('/companies', async (req, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { tenantId, environment } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'Informe o tenant.' });
    if (environment !== 'sandbox' && environment !== 'production') {
      return res.status(400).json({ error: 'Ambiente inválido -- use "sandbox" ou "production".' });
    }

    const configSnap = await db.collection('configuracoes').doc(tenantId).get();
    if (!configSnap.exists) {
      return res.status(404).json({ error: 'Configurações desta empresa não foram encontradas.' });
    }
    const config = configSnap.data();
    if (!config.cnpj || String(config.cnpj).replace(/\D/g, '').length !== 14) {
      return res.status(400).json({ error: 'Esta empresa não tem um CNPJ válido cadastrado em Configurações. Cadastre o CNPJ antes de continuar.' });
    }
    // A Spedy exige cidade (codigo IBGE) no endereco pra cadastrar a
    // empresa, mesmo a AddressDto marcando o campo como opcional na doc --
    // sem isso ela devolve "A cidade é obrigatória", que não diz pro admin
    // ONDE resolver. nfseCidadeCodigo so existe depois que alguem busca e
    // seleciona a cidade na aba Nota Fiscal (Spedy) de Configuracoes.
    if (!config.nfseCidadeCodigo) {
      return res.status(400).json({ error: 'Esta empresa não tem cidade cadastrada para a Spedy. Vá em Configurações → Nota Fiscal (Spedy), busque e selecione a cidade antes de cadastrar a empresa.' });
    }

    const masterApiKey = await loadMasterApiKey(environment);
    const payload = buildCompanyPayload(config);

    const response = await fetch(`${BASE_URLS[environment]}/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': masterApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await spedyErrorMessage(response, 'Erro ao cadastrar a empresa na Spedy.');
      return res.status(response.status).json({ error: message });
    }

    const data = await response.json();
    const company = data.result || data;
    const spedyApiKey = company.apiCredentials?.apiKey;
    if (!spedyApiKey || !company.id) {
      return res.status(502).json({ error: 'A Spedy não devolveu a chave da empresa criada. Confira o cadastro no painel deles antes de tentar de novo.' });
    }

    const timestamp = new Date().toISOString();
    await Promise.all([
      db.collection('configuracoes_privadas').doc(tenantId).set({
        spedyApiKey,
        tenantId,
        atualizadoPor: req.user.uid,
        atualizadoEm: timestamp,
      }, { merge: true }),
      db.collection('configuracoes').doc(tenantId).set({
        spedyEnabled: true,
        spedyEnvironment: environment,
        spedyApiKeyConfigured: true,
        spedyCompanyId: company.id,
        atualizadoPor: req.user.uid,
        atualizadoEm: timestamp,
      }, { merge: true }),
    ]);

    return res.json({ companyId: company.id, environment });
  } catch (error) {
    console.error('[Spedy Company Create]', error);
    return res.status(error.status || 500).json({ error: error.message || 'Erro interno ao cadastrar empresa na Spedy.' });
  }
});

/** PUT /companies/:tenantId/settings (nosso path interno) -- reenvia os
 * dados atuais de Configuracoes pra empresa JA cadastrada na Spedy.
 * Criado porque nao existia forma de corrigir a Spedy depois do cadastro
 * inicial -- descoberto ao vivo quando uma empresa cadastrada sem
 * Inscricao Estadual preenchida gerou rejeicao SPD003 na hora de emitir
 * (schema da NFe exige IE no bloco do emitente, mesmo cadastro de
 * empresa aceitando sem).
 *
 * Bug ja corrigido uma vez e ainda errado (2026-09-11): o fetch chamava
 * PUT /v1/companies/{id}/settings da Spedy, que e' o endpoint de
 * CONFIGURACAO DE EMISSAO (serie/numeracao/ambiente/CSC -- ver
 * PUT /numbering em spedy.routes.js, esse sim usa /settings
 * corretamente), nao o de dados cadastrais. Por isso a chamada
 * retornava sucesso mas a IE nunca era atualizada de verdade -- a Spedy
 * so ignorava os campos que nao pertencem aquele endpoint. O endpoint
 * certo pra editar CNPJ/endereco/regime/IE e' PUT /v1/companies/{id}
 * (sem o /settings), confirmado via openapi/v1.json. */
router.put('/companies/:tenantId/settings', async (req, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { tenantId } = req.params;
    const { environment } = req.body;
    if (environment !== 'sandbox' && environment !== 'production') {
      return res.status(400).json({ error: 'Ambiente inválido -- use "sandbox" ou "production".' });
    }

    const configSnap = await db.collection('configuracoes').doc(tenantId).get();
    if (!configSnap.exists) {
      return res.status(404).json({ error: 'Configurações desta empresa não foram encontradas.' });
    }
    const config = configSnap.data();
    const companyId = config.spedyCompanyId;
    if (!companyId) {
      return res.status(400).json({ error: 'Esta empresa ainda não foi cadastrada na Spedy. Cadastre a empresa antes de atualizar os dados.' });
    }

    const masterApiKey = await loadMasterApiKey(environment);
    const payload = buildCompanyPayload(config);

    const response = await fetch(`${BASE_URLS[environment]}/companies/${companyId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': masterApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await spedyErrorMessage(response, 'Erro ao atualizar os dados da empresa na Spedy.');
      return res.status(response.status).json({ error: message });
    }

    await db.collection('configuracoes').doc(tenantId).set({
      atualizadoPor: req.user.uid,
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });

    return res.json({ companyId, environment });
  } catch (error) {
    console.error('[Spedy Company Update]', error);
    return res.status(error.status || 500).json({ error: error.message || 'Erro interno ao atualizar empresa na Spedy.' });
  }
});

/** POST /companies/:tenantId/certificate -- recebe o .pfx em base64 (o
 * navegador nao tem FormData nativo pra arquivo binario grande sem
 * complicar o front, entao o certificado chega em JSON como base64 e so
 * vira multipart/form-data aqui, na chamada de verdade pra Spedy, que e
 * quem exige esse formato). */
router.post('/companies/:tenantId/certificate', async (req, res) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { tenantId } = req.params;
    const { certificadoBase64, certificadoSenha, environment } = req.body;
    if (environment !== 'sandbox' && environment !== 'production') {
      return res.status(400).json({ error: 'Ambiente inválido -- use "sandbox" ou "production".' });
    }
    if (!certificadoBase64) return res.status(400).json({ error: 'Selecione o arquivo do certificado (.pfx) antes de enviar.' });
    if (!certificadoSenha) return res.status(400).json({ error: 'Informe a senha do certificado digital.' });

    const configSnap = await db.collection('configuracoes').doc(tenantId).get();
    const companyId = configSnap.exists ? configSnap.data().spedyCompanyId : null;
    if (!companyId) {
      return res.status(400).json({ error: 'Esta empresa ainda não foi cadastrada na Spedy. Cadastre a empresa antes de enviar o certificado.' });
    }

    const masterApiKey = await loadMasterApiKey(environment);
    const certificateBuffer = Buffer.from(certificadoBase64, 'base64');
    const form = new FormData();
    form.append('certificateFile', new Blob([certificateBuffer]), 'certificado.pfx');
    form.append('password', certificadoSenha);

    const response = await fetch(`${BASE_URLS[environment]}/companies/${companyId}/certificates`, {
      method: 'POST',
      headers: { 'X-Api-Key': masterApiKey },
      body: form,
    });

    if (!response.ok) {
      const message = await spedyErrorMessage(response, 'Erro ao enviar o certificado digital para a Spedy.');
      return res.status(response.status).json({ error: message });
    }

    const certificate = await response.json();
    await db.collection('configuracoes').doc(tenantId).set({
      spedyCertificadoValidade: certificate.expirationAt || null,
      spedyCertificadoStatus: certificate.isActive ? 'ativo' : 'inativo',
      atualizadoPor: req.user.uid,
      atualizadoEm: new Date().toISOString(),
    }, { merge: true });

    return res.json(certificate);
  } catch (error) {
    console.error('[Spedy Certificate Upload]', error);
    return res.status(error.status || 500).json({ error: error.message || 'Erro interno ao enviar certificado digital.' });
  }
});

module.exports = router;
