const express = require('express');
const crypto = require('crypto');
const { admin, auth, db } = require('../config/firebase');
const { onlyDigits, isValidCnpj, fetchCnpjData } = require('../utils/cnpjLookup');
const { fetchComTimeout, PERFIS } = require('../utils/fetchComTimeout');
const { ipDoCliente } = require('../utils/requestIp');
const { limitadorPublico, limitadorPorChave, limitadorTotal, MINUTO_MS } = require('../middleware/rateLimit');
const {
  ESTADO_ENVIO,
  MOTIVO_ESTADO_DESCONHECIDO,
  consultarEnvioNoResend,
  estadoDeEnvioEhFinal,
  respostaPublicaDoEnvio,
} = require('../services/envioCodigoCadastro');

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const ONBOARDING_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const requireFirebaseAdmin = () => {
  if (!admin || !auth || !db) {
    const error = new Error('Firebase Admin SDK não configurado no backend.');
    error.status = 503;
    throw error;
  }
};

/** Nome de pessoa ou de empresa vindo do cadastro publico: sem < >, espacos unicos, ate' 120 caracteres. */
const textoDeNome = (valor) => String(valor || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);

const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

// ---------------------------------------------------------------------------
// LIMITES DAS ROTAS PUBLICAS (ninguem esta logado aqui).
//
// Ate 2026-09-30 o limite era so' por IP, e o IP era lido do primeiro valor
// de X-Forwarded-For -- que quem chama escreve. Agora o IP vem do Express
// (`trust proxy`, ver server.js) e, alem dele, cada alvo tem o proprio teto:
//  - por e-mail: ninguem recebe mais de 5 codigos por hora, venha de quantos
//    IPs vier (contra "e-mail bombing" pelo nosso remetente);
//  - por cadastro pendente: reenvio/confirmacao de codigo;
//  - teto TOTAL da consulta de CNPJ: a Receita Federal (BrasilAPI) enxerga o
//    IP do SERVIDOR -- se ela bloquear, o cadastro para pra todo mundo.
// ---------------------------------------------------------------------------
const limitePorIp = (nome) => limitadorPublico(`onboarding-${nome}`, { limite: 30 });
const limiteCnpjPorIp = limitePorIp('cnpj');
const limiteStartPorIp = limitePorIp('start');
const limiteResendPorIp = limitePorIp('resend');
const limiteVerifyPorIp = limitePorIp('verify');
const limiteCompletePorIp = limitePorIp('complete');
const limitePorEmail = limitadorPorChave('onboarding-email', (req) => normalizeEmail(req.body?.email), {
  limite: 5,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Este e-mail já recebeu códigos demais na última hora. Aguarde antes de pedir outro.',
});
const limiteReenvioPorCadastro = limitadorPorChave('onboarding-reenvio', (req) => String(req.body?.onboardingId || ''), {
  limite: 5,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Este cadastro já pediu códigos demais na última hora. Aguarde antes de pedir outro.',
});
const limiteVerificacaoPorCadastro = limitadorPorChave('onboarding-verificacao', (req) => String(req.body?.onboardingId || ''), {
  limite: 30,
  mensagem: 'Muitas tentativas de confirmar o código. Aguarde alguns minutos e tente de novo.',
});
const tetoConsultaCnpj = limitadorTotal('onboarding-cnpj', {
  limite: 300,
  mensagem: 'A validação de CNPJ recebeu pedidos demais na última hora. Tente de novo mais tarde.',
});
// "O codigo foi entregue?" (/status-envio). A tela pergunta ate' 3 vezes por
// envio; cada pergunta sem resposta guardada vira uma consulta ao Resend, que
// tem limite por CONTA (10 por segundo, somando com os envios) -- por isso,
// alem do IP e do cadastro, um teto total.
const limiteStatusEnvioPorIp = limitadorPublico('onboarding-status-envio', { limite: 60 });
const limiteStatusEnvioPorCadastro = limitadorPorChave('onboarding-status-envio', (req) => String(req.body?.onboardingId || ''), {
  limite: 40,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitas consultas sobre o envio do código. Aguarde alguns minutos e tente de novo.',
});
const tetoConsultaEnvio = limitadorTotal('onboarding-status-envio', {
  limite: 1500,
  mensagem: 'A consulta de envio de código recebeu pedidos demais na última hora. Tente de novo mais tarde.',
});

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
    const error = new Error('ONBOARDING_CODE_SECRET deve ser configurado em produção.');
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
    return 'A senha precisa conter pelo menos uma letra minúscula.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'A senha precisa conter pelo menos uma letra maiúscula.';
  }
  if (!/\d/.test(password)) {
    return 'A senha precisa conter pelo menos um número.';
  }
  return null;
};

