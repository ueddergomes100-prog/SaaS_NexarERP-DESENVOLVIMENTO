const express = require('express');
const crypto = require('crypto');
const { admin, auth, db } = require('../config/firebase');

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const ONBOARDING_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 30;
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

const requireFirebaseAdmin = () => {
  if (!admin || !auth || !db) {
    const error = new Error('Firebase Admin SDK nao configurado no backend.');
    error.status = 503;
    throw error;
  }
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

const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const isValidCnpj = (cnpj) => {
  const clean = onlyDigits(cnpj);
  if (clean.length !== 14 || /^(\d)\1+$/.test(clean)) return false;

  const calcDigit = (base, weights) => {
    const sum = weights.reduce((acc, weight, index) => acc + Number(base[index]) * weight, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const digit1 = calcDigit(clean.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digit2 = calcDigit(clean.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digit1 === Number(clean[12]) && digit2 === Number(clean[13]);
};

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

const normalizePhone = (phone = '') => {
  const digits = onlyDigits(phone);
  if (!digits) return '';

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  if (String(phone).trim().startsWith('+')) {
    return `+${digits}`;
  }

  return '';
};

const maskEmail = (email) => {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user.slice(0, 2)}***@${domain}`;
};

const maskPhone = (phone) => {
  const digits = onlyDigits(phone);
  if (digits.length < 4) return phone;
  return `+${digits.slice(0, 2)} ** *****-${digits.slice(-4)}`;
};

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getCodeSecret = () => {
  if (process.env.ONBOARDING_CODE_SECRET) {
    return process.env.ONBOARDING_CODE_SECRET;
  }

  if (process.env.NODE_ENV === 'production') {
    const error = new Error('ONBOARDING_CODE_SECRET deve ser configurado em producao.');
    error.status = 500;
    throw error;
  }

  return process.env.FIREBASE_PROJECT_ID || 'sistema-nexus-dev';
};

const generateCode = () => String(crypto.randomInt(100000, 1000000));

const hashCode = (onboardingId, type, code) => {
  return crypto
    .createHmac('sha256', getCodeSecret())
    .update(`${onboardingId}:${type}:${String(code).trim()}`)
    .digest('hex');
};

const assertPasswordPolicy = (password = '') => {
  if (password.length < 8) {
    return 'A senha deve ter pelo menos 8 caracteres.';
  }
  if (!/[a-z]/.test(password)) {
    return 'A senha precisa conter pelo menos uma letra minuscula.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'A senha precisa conter pelo menos uma letra maiuscula.';
  }
  if (!/\d/.test(password)) {
    return 'A senha precisa conter pelo menos um numero.';
  }
  return null;
};

const timestampFromMillis = (millis) => admin.firestore.Timestamp.fromDate(new Date(millis));

const parseBrasilApiCnpj = (data, cnpj) => {
  const statusCode = String(data.situacao_cadastral || '').trim();
  const statusDescription = String(data.descricao_situacao_cadastral || '').trim().toUpperCase();
  const isActive = statusCode === '2' || statusDescription === 'ATIVA';

  return {
    cnpj,
    razaoSocial: data.razao_social || '',
    nomeFantasia: data.nome_fantasia || '',
    situacao: statusDescription || statusCode || 'NAO_INFORMADA',
    ativo: isActive,
    abertura: data.data_inicio_atividade || '',
    municipio: data.municipio || '',
    uf: data.uf || '',
    cep: onlyDigits(data.cep || ''),
    logradouro: data.logradouro || '',
    numero: data.numero || '',
    bairro: data.bairro || '',
    telefone: [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean).join(' / '),
    email: data.email || '',
    provider: 'brasilapi'
  };
};

const fetchCnpjData = async (cnpj) => {
  const provider = (process.env.CNPJ_PROVIDER || 'brasilapi').toLowerCase();

  if (provider === 'serpro') {
    const baseUrl = process.env.SERPRO_CNPJ_BASE_URL;
    const bearerToken = process.env.SERPRO_CNPJ_BEARER_TOKEN;

    if (!baseUrl || !bearerToken) {
      const error = new Error('Consulta CNPJ Serpro nao configurada no backend.');
      error.status = 500;
      throw error;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${cnpj}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'CNPJ nao encontrado na Receita Federal.');
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }

    const situacao = String(data.situacaoCadastral || data.situacao || '').toUpperCase();
    return {
      cnpj,
      razaoSocial: data.nomeEmpresarial || data.razaoSocial || '',
      nomeFantasia: data.nomeFantasia || '',
      situacao,
      ativo: situacao === 'ATIVA' || situacao === '2',
      abertura: data.dataAbertura || data.dataInicioAtividade || '',
      municipio: data.municipio || data.endereco?.municipio || '',
      uf: data.uf || data.endereco?.uf || '',
      cep: onlyDigits(data.cep || data.endereco?.cep || ''),
      logradouro: data.logradouro || data.endereco?.logradouro || '',
      numero: data.numero || data.endereco?.numero || '',
      bairro: data.bairro || data.endereco?.bairro || '',
      telefone: data.telefone || '',
      email: data.email || '',
      provider: 'serpro'
    };
  }

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'User-Agent': 'NexarERP-Onboarding/1.0 (+https://nexar-erp.local)'
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || 'CNPJ nao encontrado.');
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }

  return parseBrasilApiCnpj(data, cnpj);
};

const validateCnpjForOnboarding = async (cnpjInput) => {
  const cnpj = onlyDigits(cnpjInput);

  if (!isValidCnpj(cnpj)) {
    const error = new Error('CNPJ invalido.');
    error.status = 400;
    throw error;
  }

  const [registrySnap, usersSnap] = await Promise.all([
    db.collection('cnpjs_cadastrados').doc(cnpj).get(),
    db.collection('usuarios').where('cnpj', '==', cnpj).limit(1).get()
  ]);

  if (registrySnap.exists || !usersSnap.empty) {
    const error = new Error('Este CNPJ ja esta cadastrado no SaaS.');
    error.status = 409;
    throw error;
  }

  const cnpjData = await fetchCnpjData(cnpj);
  if (!cnpjData.ativo) {
    const error = new Error(`CNPJ encontrado, mas a situacao cadastral nao esta ativa (${cnpjData.situacao}).`);
    error.status = 422;
    throw error;
  }

  return cnpjData;
};

const sendEmailCode = async ({ email, code, companyName }) => {
  const subject = 'Codigo de verificacao Nexar ERP';
  const text = `Seu codigo de verificacao Nexar ERP para ${companyName} e: ${code}. Ele expira em 10 minutos.`;
  const safeCompanyName = escapeHtml(companyName);
  const safeCode = escapeHtml(code);
  const html = `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      <h2>Confirme seu e-mail</h2>
      <p>Use o codigo abaixo para continuar o cadastro da empresa <strong>${safeCompanyName}</strong>.</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0;">${safeCode}</div>
      <p>Este codigo expira em 10 minutos. Se voce nao solicitou este cadastro, ignore esta mensagem.</p>
    </div>
  `;

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: email,
        subject,
        html,
        text
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Nao foi possivel enviar o codigo por e-mail.');
    }
    return { delivered: true };
  }

  if (process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: process.env.EMAIL_FROM },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html }
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Nao foi possivel enviar o codigo por e-mail.');
    }
    return { delivered: true };
  }

  if (process.env.ONBOARDING_DEV_CODES === 'true' && process.env.NODE_ENV !== 'production') {
    console.warn(`[Onboarding DEV] Codigo de e-mail para ${email}: ${code}`);
    return { delivered: false, devCode: code };
  }

  const error = new Error('Servico de e-mail nao configurado.');
  error.status = 503;
  throw error;
};

const sendPhoneCode = async ({ phone, code, companyName }) => {
  const message = `Nexar ERP: seu codigo para validar ${companyName} e ${code}. Expira em 10 minutos.`;

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE) {
    const credentials = Buffer
      .from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`)
      .toString('base64');

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: process.env.TWILIO_FROM_PHONE,
          To: phone,
          Body: message
        })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || 'Nao foi possivel enviar o codigo por SMS.');
    }
    return { delivered: true };
  }

  if (process.env.ONBOARDING_DEV_CODES === 'true' && process.env.NODE_ENV !== 'production') {
    console.warn(`[Onboarding DEV] Codigo de telefone para ${phone}: ${code}`);
    return { delivered: false, devCode: code };
  }

  const error = new Error('Servico de SMS/telefone nao configurado.');
  error.status = 503;
  throw error;
};

