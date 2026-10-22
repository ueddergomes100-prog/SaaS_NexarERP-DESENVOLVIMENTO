const express = require('express');
const { limitadorPublico, limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const compras = require('../services/compras');

/**
 * LINK PUBLICO DA COTACAO (22/10/2026) -- o fornecedor abre sem login, com o
 * token do link e o codigo de acesso que a empresa mandou.
 *   POST /api/cotacoes-publicas/abrir      { token, codigo }
 *   POST /api/cotacoes-publicas/responder  { token, codigo, precos, prazoEntregaDias, condicaoPagamento, observacao }
 * Sem token do Firebase. Limites: por IP e por link (chutar o codigo nao vale).
 */
const router = express.Router();

const porIp = limitadorPublico('cotacao-publica', { limite: 60, mensagem: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
const porLink = limitadorPorChave('cotacao-link', (req) => String(req.body?.token || ''), {
  limite: 20,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Este link recebeu tentativas demais na última hora. Aguarde e tente de novo, ou peça outro link à empresa.',
});

const hojeNoBrasil = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

const responderErro = (res, erro, acao) => {
  if (erro instanceof compras.ErroCompras) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Cotação pública] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Tente de novo em instantes.` });
};

router.post('/abrir', porIp, porLink, async (req, res) => {
  try {
    return res.json(await compras.abrirPublica({ token: req.body?.token, codigo: req.body?.codigo, hoje: hojeNoBrasil() }));
  } catch (erro) {
    return responderErro(res, erro, 'abrir a cotação');
  }
});

router.post('/responder', porIp, porLink, async (req, res) => {
  try {
    return res.json(await compras.responderPublica({ token: req.body?.token, codigo: req.body?.codigo, corpo: req.body || {}, hoje: hojeNoBrasil() }));
  } catch (erro) {
    return responderErro(res, erro, 'enviar a proposta');
  }
});

module.exports = router;