const timestampFromMillis = (millis) => admin.firestore.Timestamp.fromDate(new Date(millis));

const validateCnpjForOnboarding = async (cnpjInput) => {
  const cnpj = onlyDigits(cnpjInput);

  if (!isValidCnpj(cnpj)) {
    const error = new Error('CNPJ inválido.');
    error.status = 400;
    throw error;
  }

  const [registrySnap, usersSnap] = await Promise.all([
    db.collection('cnpjs_cadastrados').doc(cnpj).get(),
    db.collection('usuarios').where('cnpj', '==', cnpj).limit(1).get()
  ]);

  if (registrySnap.exists || !usersSnap.empty) {
    const error = new Error('Este CNPJ já está cadastrado no sistema.');
    error.status = 409;
    throw error;
  }

  const cnpjData = await fetchCnpjData(cnpj);
  if (!cnpjData.ativo) {
    const error = new Error(`CNPJ encontrado, mas a situação cadastral não está ativa (${cnpjData.situacao}).`);
    error.status = 422;
    throw error;
  }

  return cnpjData;
};

const sendEmailCode = async ({ email, code, companyName }) => {
  const subject = 'Código de verificação Hennder ERP';
  const text = `Seu código de verificação Hennder ERP para ${companyName} é: ${code}. Ele expira em 10 minutos.`;
  const safeCompanyName = escapeHtml(companyName);
  const safeCode = escapeHtml(code);
  const html = `
    <div style="font-family:Arial,sans-serif;color:#111827;line-height:1.5;">
      <h2>Confirme seu e-mail</h2>
      <p>Use o código abaixo para continuar o cadastro da empresa <strong>${safeCompanyName}</strong>.</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0;">${safeCode}</div>
      <p>Este código expira em 10 minutos. Se você não solicitou este cadastro, ignore esta mensagem.</p>
    </div>
  `;

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const response = await fetchComTimeout('https://api.resend.com/emails', {
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
    }, PERFIS.email);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // O texto do Resend (em ingles, tecnico) fica so' no log do servidor;
      // para a tela vai a mensagem em portugues (regra 2 do CLAUDE.md).
      console.error(`[Onboarding] Resend recusou o envio do codigo: HTTP ${response.status} ${data.name || ''} ${data.message || ''}`.trim());
      const error = new Error('Não foi possível enviar o código por e-mail. Tente de novo em instantes; se continuar, fale com o suporte.');
      error.status = 502;
      throw error;
    }
    // 200 aqui e' "pedido aceito", NAO "entregue": endereco na lista de
    // bloqueio do Resend tambem devolve 200. O id serve para a tela perguntar
    // depois o que aconteceu (ver services/envioCodigoCadastro.js).
    return { delivered: true, provedor: 'resend', envioId: typeof data.id === 'string' && data.id ? data.id : null };
  }

  if (process.env.SENDGRID_API_KEY && process.env.EMAIL_FROM) {
    const response = await fetchComTimeout('https://api.sendgrid.com/v3/mail/send', {
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
    }, PERFIS.email);

    if (!response.ok) {
      throw new Error('Não foi possível enviar o código por e-mail.');
    }
    return { delivered: true };
  }

  if (process.env.ONBOARDING_DEV_CODES === 'true' && process.env.NODE_ENV !== 'production') {
    console.warn(`[Onboarding DEV] Codigo de e-mail para ${email}: ${code}`);
    return { delivered: false, devCode: code };
  }

  // Diagnostico -- so presenca/tamanho das variaveis, nunca o valor (mesmo
  // padrao de diagnosticoCredencial em config/firebase.js). Existe porque o
  // sintoma "configurei RESEND_API_KEY + EMAIL_FROM e continua dando este
  // erro" e' opaco sem isto: nao da pra saber se a variavel nao chegou no
  // processo (app errado, nome digitado diferente, faltou redeploy de
  // verdade) so pela mensagem de erro que o usuario final ve.
  console.warn(
    `[Onboarding] Servico de e-mail nao configurado -- `
    + `RESEND_API_KEY=${process.env.RESEND_API_KEY ? `presente (${process.env.RESEND_API_KEY.length} caracteres)` : 'AUSENTE'} | `
    + `EMAIL_FROM=${process.env.EMAIL_FROM ? `presente (${process.env.EMAIL_FROM.length} caracteres)` : 'AUSENTE'} | `
    + `SENDGRID_API_KEY=${process.env.SENDGRID_API_KEY ? `presente (${process.env.SENDGRID_API_KEY.length} caracteres)` : 'AUSENTE'}`
  );

  const error = new Error('Serviço de e-mail não configurado.');
  error.status = 503;
  throw error;
};

