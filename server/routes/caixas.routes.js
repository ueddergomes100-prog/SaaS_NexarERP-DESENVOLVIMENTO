const express = require('express');
const { db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const caixas = require('../services/caixas');
const { reabrirCaixaPdv } = require('../services/reaberturaCaixaPdv');
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
 *   GET  /api/caixas/gaveta             saldo da gaveta para conferir o fechamento do PDV (?ate= no fim de um dia)
 *   GET  /api/caixas/gaveta/composicao  o que compoe o saldo da gaveta, dia a dia
 *   POST /api/caixas/gaveta/cofre       { sessaoId, trocoCentavos } fechamento: o resto vai ao COFRE
 *   POST /api/caixas/gaveta/acerto      { data, contadoCentavos, trocoCentavos } acerto de um dia anterior
 * Permissao: "Financeiro: Caixas e Transferências" (dono/gestor sempre); a
 * sangria aceita tambem quem opera o PDV.
 */
const router = express.Router();
router.use(authenticate);

const PERMISSAO = 'financeiro.caixas';

const temPermissao = (user, permissao) => (
  Boolean(user.isPlatformAdmin || user.dono || (Array.isArray(user.permissoes) && user.permissoes.includes(permissao)))
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

// Fechamento do caixa (23/11/2026): quem opera o PDV ou ve as sessoes consulta o saldo da gaveta.
// `?ate=yyyy-mm-dd`: o saldo no fim daquele dia (fechar com a data de ontem, acerto de um dia; 24/11/2026).
router.get('/gaveta', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO, 'financeiro.caixa_registros', ...PERMISSOES_QUE_OPERAM_O_CAIXA])) return undefined;
  try {
    return res.json(await caixas.resumoDaGaveta({ user: req.user, tenantId: req.user.tenantId, ate: String(req.query.ate || '') }));
  } catch (erro) {
    return responderErro(res, erro, 'consultar o saldo da gaveta');
  }
});

// O que compoe o "Esperado agora", dia a dia (24/11/2026).
router.get('/gaveta/composicao', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO, 'financeiro.caixa_registros', ...PERMISSOES_QUE_OPERAM_O_CAIXA])) return undefined;
  try {
    return res.json(await caixas.composicaoDaGaveta({ user: req.user, tenantId: req.user.tenantId }));
  } catch (erro) {
    return responderErro(res, erro, 'montar o que compõe o saldo da gaveta');
  }
});

// Fechamento: o que foi contado menos o troco vai para o COFRE (quem fecha o caixa, inclusive o operador).
router.post('/gaveta/cofre', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO, 'financeiro.caixa_registros', ...PERMISSOES_QUE_OPERAM_O_CAIXA])) return undefined;
  try {
    const r = await caixas.cofreNoFechamento({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    if (!r.jaFeito && r.valorCentavos > 0) {
      registrarLog(req.user, {
        modulo: 'financeiro',
        acao: 'transferencia',
        descricao: `Fechamento do caixa: ${reais(r.valorCentavos)} para o ${r.cofreNome}; ficaram ${reais(r.trocoCentavos)} de troco na gaveta.`,
        registroId: String(req.body?.sessaoId || ''),
      });
    }
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'mandar o dinheiro do fechamento para o COFRE');
  }
});

// Acerto de um dia que ja' passou ("fechar o caixa de ontem"): so' quem cuida de Caixas e Transferencias.
router.post('/gaveta/acerto', async (req, res) => {
  if (!exigir(req, res, [PERMISSAO])) return undefined;
  try {
    const r = await caixas.acertarDiaDaGaveta({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'financeiro',
      acao: 'acerto_gaveta',
      descricao: `Acerto da gaveta de ${dataBr(r.data)}: sistema ${reais(r.saldoDoSistemaCentavos)}, contado ${reais(r.contadoCentavos)}, `
        + `diferença ${reais(r.diferencaCentavos)}, ${reais(r.paraCofreCentavos)} para o ${r.cofreNome || 'COFRE'}, troco ${reais(r.trocoCentavos)}.`,
      registroId: '',
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'acertar a gaveta');
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

/**
 * POST /api/caixas/reabrir-pdv -- { sessaoId }. Reabre o caixa da Frente de Caixa
 * fechado HOJE (27/11/2026). Regras em services/reaberturaCaixaPdv.js.
 */
router.post('/reabrir-pdv', async (req, res) => {
  try {
    const r = await reabrirCaixaPdv({ user: req.user, tenantId: req.user.tenantId, sessaoId: req.body?.sessaoId });
    return res.json({ ok: true, caixa: r });
  } catch (erro) {
    return responderErro(res, erro, 'reabrir o caixa');
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
    return res.json({ lancamentos: await caixas.extrato({ tenantId: req.user.tenantId, caixaId: req.params.id, dias: Number(req.query.dias) }) });
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
