/*
 * PRODUCAO PELO SERVIDOR (26/10/2026).
 *
 * POST /api/producao/taras -- { taras: [{ id?, nome, pesoKg, ativa? }] }
 * As caixas (taras) descontadas na pesagem da producao. Ficam na configuracao
 * da filial (configuracoes/{tenantId}.tarasProducao) -- assim nao precisa de
 * colecao nova nem de regra nova do Firestore -- e so' o servidor grava: quem
 * mexe na producao ('operacoes.producao') ou o dono/administrador.
 * Regra em domain/producaoPesagemDomain (compilado de src/utils).
 */
const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { db, admin } = require('../config/firebase');
const { erroDasTaras, nomeDaTara } = require('../domain/producaoPesagemDomain');
const { buildDocumentUpdateMetadata } = require('../domain/documentMetadata');
const { registrarLog } = require('../services/auditoria');

const router = express.Router();
router.use(authenticate);

const PERMISSAO_PRODUCAO = 'operacoes.producao';
const podeMexerNaProducao = (req, res, next) => {
  const u = req.user;
  if (u && (u.isPlatformAdmin || u.isTenantManager || (u.permissoes || []).includes(PERMISSAO_PRODUCAO))) return next();
  return res.status(403).json({ error: 'Só quem tem a permissão de Produção, o dono ou um administrador cadastra as caixas (taras).' });
};

router.post('/taras', podeMexerNaProducao, async (req, res) => {
  try {
    const recebidas = Array.isArray(req.body?.taras) ? req.body.taras : null;
    if (!recebidas) return res.status(400).json({ error: 'Lista de caixas inválida. Atualize a tela e tente de novo.' });
    if (recebidas.length > 50) return res.status(400).json({ error: 'São caixas demais. Cadastre no máximo 50.' });
    const erro = erroDasTaras(recebidas.map((t) => ({ nome: t && t.nome, pesoKg: t && t.pesoKg })));
    if (erro) return res.status(400).json({ error: erro });
    const taras = recebidas.map((t) => ({
      id: /^[A-Za-z0-9_-]{1,40}$/.test(String(t.id || '')) ? String(t.id) : crypto.randomUUID().slice(0, 8),
      nome: nomeDaTara(t.nome),
      pesoKg: Math.round(Number(String(t.pesoKg).replace(',', '.')) * 1000) / 1000,
      ativa: t.ativa !== false,
    }));
    const tenantId = req.user.tenantId;
    const agora = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('configuracoes').doc(tenantId).set({
      tarasProducao: taras,
      ...buildDocumentUpdateMetadata(req.user.uid, agora, 'Caixas (taras) da produção alteradas'),
    }, { merge: true });
    registrarLog(req.user, {
      modulo: 'producao',
      acao: 'edicao',
      descricao: `Caixas (taras) da produção: ${taras.map((t) => `${t.nome} ${t.pesoKg} kg`).join(', ') || 'nenhuma'}.`,
    });
    return res.json({ ok: true, taras });
  } catch (erro) {
    console.error('[Producao] taras:', erro);
    return res.status(500).json({ error: 'Não foi possível salvar as caixas agora. Nada foi gravado. Tente de novo em instantes.' });
  }
});

module.exports = router;