const loadPending = async (onboardingId) => {
  if (!onboardingId || typeof onboardingId !== 'string') {
    const error = new Error('Cadastro pendente inválido.');
    error.status = 400;
    throw error;
  }

  const ref = db.collection('onboarding_pendentes').doc(onboardingId);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error('Cadastro pendente não encontrado.');
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
    const error = new Error('Este cadastro já foi finalizado.');
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

router.post('/validate-cnpj', limiteCnpjPorIp, tetoConsultaCnpj, async (req, res) => {
  try {
    requireFirebaseAdmin();

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

router.post('/start', limiteStartPorIp, limitePorEmail, tetoConsultaCnpj, async (req, res) => {
  let pendingRef = null;

  try {
    requireFirebaseAdmin();

    const email = normalizeEmail(req.body?.email);
    const telefone = normalizePhone(req.body?.telefone);
    // Texto simples e curto (auditoria de 24/11/2026): estes nomes aparecem em janelas do
    // painel da plataforma e em e-mails; sinais de marcacao nao entram e o tamanho e' limitado.
    const nomeResponsavel = textoDeNome(req.body?.nomeResponsavel);
    const nomeOficinaInput = textoDeNome(req.body?.nomeOficina);

    if (!nomeResponsavel || nomeResponsavel.length < 3) {
      return res.status(400).json({ error: 'Informe o nome do responsável.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Informe um e-mail válido.' });
    }
    if (!telefone) {
      return res.status(400).json({ error: 'Informe um telefone celular válido com DDD.' });
    }

    const [emailUser, phoneUser] = await Promise.all([
      auth.getUserByEmail(email).catch(() => null),
      auth.getUserByPhoneNumber(telefone).catch(() => null)
    ]);
    if (emailUser) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    }
    if (phoneUser) {
      return res.status(409).json({ error: 'Este telefone já está cadastrado.' });
    }

    const cnpjData = await validateCnpjForOnboarding(req.body?.cnpj);
    const companyName = nomeOficinaInput || cnpjData.nomeFantasia || cnpjData.razaoSocial;
    const onboardingId = crypto.randomUUID();
    const emailCode = generateCode();
    const now = Date.now();

    // Telefone e' coletado e guardado (contato/WhatsApp), mas NAO passa por
    // codigo de verificacao -- decisao do dono do produto (2026-08-27): o
    // unico canal de confianca do cadastro e' o e-mail. Reativar SMS/WhatsApp
    // exigiria configurar Twilio (ou similar) em producao; sem isso o
    // cadastro ficava bloqueado.
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: timestampFromMillis(now + ONBOARDING_TTL_MS),
      requestIp: ipDoCliente(req),
      userAgent: req.get('user-agent') || ''
    });

    const emailDelivery = await sendEmailCode({ email, code: emailCode, companyName });

    // Guarda o id do envio para o /status-envio. Se esta gravacao falhar, o
    // codigo ja' saiu e o cadastro segue: so' ficamos sem saber o estado.
    if (emailDelivery.envioId) {
      await pendingRef.update({
        'emailVerification.envioId': emailDelivery.envioId,
        'emailVerification.envioProvedor': emailDelivery.provedor,
        'emailVerification.envioEstado': null
      }).catch((erro) => console.warn('[Onboarding start] Nao foi possivel guardar o id do envio:', erro.message));
    }

    return res.json({
      ok: true,
      onboardingId,
      cnpj: publicCnpjData(cnpjData),
      maskedEmail: maskEmail(email),
      devCodes: {
        email: emailDelivery.devCode || undefined
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

router.post('/resend-code', limiteResendPorIp, limiteReenvioPorCadastro, async (req, res) => {
  try {
    requireFirebaseAdmin();

    const field = 'emailVerification';
    const { ref, data } = await loadPending(req.body?.onboardingId);
    const verification = data[field] || {};
    const sentAtMillis = verification.sentAt?.toMillis ? verification.sentAt.toMillis() : 0;

    if (sentAtMillis && Date.now() - sentAtMillis < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'Aguarde 60 segundos para reenviar o código.' });
    }

    const code = generateCode();
    const companyName = data.nomeOficina || data.cnpjData?.razaoSocial || 'sua empresa';
    const delivery = await sendEmailCode({ email: data.email, code, companyName });

    await ref.update({
      [`${field}.codeHash`]: hashCode(req.body.onboardingId, 'email', code),
      [`${field}.attempts`]: 0,
      [`${field}.sentAt`]: admin.firestore.FieldValue.serverTimestamp(),
      [`${field}.expiresAt`]: timestampFromMillis(Date.now() + CODE_TTL_MS),
      // Envio novo: o estado guardado do anterior nao vale mais. `null` (e
      // nunca undefined) quando o provedor nao devolve id.
      [`${field}.envioId`]: delivery.envioId || null,
      [`${field}.envioProvedor`]: delivery.provedor || null,
      [`${field}.envioEstado`]: null
    });

    return res.json({
      ok: true,
      devCode: delivery.devCode || undefined
    });
  } catch (error) {
    console.error('[Onboarding resend-code]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao reenviar o código.' });
  }
});

// O codigo foi entregue? Devolve SO' o estado do ultimo envio daquele cadastro
// pendente -- nunca endereco, assunto ou qualquer dado do e-mail. Quem chama
// precisa do onboardingId (UUID aleatorio que so' a tela que iniciou o
// cadastro conhece).
router.post('/status-envio', limiteStatusEnvioPorIp, limiteStatusEnvioPorCadastro, tetoConsultaEnvio, async (req, res) => {
  try {
    requireFirebaseAdmin();

    const { ref, data } = await loadPending(req.body?.onboardingId);
    const verification = data.emailVerification || {};

    // Quem ja' digitou o codigo certo recebeu o e-mail.
    if (verification.verifiedAt) {
      return res.json(respostaPublicaDoEnvio(ESTADO_ENVIO.ENTREGUE));
    }
    // Estado final ja' guardado: nao gasta consulta no Resend.
    if (estadoDeEnvioEhFinal(verification.envioEstado)) {
      return res.json(respostaPublicaDoEnvio(verification.envioEstado));
    }
    // SendGrid, codigo de desenvolvimento ou cadastro iniciado antes desta
    // versao: nao ha' id para consultar. A tela segue como sempre foi.
    if (verification.envioProvedor !== 'resend' || !verification.envioId) {
      return res.json(respostaPublicaDoEnvio(ESTADO_ENVIO.DESCONHECIDO));
    }

    const { estado, motivo } = await consultarEnvioNoResend(verification.envioId);

    if (motivo === MOTIVO_ESTADO_DESCONHECIDO.CHAVE_SEM_PERMISSAO) {
      console.warn('[Onboarding status-envio] O Resend recusou a consulta do envio: a RESEND_API_KEY parece ser de "Sending access". '
        + 'Troque por uma chave "Full access" para o cadastro perceber e-mail devolvido ou bloqueado.');
    } else if (motivo) {
      console.warn(`[Onboarding status-envio] Estado do envio nao obtido (${motivo}).`);
    }

    if (estadoDeEnvioEhFinal(estado)) {
      if (estado !== ESTADO_ENVIO.ENTREGUE) {
        console.warn(`[Onboarding status-envio] Codigo NAO entregue (${estado}) para ${maskEmail(data.email || '')} -- cadastro ${req.body.onboardingId}.`);
      }
      await ref.update({ 'emailVerification.envioEstado': estado }).catch(() => {});
    }

    return res.json(respostaPublicaDoEnvio(estado));
  } catch (error) {
    console.error('[Onboarding status-envio]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao consultar o envio do código.' });
  }
});

const verifyCode = async ({ onboardingId, code }) => {
  const field = 'emailVerification';
  const { ref, data } = await loadPending(onboardingId);
  const verification = data[field] || {};

  if (verification.verifiedAt) {
    return { alreadyVerified: true };
  }
  if (!code || typeof code !== 'string') {
    const error = new Error('Informe o código de verificação.');
    error.status = 400;
    throw error;
  }
  if (verification.expiresAt?.toMillis && verification.expiresAt.toMillis() < Date.now()) {
    const error = new Error('Código expirado. Solicite um novo código.');
    error.status = 410;
    throw error;
  }
  if ((verification.attempts || 0) >= MAX_CODE_ATTEMPTS) {
    const error = new Error('Limite de tentativas excedido. Solicite um novo código.');
    error.status = 429;
    throw error;
  }

  const expectedHash = verification.codeHash;
  const receivedHash = hashCode(onboardingId, 'email', code);

  if (expectedHash !== receivedHash) {
    await ref.update({
      [`${field}.attempts`]: (verification.attempts || 0) + 1
    });
    const error = new Error('Código inválido.');
    error.status = 400;
    throw error;
  }

  await ref.update({
    [`${field}.verifiedAt`]: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true };
};

router.post('/verify-email', limiteVerifyPorIp, limiteVerificacaoPorCadastro, async (req, res) => {
  try {
    requireFirebaseAdmin();
    await verifyCode({ onboardingId: req.body?.onboardingId, code: req.body?.code });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Onboarding verify-email]', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Erro ao validar e-mail.' });
  }
});

router.post('/complete', limiteCompletePorIp, async (req, res) => {
  let createdUid = null;

  try {
    requireFirebaseAdmin();

    const password = String(req.body?.password || '');
    const passwordError = assertPasswordPolicy(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const { ref, data } = await loadPending(req.body?.onboardingId);
    if (!data.emailVerification?.verifiedAt) {
      return res.status(409).json({ error: 'Confirme o e-mail antes de finalizar.' });
    }

    const [emailUser, phoneUser, legacyCnpjSnap] = await Promise.all([
      auth.getUserByEmail(data.email).catch(() => null),
      auth.getUserByPhoneNumber(data.telefone).catch(() => null),
      db.collection('usuarios').where('cnpj', '==', data.cnpj).limit(1).get()
    ]);
    if (emailUser) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    if (phoneUser) return res.status(409).json({ error: 'Este telefone já está cadastrado.' });
    if (!legacyCnpjSnap.empty) return res.status(409).json({ error: 'Este CNPJ já está cadastrado.' });

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
        throw new Error('Este CNPJ já está cadastrado.');
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
        // Coletado, mas NAO passa por codigo de verificacao (ver comentario
        // em /start) -- fica false pra nao afirmar uma confirmacao que nao
        // aconteceu. isOnboardingIncomplete (AuthContext.tsx/AuthPage.tsx)
        // nao olha mais este campo, entao ele nao bloqueia login.
        telefoneVerificado: false,
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
        // Plano de contas (28/11/2026): ja' nasce com as categorias dos lancamentos automaticos
        // (venda por forma, juros, tarifa, compra, frete...) -- vinculosPlanoContasDomain.
        ...(() => {
          const plano = require('../domain/vinculosPlanoContasDomain').planoEfetivo({
            planoContasReceitas: ['Serviços', 'Outras Receitas'],
            planoContasDespesas: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Impostos', 'Marketing', 'Manutenção', 'Outros'],
          });
          return { planoContasReceitas: plano.receitas, planoContasDespesas: plano.despesas };
        })(),
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