const loadPending = async (onboardingId) => {
  if (!onboardingId || typeof onboardingId !== 'string') {
    const error = new Error('Cadastro pendente invalido.');
    error.status = 400;
    throw error;
  }

  const ref = db.collection('onboarding_pendentes').doc(onboardingId);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error('Cadastro pendente nao encontrado.');
    error.status = 404;
    throw error;
  }

  const data = snap.data();
  if (data.expiresAt?.toMillis && data.expiresAt.toMillis() < Date.now()) {
    const error = new Error('Este cadastro expirou. Inicie novamente.');
    error.status = 410;
    throw error;
  }

  if (data.status === 'completed') {
    const error = new Error('Este cadastro ja foi finalizado.');
    error.status = 409;
    throw error;
  }

  return { ref, data };
};

const publicCnpjData = (cnpjData) => ({
  cnpj: cnpjData.cnpj,
  razaoSocial: cnpjData.razaoSocial,
  nomeFantasia: cnpjData.nomeFantasia,
  situacao: cnpjData.situacao,
  municipio: cnpjData.municipio,
  uf: cnpjData.uf,
  provider: cnpjData.provider
});

router.post('/validate-cnpj', async (req, res) => {
  try {
    requireFirebaseAdmin();
    checkRateLimit(`cnpj:${getRequestIp(req)}`);

    const cnpjData = await validateCnpjForOnboarding(req.body?.cnpj);
    return res.json({
      ok: true,
      cnpj: publicCnpjData(cnpjData)
    });
  } catch (error) {
    console.error('[Onboarding validate-cnpj]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao validar CNPJ.' });
  }
});

