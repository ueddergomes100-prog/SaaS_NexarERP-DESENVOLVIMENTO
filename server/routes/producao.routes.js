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
    // Caixas de antes, so' para o Historico de alteracoes: falha na leitura nao impede salvar.
    let anteriores = null;
    try {
      const atual = await db.collection('configuracoes').doc(tenantId).get();
      anteriores = atual.exists && Array.isArray(atual.data().tarasProducao) ? atual.data().tarasProducao : [];
    } catch (erroLeitura) {
      console.error('[Producao] taras: falha ao ler as caixas anteriores (Histórico de alterações):', erroLeitura.message);
    }
    await db.collection('configuracoes').doc(tenantId).set({
      tarasProducao: taras,
      ...buildDocumentUpdateMetadata(req.user.uid, agora, 'Caixas (taras) da produção alteradas'),
    }, { merge: true });
    // Historico de alteracoes (09/11/2026): ligado a configuracao da filial, com o que entrou, saiu ou mudou de peso.
    const kg = (v) => `${(Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;
    const situacao = (t) => (t ? `${kg(t.pesoKg)}${t.ativa === false ? ' (inativa)' : ''}` : null);
    const alteracoes = [];
    if (anteriores) {
      const chave = (t) => String((t && t.id) || (t && t.nome) || '');
      const antes = new Map(anteriores.map((t) => [chave(t), t]));
      const depois = new Map(taras.map((t) => [chave(t), t]));
      taras.forEach((t) => {
        const a = antes.get(chave(t));
        const nomeMudou = a && String(a.nome || '') !== t.nome;
        if (!a || situacao(a) !== situacao(t) || nomeMudou) {
          alteracoes.push({ campo: `Caixa ${t.nome}${nomeMudou ? ` (antes ${a.nome})` : ''}`, valorAnterior: situacao(a), valorNovo: situacao(t) });
        }
      });
      anteriores.forEach((t) => {
        if (!depois.has(chave(t))) alteracoes.push({ campo: `Caixa ${String(t.nome || '')}`, valorAnterior: situacao(t), valorNovo: null });
      });
    }
    if (!anteriores || alteracoes.length > 0) {
      registrarLog(req.user, {
        modulo: 'producao',
        acao: 'edicao',
        descricao: `Caixas (taras) da produção: ${taras.map((t) => `${t.nome} ${kg(t.pesoKg)}${t.ativa === false ? ' (inativa)' : ''}`).join(', ') || 'nenhuma'}.`,
        registroId: tenantId,
        documentoTipo: 'configuracao',
        documentoNumero: 'Caixas (taras) da produção',
        alteracoes,
      });
    }
    return res.json({ ok: true, taras });
  } catch (erro) {
    console.error('[Producao] taras:', erro);
    return res.status(500).json({ error: 'Não foi possível salvar as caixas agora. Nada foi gravado. Tente de novo em instantes.' });
  }
});

module.exports = router;
