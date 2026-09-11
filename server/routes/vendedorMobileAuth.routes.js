const express = require('express');
const { admin, db } = require('../config/firebase');
const { onlyDigits } = require('../utils/cnpjLookup');
const { validarPin } = require('../services/vendedorPin');

const router = express.Router();

/**
 * Login do vendedor de balcao no aplicativo mobile do vendedor externo, com
 * o MESMO codigo + PIN que ele ja usa no balcao -- sem e-mail, sem conta
 * nova (decisao de produto: o vendedor de balcao nao tem login por design,
 * ver src/utils/vendedorCadastroDomain.ts).
 *
 * Rota PUBLICA (sem `authenticate`, diferente de vendedorPin.routes.js):
 * ninguem esta logado ainda quando isto e' chamado. A seguranca fica no
 * proprio `validarPin` (hash scrypt + bloqueio por tentativas, reaproveitado
 * sem alteracao) e no rate limit por IP abaixo, no mesmo padrao de
 * onboarding.routes.js.
 *
 * O tenant e' resolvido pelo indice `vendedores_mobile_login/{cnpj}-{codigo}`
 * (Firestore, so' o Admin SDK le -- ver firestore.rules), escrito pelo
 * frontend quando o admin liga "Usa o aplicativo mobile" em VendedoresList.tsx.
 * Isto substitui o token de autenticacao que a rota /validar normal usa pra
 * saber o tenantId de quem chamou.
 */

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateLimitBuckets = new Map();

const getRequestIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || '').split(',')[0].trim();

  return (rawIp || req.socket.remoteAddress || req.ip || '')
    .replace(/^::ffff:/, '')
    .replace(/^::1$/, '127.0.0.1');
};

const checkRateLimit = (key) => {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (bucket.count > RATE_LIMIT_MAX) {
    const error = new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    error.status = 429;
    throw error;
  }
};

/** Mesma normalizacao de src/utils/vendedorPinDomain.ts (normalizarCodigoVendedor):
 *  "7" e "07" sao o mesmo vendedor. Precisa bater com a chave que o frontend
 *  grava em vendedores_mobile_login, senao o login nunca acha o indice. */
const CODIGO_DIGITOS = 2;
const normalizarCodigo = (valor) => {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (!digitos || digitos.length > CODIGO_DIGITOS) return '';
  return digitos.padStart(CODIGO_DIGITOS, '0');
};

const responderErro = (res, erro, contexto) => {
  if (erro && typeof erro.status === 'number') {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[VendedorMobileAuth] ${contexto}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
};

router.post('/mobile-login', async (req, res) => {
  try {
    checkRateLimit(`mobile-login:${getRequestIp(req)}`);

    if (!db || !admin) {
      const erro = new Error('Backend sem acesso ao Firebase.');
      erro.status = 503;
      throw erro;
    }

    const cnpj = onlyDigits(req.body?.cnpj);
    const codigo = normalizarCodigo(req.body?.codigo);
    if (!cnpj || !codigo) {
      const erro = new Error('Informe o CNPJ da empresa e o código do vendedor.');
      erro.status = 400;
      throw erro;
    }

    const chave = `${cnpj}-${codigo}`;
    const indiceSnap = await db.collection('vendedores_mobile_login').doc(chave).get();
    if (!indiceSnap.exists) {
      const erro = new Error('Empresa ou código não encontrados, ou este vendedor não tem o aplicativo mobile liberado. Confira os dados ou peça pro administrador liberar em Vendedores.');
      erro.status = 404;
      throw erro;
    }

    const { tenantId } = indiceSnap.data();

    // validarPin ja confere hash, status Ativo e bloqueio por tentativas --
    // reaproveitado sem nenhuma alteracao.
    const identificado = await validarPin({ tenantId, codigo, pin: req.body?.pin });

    // Defesa extra: confere no proprio cadastro que o acesso mobile
    // continua ligado, caso o indice esteja desatualizado.
    const usuarioSnap = await db.collection('usuarios').doc(identificado.vendedorId).get();
    if (!usuarioSnap.exists || usuarioSnap.data().acessoAppMobile !== true) {
      const erro = new Error('Este vendedor não tem o aplicativo mobile liberado. Peça pro administrador liberar em Vendedores.');
      erro.status = 403;
      throw erro;
    }

    const token = await admin.auth().createCustomToken(identificado.vendedorId, { isVendedorBalcao: true });
    return res.json({ token, vendedorNome: identificado.vendedorNome });
  } catch (erro) {
    return responderErro(res, erro, 'mobile-login');
  }
});

module.exports = router;