router.post('/start', async (req, res) => {
  let pendingRef = null;

  try {
    requireFirebaseAdmin();
    checkRateLimit(`start:${getRequestIp(req)}`);

    const email = normalizeEmail(req.body?.email);
    const telefone = normalizePhone(req.body?.telefone);
    const nomeResponsavel = String(req.body?.nomeResponsavel || '').trim();
    const nomeOficinaInput = String(req.body?.nomeOficina || '').trim();

    if (!nomeResponsavel || nomeResponsavel.length < 3) {
      return res.status(400).json({ error: 'Informe o nome do responsavel.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Informe um e-mail valido.' });
    }
    if (!telefone) {
      return res.status(400).json({ error: 'Informe um telefone celular valido com DDD.' });
    }

    const [emailUser, phoneUser] = await Promise.all([
      auth.getUserByEmail(email).catch(() => null),
      auth.getUserByPhoneNumber(telefone).catch(() => null)
    ]);
    if (emailUser) {
      return res.status(409).json({ error: 'Este e-mail ja esta cadastrado.' });
    }
    if (phoneUser) {
      return res.status(409).json({ error: 'Este telefone ja esta cadastrado.' });
    }

    const cnpjData = await validateCnpjForOnboarding(req.body?.cnpj);
    const companyName = nomeOficinaInput || cnpjData.nomeFantasia || cnpjData.razaoSocial;
    const onboardingId = crypto.randomUUID();
    const emailCode = generateCode();
    const phoneCode = generateCode();
    const now = Date.now();

    pendingRef = db.collection('onboarding_pendentes').doc(onboardingId);
    await pendingRef.set({
      onboardingId,
      status: 'pending_verification',
      cnpj: cnpjData.cnpj,
      cnpjData,
      nomeOficina: companyName,
      nomeResponsavel,
      email,
      telefone,
      emailVerification: {
        codeHash: hashCode(onboardingId, 'email', emailCode),
        attempts: 0,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: timestampFromMillis(now + CODE_TTL_MS),
        verifiedAt: null
      },
      phoneVerification: {
        codeHash: hashCode(onboardingId, 'phone', phoneCode),
        attempts: 0,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: timestampFromMillis(now + CODE_TTL_MS),
        verifiedAt: null
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: timestampFromMillis(now + ONBOARDING_TTL_MS),
      requestIp: getRequestIp(req),
      userAgent: req.get('user-agent') || ''
    });

    const [emailDelivery, phoneDelivery] = await Promise.all([
      sendEmailCode({ email, code: emailCode, companyName }),
      sendPhoneCode({ phone: telefone, code: phoneCode, companyName })
    ]);

    return res.json({
      ok: true,
      onboardingId,
      cnpj: publicCnpjData(cnpjData),
      maskedEmail: maskEmail(email),
      maskedPhone: maskPhone(telefone),
      devCodes: {
        email: emailDelivery.devCode || undefined,
        phone: phoneDelivery.devCode || undefined
      }
    });
  } catch (error) {
    if (pendingRef) {
      await pendingRef.delete().catch(() => {});
    }
    console.error('[Onboarding start]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao iniciar cadastro seguro.' });
  }
});

