const express = require('express');
const { authenticate } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const {
  ErroTabelasFiscais,
  definirCfopAtivo,
  registrarUso,
  cadastrarNcm,
  cadastrarCest,
  buscar,
} = require('../services/tabelasFiscais');

/**
 * TABELAS FISCAIS (20/10/2026): CFOP ativo/desativado na empresa e a base unica
 * de NCM/CEST. Ver services/tabelasFiscais.js.
 */
const router = express.Router();
router.use(authenticate);

const porUsuario = (req) => (req.user && req.user.uid) || req.ip;
// "Registrar uso" vem de todo produto salvo e de toda entrada de nota.
const limiteDoUso = limitadorPorChave('tabelas-fiscais-uso', porUsuario, {
  limite: 240,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitas atualizações da base de NCM/CEST em pouco tempo. Aguarde alguns minutos.',
});
const limiteDoCadastro = limitadorPorChave('tabelas-fiscais-cadastro', porUsuario, {
  limite: 120,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Muitos cadastros em pouco tempo. Aguarde alguns minutos.',
});

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroTabelasFiscais) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Tabelas fiscais] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível salvar na tabela fiscal. Tente novamente em instantes.' });
};

/** Busca na base de NCM ou CEST (?tipo=ncm|cest&busca=...&ncm=...). Qualquer usuario da empresa le. */
router.get('/busca', async (req, res) => {
  try {
    const r = await buscar({ tipo: req.query.tipo, busca: req.query.busca, ncm: req.query.ncm });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'buscar');
  }
});

router.post('/cfop/ativo', limiteDoCadastro, async (req, res) => {
  try {
    const r = await definirCfopAtivo({ user: req.user, codigo: req.body?.codigo, ativo: req.body?.ativo });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'CFOP ativo');
  }
});

router.post('/uso', limiteDoUso, async (req, res) => {
  try {
    const r = await registrarUso({ itens: req.body?.itens });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'registrar uso');
  }
});

router.post('/ncm', limiteDoCadastro, async (req, res) => {
  try {
    const r = await cadastrarNcm({ user: req.user, corpo: req.body });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar NCM');
  }
});

router.post('/cest', limiteDoCadastro, async (req, res) => {
  try {
    const r = await cadastrarCest({ user: req.user, corpo: req.body });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'cadastrar CEST');
  }
});

module.exports = router;
