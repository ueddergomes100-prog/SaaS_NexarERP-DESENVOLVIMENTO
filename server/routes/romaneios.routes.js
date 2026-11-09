const express = require('express');
const { db } = require('../config/firebase');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { ErroRomaneio, fecharRomaneio, reabrirRomaneio, cancelarRomaneio } = require('../services/romaneios');
const { rotasAbertas, colocarPedidoNaRota } = require('../services/rotaPreVenda');

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
  // O middleware ja' traz o nome do cadastro (09/11/2026); a leitura fica de reserva.
  usuarioNome: req.user.nome && req.user.nome !== req.user.email ? req.user.nome : await nomeDoUsuario(req.user),
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
        // Aparece tambem no historico da rota (09/11/2026).
        documentosRelacionados: [r.rota.id],
        documentoTipo: 'pedido',
      });
    }
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'colocar o pedido na rota');
  }
});

// Fechar, reabrir e cancelar gravam o Historico de alteracoes DENTRO da
// transacao (services/romaneios.js, 09/11/2026): ou grava os dois, ou nenhum.
router.post('/fechar', async (req, res) => {
  try {
    const r = await fecharRomaneio({ ...(await contexto(req)), corpo: req.body || {} });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'fechar o acerto');
  }
});

router.post('/reabrir', async (req, res) => {
  try {
    const r = await reabrirRomaneio({ ...(await contexto(req)), motivo: req.body?.motivo });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'reabrir o romaneio');
  }
});

router.post('/cancelar', async (req, res) => {
  try {
    const r = await cancelarRomaneio({ ...(await contexto(req)), motivo: req.body?.motivo });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'cancelar o romaneio');
  }
});

module.exports = router;