router.post('/resend-code', async (req, res) => {
  try {
    requireFirebaseAdmin();
    checkRateLimit(`resend:${getRequestIp(req)}`);

    const type = req.body?.type === 'phone' ? 'phone' : 'email';
    const { ref, data } = await loadPending(req.body?.onboardingId);
    const field = type === 'phone' ? 'phoneVerification' : 'emailVerification';
    const verification = data[field] || {};
    const sentAtMillis = verification.sentAt?.toMillis ? verification.sentAt.toMillis() : 0;

    if (sentAtMillis && Date.now() - sentAtMillis < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Aguarde 60 segundos para reenviar o codigo.' });
    }

    const code = generateCode();
    const companyName = data.nomeOficina || data.cnpjData?.razaoSocial || 'sua empresa';
    const delivery = type === 'phone'
      ? await sendPhoneCode({ phone: data.telefone, code, companyName })
      : await sendEmailCode({ email: data.email, code, companyName });

    await ref.update({
      [`${field}.codeHash`]: hashCode(req.body.onboardingId, type, code),
      [`${field}.attempts`]: 0,
      [`${field}.sentAt`]: admin.firestore.FieldValue.serverTimestamp(),
      [`${field}.expiresAt`]: timestampFromMillis(Date.now() + CODE_TTL_MS)
    });

    return res.json({
      ok: true,
      devCode: delivery.devCode || undefined
    });
  } catch (error) {
    console.error('[Onboarding resend-code]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao reenviar codigo.' });
  }
});

