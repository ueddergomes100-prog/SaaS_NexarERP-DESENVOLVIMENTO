const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { liberarDesconto } = require('../services/liberacaoDesconto');
const remota = require('../services/liberacaoRemota');
const { NOME_DA_TELA } = require('../domain/conferenciaDescontoDomain');
const { NOME_DA_TELA_REMOTA } = require('../domain/liberacaoRemotaDomain');

/**
 * LIBERACAO DE DESCONTO (19/10/2026): a senha/PIN do aprovador e' conferida
 * aqui e vira um comprovante de curta duracao. Ver services/liberacaoDesconto.js.
 * O tenant vem sempre do token de quem chamou (a estacao), nunca do corpo.
 *
 * PELO CELULAR (21/10/2026) -- ver services/liberacaoRemota.js:
 *   POST /api/descontos/pedir-liberacao            a estacao pede ao gerente
 *   GET  /api/descontos/liberacoes/pendentes       tela Liberacoes do app
 *   GET  /api/descontos/liberacoes/:id             a estacao acompanha
 *   POST /api/descontos/liberacoes/:id/cancelar    o vendedor desistiu
 *   POST /api/descontos/liberacoes/:id/responder   o gerente aprova/recusa (senha ou PIN)
 */
const router = express.Router();
router.use(authenticate);

const reais = (centavos) => `R$ ${(Number(centavos) / 100).toFixed(2).replace('.', ',')}`;

const responderErroRemoto = (res, erro, acao) => {
  if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
  console.error(`[Descontos] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Tente de novo em instantes.` });
};

router.post('/pedir-liberacao', async (req, res) => {
  try {
    const r = await remota.pedir({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: req.body?.tela === 'os' ? 'mecanica' : 'vendas',
      acao: 'pedido_liberacao_desconto',
      descricao: `Pedido de liberação pelo celular: desconto de ${reais(req.body?.descontoCentavos)} sobre ${reais(req.body?.baseCentavos)} (${NOME_DA_TELA_REMOTA[req.body?.tela] || 'tela'}${req.body?.documento ? `, ${String(req.body.documento).slice(0, 120)}` : ''}). ${r.aparelhosAvisados} aparelho(s) avisado(s).`,
      registroId: r.id,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroRemoto(res, erro, 'pedir a liberação ao gerente');
  }
});

router.get('/liberacoes/pendentes', async (req, res) => {
  try {
    return res.json({ liberacoes: await remota.pendentes({ user: req.user, tenantId: req.user.tenantId }) });
  } catch (erro) {
    return responderErroRemoto(res, erro, 'ler os pedidos de liberação');
  }
});

router.get('/liberacoes/:id', async (req, res) => {
  try {
    return res.json(await remota.consultar({ user: req.user, tenantId: req.user.tenantId, id: req.params.id }));
  } catch (erro) {
    return responderErroRemoto(res, erro, 'consultar o pedido de liberação');
  }
});

router.post('/liberacoes/:id/cancelar', async (req, res) => {
  try {
    return res.json(await remota.cancelar({ user: req.user, tenantId: req.user.tenantId, id: req.params.id }));
  } catch (erro) {
    return responderErroRemoto(res, erro, 'cancelar o pedido de liberação');
  }
});

router.post('/liberacoes/:id/responder', async (req, res) => {
  try {
    const r = await remota.responder({ user: req.user, tenantId: req.user.tenantId, id: req.params.id, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: r.tela === 'os' ? 'mecanica' : 'vendas',
      acao: 'aprovacao_desconto',
      descricao: r.decisao === 'aprovar'
        ? `Desconto de ${reais(r.descontoCentavos)} sobre ${reais(r.baseCentavos)} liberado pelo celular por ${r.aprovadorNome} (${NOME_DA_TELA_REMOTA[r.tela]}, pedido de ${r.solicitanteNome}), conferido pelo servidor.`
        : `Desconto de ${reais(r.descontoCentavos)} sobre ${reais(r.baseCentavos)} recusado pelo celular por ${r.aprovadorNome} (${NOME_DA_TELA_REMOTA[r.tela]}, pedido de ${r.solicitanteNome})${req.body?.motivoRecusa ? `. Motivo: ${String(req.body.motivoRecusa).slice(0, 200)}` : ''}.`,
      registroId: r.id,
      vendedorId: req.user.uid,
      vendedorNome: r.aprovadorNome,
      critico: r.decisao === 'aprovar',
    });
    return res.json(r);
  } catch (erro) {
    return responderErroRemoto(res, erro, 'responder o pedido de liberação');
  }
});

/** POST /api/descontos/liberar -- { tela, baseCentavos, descontoCentavos, aprovador }. */
router.post('/liberar', async (req, res) => {
  try {
    const r = await liberarDesconto({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: r.tela === 'os' ? 'mecanica' : 'vendas',
      acao: 'aprovacao_desconto',
      descricao: `Desconto de ${reais(req.body.descontoCentavos)} sobre ${reais(req.body.baseCentavos)} liberado por ${r.aprovadoPorNome} (${NOME_DA_TELA[r.tela]}), conferido pelo servidor.`,
      registroId: r.comprovanteId,
      vendedorId: r.aprovadoPorId,
      vendedorNome: r.aprovadoPorNome,
      critico: true,
    });
    return res.json({ ok: true, comprovanteId: r.comprovanteId, validoAteMs: r.validoAteMs, aprovadoPorId: r.aprovadoPorId, aprovadoPorNome: r.aprovadoPorNome });
  } catch (erro) {
    if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
    console.error('[Descontos] erro ao liberar:', erro);
    return res.status(500).json({ error: 'Não foi possível conferir a liberação agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
