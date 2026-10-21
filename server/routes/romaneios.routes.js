const express = require('express');
const { db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { ErroRomaneio, fecharRomaneio, reabrirRomaneio, cancelarRomaneio } = require('../services/romaneios');
const { rotasAbertas, colocarPedidoNaRota } = require('../services/rotaPreVenda');
const { textoDoPlano } = require('../domain/romaneioDomain');

/**
 * ROMANEIO DE ENTREGA (15/10/2026) -- ver services/romaneios.js.
 *   POST /api/romaneios/fechar     fecha o acerto (as despesas lancadas acompanham)
 *   POST /api/romaneios/reabrir    rota fechada volta a "Em rota" (permissao propria + motivo)
 *   POST /api/romaneios/cancelar   cancela; fechada ou com entrega desfaz tudo (permissao propria + motivo)
 * Rota na pre-venda (21/10/2026) -- ver services/rotaPreVenda.js:
 *   GET  /api/romaneios/abertos         rotas em montagem (pra tela perguntar "Rota 1 ou 2?")
 *   POST /api/romaneios/colocar-pedido  { pedidoId, romaneioId? } coloca/anota conforme a configuracao
 * Tudo vai para o log de auditoria (modulo "romaneios").
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroRomaneio) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Romaneios] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Nada foi alterado. Tente de novo em instantes.` });
};

// Fora da transacao: o nome so' vai para o historico da rota.
const nomeDoUsuario = async (user) => {
  try {
    const snap = await db.collection('usuarios').doc(user.uid).get();
    const dados = snap.exists ? snap.data() : {};
    return String(dados.nome || dados.nomeResponsavel || user.email || 'Usuário').trim();
  } catch {
    return String(user.email || 'Usuário');
  }
};

const contexto = async (req) => ({
  user: req.user,
  id: req.body?.id,
  usuarioNome: await nomeDoUsuario(req.user),
  agoraIso: new Date().toISOString(),
});

router.get('/abertos', async (req, res) => {
  try {
    return res.json({ rotas: await rotasAbertas(req.user.tenantId) });
  } catch (erro) {
    return responderErro(res, erro, 'ler as rotas em montagem');
  }
});

router.post('/colocar-pedido', async (req, res) => {
  try {
    const r = await colocarPedidoNaRota({
      user: req.user,
      tenantId: req.user.tenantId,
      pedidoId: req.body?.pedidoId,
      romaneioId: req.body?.romaneioId,
    });
    if (r.acao === 'colocado' || r.acao === 'anotada') {
      registrarLog(req.user, {
        modulo: 'romaneios',
        acao: 'pedido_na_rota',
        descricao: r.acao === 'colocado'
          ? `Pedido colocado na ${r.rota.titulo} ao gravar a pré-venda.`
          : `Pré-venda anotada para a ${r.rota.titulo} (entra na rota ao faturar).`,
        registroId: String(req.body?.pedidoId || ''),
      });
    }
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'colocar o pedido na rota');
  }
});

router.post('/fechar', async (req, res) => {
  try {
    const r = await fecharRomaneio({ ...(await contexto(req)), corpo: req.body || {} });
    const financeiro = textoDoPlano(r.contagem);
    registrarLog(req.user, {
      modulo: 'romaneios',
      acao: 'fechamento',
      descricao: r.refechamento
        ? `${r.titulo}: acerto fechado de novo depois de reaberto${r.alteracoes.length ? ` (${r.alteracoes.length} alteração(ões))` : ' (sem alteração)'}${financeiro ? `. Financeiro: ${financeiro}` : ''}`
        : `${r.titulo}: acerto fechado${financeiro ? `. Financeiro: ${financeiro}` : ''}`,
      registroId: String(req.body.id),
      alteracoes: r.alteracoes.length ? r.alteracoes : null,
      critico: r.refechamento,
    });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'fechar o acerto');
  }
});

router.post('/reabrir', async (req, res) => {
  try {
    const r = await reabrirRomaneio({ ...(await contexto(req)), motivo: req.body?.motivo });
    const fora = r.saem.length ? ` Ficaram de fora (já estão em outra rota): ${r.saem.map((s) => `#${s.numeroPedido} na ${s.outraRota}`).join(', ')}.` : '';
    registrarLog(req.user, {
      modulo: 'romaneios',
      acao: 'reabertura',
      descricao: `${r.titulo} reaberta. Motivo: ${String(req.body.motivo).trim()}.${fora}`,
      registroId: String(req.body.id),
      critico: true,
    });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'reabrir o romaneio');
  }
});

router.post('/cancelar', async (req, res) => {
  try {
    const r = await cancelarRomaneio({ ...(await contexto(req)), motivo: req.body?.motivo });
    const motivo = String(req.body?.motivo || '').trim();
    registrarLog(req.user, {
      modulo: 'romaneios',
      acao: 'cancelamento',
      descricao: [
        `${r.titulo} cancelada${r.statusAnterior === 'fechado' ? ' depois de fechada' : ''}.`,
        motivo ? `Motivo: ${motivo}.` : '',
        r.desfez ? `${r.liberados} pedido(s) liberado(s) para outra rota.` : '',
        r.despesasCanceladas ? `${r.despesasCanceladas} despesa(s) cancelada(s) no financeiro.` : '',
      ].filter(Boolean).join(' '),
      registroId: String(req.body.id),
      critico: true,
    });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'cancelar o romaneio');
  }
});

module.exports = router;