const verifyCode = async ({ onboardingId, type, code }) => {
  const field = type === 'phone' ? 'phoneVerification' : 'emailVerification';
  const { ref, data } = await loadPending(onboardingId);
  const verification = data[field] || {};

  if (verification.verifiedAt) {
    return { alreadyVerified: true };
  }
  if (!code || typeof code !== 'string') {
    const error = new Error('Informe o codigo de verificacao.');
    error.status = 400;
    throw error;
  }
  if (verification.expiresAt?.toMillis && verification.expiresAt.toMillis() < Date.now()) {
    const error = new Error('Codigo expirado. Solicite um novo codigo.');
    error.status = 410;
    throw error;
  }
  if ((verification.attempts || 0) >= MAX_CODE_ATTEMPTS) {
    const error = new Error('Limite de tentativas excedido. Solicite um novo codigo.');
    error.status = 429;
    throw error;
  }

  const expectedHash = verification.codeHash;
  const receivedHash = hashCode(onboardingId, type, code);

  if (expectedHash !== receivedHash) {
    await ref.update({
      [`${field}.attempts`]: (verification.attempts || 0) + 1
    });
    const error = new Error('Codigo invalido.');
    error.status = 400;
    throw error;
  }

  await ref.update({
    [`${field}.verifiedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true };
};

router.post('/verify-email', async (req, res) => {
  try {
    requireFirebaseAdmin();
    checkRateLimit(`verify-email:${getRequestIp(req)}`);
    await verifyCode({ onboardingId: req.body?.onboardingId, type: 'email', code: req.body?.code });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Onboarding verify-email]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao validar e-mail.' });
  }
});

router.post('/verify-phone', async (req, res) => {
  try {
    requireFirebaseAdmin();
    checkRateLimit(`verify-phone:${getRequestIp(req)}`);
    await verifyCode({ onboardingId: req.body?.onboardingId, type: 'phone', code: req.body?.code });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Onboarding verify-phone]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao validar telefone.' });
  }
});

router.post('/complete', async (req, res) => {
  let createdUid = null;

  try {
    requireFirebaseAdmin();
    checkRateLimit(`complete:${getRequestIp(req)}`);

    const password = String(req.body?.password || '');
    const passwordError = assertPasswordPolicy(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const { ref, data } = await loadPending(req.body?.onboardingId);
    if (!data.emailVerification?.verifiedAt || !data.phoneVerification?.verifiedAt) {
      return res.status(409).json({ error: 'Confirme o e-mail e o telefone antes de finalizar.' });
    }

    const [emailUser, phoneUser, legacyCnpjSnap] = await Promise.all([
      auth.getUserByEmail(data.email).catch(() => null),
      auth.getUserByPhoneNumber(data.telefone).catch(() => null),
      db.collection('usuarios').where('cnpj', '==', data.cnpj).limit(1).get()
    ]);
    if (emailUser) return res.status(409).json({ error: 'Este e-mail ja esta cadastrado.' });
    if (phoneUser) return res.status(409).json({ error: 'Este telefone ja esta cadastrado.' });
    if (!legacyCnpjSnap.empty) return res.status(409).json({ error: 'Este CNPJ ja esta cadastrado.' });

    const displayName = data.nomeResponsavel || data.nomeOficina;
    const userRecord = await auth.createUser({
      email: data.email,
      password,
      displayName,
      phoneNumber: data.telefone,
      emailVerified: true,
      disabled: false
    });
    createdUid = userRecord.uid;

    await auth.setCustomUserClaims(createdUid, {
      role: 'Master',
      tenantId: createdUid
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    const cnpjRef = db.collection('cnpjs_cadastrados').doc(data.cnpj);
    const userRef = db.collection('usuarios').doc(createdUid);
    const configRef = db.collection('configuracoes').doc(createdUid);

    await db.runTransaction(async (transaction) => {
      const cnpjSnap = await transaction.get(cnpjRef);
      if (cnpjSnap.exists) {
        throw new Error('Este CNPJ ja esta cadastrado.');
      }

      transaction.set(cnpjRef, {
        cnpj: data.cnpj,
        tenantId: createdUid,
        email: data.email,
        razaoSocial: data.cnpjData?.razaoSocial || '',
        createdAt: now
      });

      transaction.set(userRef, {
        uid: createdUid,
        nomeOficina: data.nomeOficina,
        nomeResponsavel: data.nomeResponsavel,
        nome: data.nomeResponsavel,
        username: data.nomeResponsavel.split(' ')[0].toLowerCase() + Math.floor(Math.random() * 1000),
        cnpj: data.cnpj,
        cnpjValidado: true,
        cnpjStatus: data.cnpjData?.situacao || 'ATIVA',
        cnpjRazaoSocial: data.cnpjData?.razaoSocial || '',
        cnpjNomeFantasia: data.cnpjData?.nomeFantasia || '',
        validationProvider: data.cnpjData?.provider || 'brasilapi',
        email: data.email,
        emailVerificado: true,
        telefone: data.telefone,
        telefoneVerificado: true,
        role: 'Master',
        tenantId: createdUid,
        createdAt: now,
        validatedAt: now,
        onboardingStatus: 'active',
        status: 'Ativo',
        plano: 'Pro',
        valorMensalidade: 149.90,
        permissoes: []
      });

      transaction.set(configRef, {
        nomeOficina: data.nomeOficina,
        razaoSocial: data.cnpjData?.razaoSocial || '',
        nomeFantasia: data.cnpjData?.nomeFantasia || '',
        nomeUsuario: data.nomeResponsavel,
        cnpj: data.cnpj,
        telefone: data.telefone,
        email: data.email,
        rua: data.cnpjData?.logradouro || '',
        numero: data.cnpjData?.numero || '',
        bairro: data.cnpjData?.bairro || '',
        cidade: data.cnpjData?.municipio || '',
        uf: data.cnpjData?.uf || '',
        cep: data.cnpjData?.cep || '',
        planoContasReceitas: ['Servicos', 'Venda de Produtos', 'Outras Receitas'],
        planoContasDespesas: ['Aluguel', 'Agua/Luz/Internet', 'Salarios', 'Impostos', 'Fornecedores de Produtos', 'Marketing', 'Manutencao', 'Outros'],
        tenantId: createdUid,
        createdAt: now
      });

      transaction.update(ref, {
        status: 'completed',
        userUid: createdUid,
        completedAt: now
      });
    });

    return res.json({
      ok: true,
      email: data.email
    });
  } catch (error) {
    if (createdUid) {
      await auth.deleteUser(createdUid).catch(() => {});
    }
    console.error('[Onboarding complete]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao finalizar cadastro.' });
  }
});

module.exports = router;
