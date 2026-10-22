const express = require('express');
const { db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const caixas = require('../services/caixas');
const { PERMISSOES_QUE_OPERAM_O_CAIXA } = require('../domain/frenteDeCaixaDomain');

/**
 * CAIXAS E TRANSFERENCIAS (21/10/2026) -- ver services/caixas.js.
 *   GET  /api/caixas                    caixas (cria CAIXA e COFRE na primeira vez) + bancos
 *   POST /api/caixas                    { nome, descricao, saldoInicialCentavos, ativo } cria
 *   POST /api/caixas/:id                altera nome/descricao/ativo
 *   GET  /api/caixas/:id/extrato        lancamentos do caixa
 *   POST /api/caixas/:id/lancamento     { direcao, valorCentavos, descricao, data }
 *   POST /api/caixas/transferir         { origem:{tipo,id}, destino:{tipo,id}, valorCentavos, data, descricao }
 *   POST /api/caixas/sangria-deposito   PDV: { bancoId, valorCentavos, sessaoId, data }
 * Permissao: "Financeiro: Caixas e Transferências" (dono/gestor sempre); a
 * sangria aceita tambem quem opera o PDV.
 */
const router = express.Router();
router.use(authenticate);

const PERMISSAO = 'financeiro.caixas';

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.isTenantManager || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
);

const exigir = (req, res, permissoes) => {
  if (permissoes.some((p) => temPermissao(req.user, p))) return true;
  res.status(403).json({ error: 'Você não tem permissão para Caixas e Transferências. Peça a um responsável liberar "Financeiro: Caixas e Transferências" no seu usuário.' });
  return false;
};

const responderErro = (res, erro, acao) => {
  if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
  console.error(`[Caixas] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Nada foi alterado. Tente de novo em instantes.` });
};

const reais = (centavos) => `R$ ${(Number(centavos) / 100).toFixed(2).replace('.', ',')}`;
const dataBr = (iso) => String(iso || '').split('-').reverse().join('/');

router.get('/', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    return res.json(await caixas.listar({ user: req.user, tenantId: req.user.tenantId }));
  } catch (erro) {
    return responderErro(res, erro, 'ler os caixas');
  }
});

router.post('/transferir', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    const r = await caixas.transferir({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'financeiro',
      acao: 'transferencia',
      descricao: `Transferência de ${reais(r.valorCentavos)} de ${r.nomeOrigem} para ${r.nomeDestino} em ${dataBr(r.data)}.`,
      registroId: String(req.body?.origem?.id || ''),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'fazer a transferência');
  }
});

router.post('/sangria-deposito', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO, ...PERMISSOES_QUE_OPERAM_O_CAIXA])) return undefined;
  try {
    let operadorNome = '';
    try {
      const snap = await db.collection('usuarios').doc(req.user.uid).get();
      operadorNome = snap.exists ? String(snap.data().nome || snap.data().nomeResponsavel || '') : '';
    } catch { operadorNome = ''; }
    const r = await caixas.sangriaParaDeposito({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {}, operadorNome });
    registrarLog(req.user, {
      modulo: 'financeiro',
      acao: 'sangria_deposito',
      descricao: `Sangria do PDV de ${reais(r.valorCentavos)} depositada no banco ${r.bancoNome}.`,
      registroId: String(req.body?.sessaoId || ''),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'registrar o depósito da sangria');
  }
});

router.post('/', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    const r = await caixas.salvar({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, { modulo: 'financeiro', acao: 'criacao', descricao: `Caixa ${r.nome} criado.`, registroId: r.id });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'salvar o caixa');
  }
});

router.post('/:id', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    const r = await caixas.salvar({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, corpo: req.body || {} });
    registrarLog(req.user, { modulo: 'financeiro', acao: 'edicao', descricao: `Caixa ${r.nome} alterado.`, registroId: r.id });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'salvar o caixa');
  }
});

router.get('/:id/extrato', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    return res.json({ lancamentos: await caixas.extrato({ tenantId: req.user.tenantId, caixaId: req.params.id }) });
  } catch (erro) {
    return responderErro(res, erro, 'ler o extrato do caixa');
  }
});

router.post('/:id/lancamento', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    const r = await caixas.lancar({ user: req.user, tenantId: req.user.tenantId, caixaId: req.params.id, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'financeiro',
      acao: 'lancamento_caixa',
      descricao: `${r.direcao === 'credito' ? 'Entrada' : 'Saída'} de ${reais(r.valorCentavos)} no ${r.caixaNome} em ${dataBr(r.data)}: ${r.descricao}`,
      registroId: String(req.params.id),
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'registrar o lançamento');
  }
});

module.exports = router;
