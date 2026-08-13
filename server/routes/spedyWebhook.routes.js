const express = require('express');
const router = express.Router();
const { admin, db } = require('../config/firebase');

const BASE_URLS = {
  sandbox: 'https://sandbox-api.spedy.com.br/v1',
  production: 'https://api.spedy.com.br/v1'
};

// Mapa tipo local (LocalInvoice.tipo, ver NFE.tsx) -> segmento de rota da Spedy.
const TYPE_PATHS = {
  'NFS-e': 'service-invoices',
  'NF-e': 'product-invoices',
  'NFC-e': 'consumer-invoices'
};

/**
 * Recebe o webhook `invoice.status_changed` da Spedy pra atualizar o
 * status local sem depender só do polling manual (syncPendingInvoices em
 * NFE.tsx). A Spedy nao documenta nenhuma verificacao de assinatura
 * (HMAC/secret) pro webhook -- a unica protecao possivel e um token
 * compartilhado embutido na propria URL de registro (SPEDY_WEBHOOK_SECRET),
 * comparado abaixo. Mesmo que a URL vaze, o pior caso e alguem forcar um
 * resync de status via API autenticada nossa: o corpo do webhook NUNCA e
 * usado como fonte de verdade, so como gatilho pra buscar o estado real
 * na Spedy antes de gravar qualquer coisa (mesma orientacao da propria
 * documentacao da Spedy: "webhooks nao substituem consultas a API").
 *
 * Uma conta Spedy so, com todos os CNPJs dos tenants dentro dela (modelo
 * confirmado com o usuario) -- um webhook so ja cobre todo mundo; o tenant
 * de cada evento e descoberto cruzando o id da nota (`data.id`) com o
 * documento local em `notas_fiscais` (que ja guarda `tenantId`), nao
 * confiando no campo `company` do payload do webhook.
 */
router.post('/:secret', async (req, res) => {
  if (!process.env.SPEDY_WEBHOOK_SECRET || req.params.secret !== process.env.SPEDY_WEBHOOK_SECRET) {
    // 404 em vez de 401/403 -- nao revela que a rota existe pra quem nao tem o token certo.
    return res.status(404).end();
  }

  // Responde rapido pra Spedy nao reenviar por timeout; o trabalho real
  // roda depois, best-effort (loga erro, nunca derruba o processo).
  res.status(200).json({ received: true });

  try {
    const spedyNoteId = req.body?.data?.id;
    if (!spedyNoteId || !db) return;

    const snap = await db.collection('notas_fiscais').where('spedyId', '==', spedyNoteId).limit(1).get();
    if (snap.empty) return; // nota nao rastreada localmente (ex: emitida fora do sistema), nada a fazer

    const noteDoc = snap.docs[0];
    const noteData = noteDoc.data();
    const tenantId = noteData.tenantId;
    const typePath = TYPE_PATHS[noteData.tipo];
    if (!tenantId || !typePath) return;

    const [publicSnap, privateSnap] = await Promise.all([
      db.collection('configuracoes').doc(tenantId).get(),
      db.collection('configuracoes_privadas').doc(tenantId).get()
    ]);
    const publicConfig = publicSnap.exists ? publicSnap.data() : {};
    const privateConfig = privateSnap.exists ? privateSnap.data() : {};
    const apiKey = privateConfig.spedyApiKey || publicConfig.spedyApiKey;
    if (!apiKey) return;

    const env = publicConfig.spedyEnvironment === 'production' ? 'production' : 'sandbox';

    // Reconsulta o estado real via API autenticada -- nunca usa o
    // "status" que veio solto no corpo do webhook.
    const response = await fetch(`${BASE_URLS[env]}/${typePath}/${spedyNoteId}`, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey }
    });
    if (!response.ok) return;
    const freshNote = await response.json();

    await noteDoc.ref.update({
      status: freshNote.status,
      number: freshNote.number ?? noteData.number ?? null,
      accessKey: freshNote.accessKey || noteData.accessKey || null,
      processingMessage: freshNote.processingDetail?.message || null,
      processingCode: freshNote.processingDetail?.code || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('[Spedy Webhook]', error);
  }
});

module.exports = router;
