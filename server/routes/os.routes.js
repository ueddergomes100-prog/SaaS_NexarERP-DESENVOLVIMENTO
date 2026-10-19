const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { fromCents } = require('../domain/financeDomain');
const { ErroVenda, temPermissao } = require('../services/vendaFechamento');
const { cancelarOs, finalizarOs, reabrirOs } = require('../services/osServidor');

/**
 * ORDEM DE SERVICO -- finalizar, reabrir e cancelar pelo servidor (item 8 da
 * auditoria, fatia 3d -- 19/10/2026). Ver services/osServidor.js. Usado pela
 * tela da OS quando a empresa tem a chave "Venda pelo servidor" ligada.
 */
const router = express.Router();
router.use(authenticate);

/** Empresa da operacao: a do token (a filial ativa). Admin da plataforma pode escolher. */
const empresaDaOperacao = (user, corpo) => {
  const pedida = typeof corpo?.tenantId === 'string' ? corpo.tenantId.trim() : '';
  if (!pedida || pedida === user.tenantId) return user.tenantId;
  if (user.isPlatformAdmin) return pedida;
  throw new ErroVenda(403, 'Você não pode mexer em OS de outra empresa.');
};

const reais = (centavos) => `R$ ${fromCents(centavos).toFixed(2).replace('.', ',')}`;

const SEM_PERMISSAO = 'Você não tem permissão para mexer em Ordens de Serviço. Peça a um responsável liberar "Serviços: Ordens de Serviço" no seu usuário.';

const responderErro = (res, erro, oQue) => {
  if (erro instanceof ErroVenda) return res.status(erro.status).json({ error: erro.message });
  console.error(`[OS] erro ao ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

/** POST /api/os/finalizar -- { osId, dataSaida, pagamentos, lotes? }. A OS ja' foi gravada pela tela. */
router.post('/finalizar', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'mecanica.os')) return res.status(403).json({ error: SEM_PERMISSAO });
    const r = await finalizarOs({ user: req.user, tenantId, corpo: req.body || {} });
    if (!r.jaEnviado) {
      registrarLog({ ...req.user, tenantId }, {
        modulo: 'mecanica',
        acao: 'edicao',
        descricao: `OS #${r.numeroOS} finalizada pelo servidor no valor de ${reais(r.totalCentavos)} (${r.formaPagamento}). Cliente: ${r.clienteNome || 'não informado'}.`,
        registroId: r.osId,
        vendedorId: r.mecanicoId,
        vendedorNome: r.mecanicoNome,
      });
    }
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'finalizar a OS');
  }
});

/** POST /api/os/reabrir -- { osId, status }. Desfaz a finalizacao (bloqueado com parcela ja' recebida). */
router.post('/reabrir', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'mecanica.os')) return res.status(403).json({ error: SEM_PERMISSAO });
    const r = await reabrirOs({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'mecanica',
      acao: 'edicao',
      descricao: `OS #${r.numeroOS} reaberta (situação "${r.status}"). Lançamentos cancelados e crédito do banco estornado${r.pecasDevolvidas ? '; peças de volta ao estoque' : ''}. Valor era ${reais(r.totalCentavos)}.`,
      registroId: r.osId,
      vendedorId: r.mecanicoId,
      vendedorNome: r.mecanicoNome,
      alteracoes: [{ campo: 'status', valorAnterior: 'Finalizada', valorNovo: r.status }],
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErro(res, erro, 'reabrir a OS');
  }
});

/** POST /api/os/cancelar -- { osId, motivo, devolverEstoque }. Bloqueado com nota fiscal autorizada. */
router.post('/cancelar', async (req, res) => {
  try {
    const tenantId = empresaDaOperacao(req.user, req.body);
    if (!temPermissao(req.user, 'mecanica.os')) return res.status(403).json({ error: SEM_PERMISSAO });
    const r = await cancelarOs({ user: req.user, tenantId, corpo: req.body || {} });
    registrarLog({ ...req.user, tenantId }, {
      modulo: 'mecanica',
      acao: 'cancelamento',
      descricao: `OS #${r.numeroOS} CANCELADA${r.devolveuEstoque ? ' e peças devolvidas ao estoque' : ''}. Motivo: ${String(req.body.motivo).trim()}.`,
      registroId: r.osId,
      vendedorId: r.mecanicoId,
      vendedorNome: r.mecanicoNome,
      snapshotExcluido: r.snapshot,
      critico: true,
    });
    const { snapshot, ...resposta } = r;
    return res.json({ ok: true, ...resposta });
  } catch (erro) {
    return responderErro(res, erro, 'cancelar a OS');
  }
});

module.exports = router;
