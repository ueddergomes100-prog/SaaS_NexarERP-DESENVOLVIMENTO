const crypto = require('crypto');
const { admin, db } = require('../config/firebase');

/**
 * AVISOS NO CELULAR (21/10/2026) -- Firebase Cloud Messaging (web push).
 *
 * O app Vendas registra o token do aparelho aqui (`dispositivos_push`, so' o
 * servidor le e grava) e o servidor manda o aviso pelo FCM. Primeiro uso: a
 * liberacao de desconto pelo celular (services/liberacaoRemota.js). O aviso e'
 * cortesia: falhar em mandar nunca derruba a operacao que o pediu.
 *
 * Precisa da chave VAPID do projeto Firebase (Configuracoes do projeto >
 * Cloud Messaging > Certificados push da Web): a publica vai em
 * FCM_VAPID_PUBLIC_KEY no .env do servidor e e' entregue ao app por
 * GET /api/notificacoes/config. Sem a chave, o app so' nao ativa os avisos.
 */

const COLECAO = 'dispositivos_push';
const LOTE_IN = 10;

const chavePublica = () => String(process.env.FCM_VAPID_PUBLIC_KEY || '').trim();

const configPublica = () => ({ ativo: Boolean(chavePublica()), vapidPublicKey: chavePublica() });

const idDoToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 40);

const tokenValido = (token) => typeof token === 'string' && token.length >= 20 && token.length <= 4096;

const registrarDispositivo = async ({ user, tenantId, token, plataforma }) => {
  if (!tokenValido(token)) {
    const erro = new Error('Token do aparelho inválido. Feche e abra o app e tente ativar os avisos de novo.');
    erro.status = 400;
    throw erro;
  }
  const agora = admin.firestore.FieldValue.serverTimestamp();
  await db.collection(COLECAO).doc(idDoToken(token)).set({
    tenantId,
    uid: user.uid,
    token,
    plataforma: String(plataforma || '').slice(0, 60),
    atualizadoEm: agora,
  }, { merge: true });
  return { ok: true };
};

const removerDispositivo = async ({ user, token }) => {
  if (!tokenValido(token)) return { ok: true };
  const ref = db.collection(COLECAO).doc(idDoToken(token));
  const snap = await ref.get();
  if (snap.exists && snap.data().uid === user.uid) await ref.delete();
  return { ok: true };
};

const pedacos = (lista, tamanho = LOTE_IN) => {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
};

/** Tokens dos aparelhos destas pessoas (desta empresa). */
const tokensDosUsuarios = async (tenantId, uids) => {
  const saida = [];
  for (const lote of pedacos([...new Set(uids)].filter(Boolean))) {
    const snap = await db.collection(COLECAO).where('tenantId', '==', tenantId).where('uid', 'in', lote).get();
    snap.docs.forEach((d) => { if (tokenValido(d.data().token)) saida.push({ ref: d.ref, token: d.data().token }); });
  }
  return saida;
};

const TOKEN_MORTO = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

/**
 * Manda o aviso para os aparelhos das pessoas. `dados` vai como strings
 * (exigencia do FCM); `link` e' a tela que abre ao tocar.
 */
const enviarParaUsuarios = async ({ tenantId, uids, titulo, corpo, link, dados = {} }) => {
  try {
    if (!chavePublica() || typeof admin.messaging !== 'function') return { enviados: 0, aparelhos: 0, desligado: true };
    const aparelhos = await tokensDosUsuarios(tenantId, uids);
    if (aparelhos.length === 0) return { enviados: 0, aparelhos: 0 };
    const dadosTexto = Object.fromEntries(Object.entries({ ...dados, link: link || '' }).map(([k, v]) => [k, String(v ?? '')]));
    const resposta = await admin.messaging().sendEachForMulticast({
      tokens: aparelhos.map((a) => a.token),
      notification: { title: titulo, body: corpo },
      data: dadosTexto,
      webpush: {
        headers: { Urgency: 'high', TTL: '600' },
        fcmOptions: link ? { link } : undefined,
        notification: {
          title: titulo,
          body: corpo,
          icon: '/icon-vendedor-192.png',
          badge: '/icon-vendedor-192.png',
          tag: dadosTexto.tag || undefined,
          renotify: Boolean(dadosTexto.tag),
          requireInteraction: true,
        },
      },
    });
    // Aparelho que sumiu (app desinstalado, token trocado): sai da lista.
    const mortos = [];
    resposta.responses.forEach((r, i) => {
      const codigo = r.error && r.error.code;
      if (!r.success && TOKEN_MORTO.includes(codigo)) mortos.push(aparelhos[i].ref);
    });
    await Promise.all(mortos.map((ref) => ref.delete().catch(() => undefined)));
    return { enviados: resposta.successCount, aparelhos: aparelhos.length, removidos: mortos.length };
  } catch (erro) {
    console.error('[Avisos] não foi possível mandar o aviso no celular:', erro && erro.message);
    return { enviados: 0, aparelhos: 0, falhou: true };
  }
};

module.exports = { COLECAO, configPublica, registrarDispositivo, removerDispositivo, enviarParaUsuarios, tokensDosUsuarios };
