const express = require('express');
const { authenticate } = require('../middleware/auth');
const { limitadorPublico, limitadorPorChave } = require('../middleware/rateLimit');
const { registrarLog } = require('../services/auditoria');
const terminais = require('../services/terminaisCaixa');

/**
 * COMPUTADOR DO CAIXA (22/11/2026) -- ver services/terminaisCaixa.js.
 *   POST /api/caixa-terminal/entrar          PUBLICA: { terminalId, segredo, codigo, pin } -> { token }
 *   POST /api/caixa-terminal/ativar          logado (dono/admin): { nome } -> terminal + segredo
 *   GET  /api/caixa-terminal                 logado (dono/admin): computadores da empresa
 *   POST /api/caixa-terminal/:id/desativar   logado (dono/admin)
 */
const router = express.Router();

const responderErro = (res, erro, acao) => {
  if (erro && typeof erro.status === 'number') return res.status(erro.status).json({ error: erro.message });
  console.error(`[TerminaisCaixa] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao} agora. Tente de novo em instantes.` });
};

// Entrada: alem do bloqueio por funcionario (validarPin), limite por IP e por
// computador -- o mesmo desenho do login do app Vendas.
const limitePorIp = limitadorPublico('caixa-terminal-ip', { limite: 30 });
const limitePorTerminal = limitadorPorChave(
  'caixa-terminal-codigo',
  (req) => `${String(req.body?.terminalId || '').slice(0, 40)}-${String(req.body?.codigo || '').replace(/\D/g, '').slice(0, 4)}`,
  { limite: 10, mensagem: 'Muitas tentativas de entrar com este código. Aguarde alguns minutos e tente de novo.' },
);

router.post('/entrar', limitePorIp, limitePorTerminal, async (req, res) => {
  try {
    const resultado = await terminais.entrarComCodigo({
      terminalId: req.body?.terminalId,
      segredo: req.body?.segredo,
      codigo: req.body?.codigo,
      pin: req.body?.pin,
    });
    return res.json(resultado);
  } catch (erro) {
    return responderErro(res, erro, 'entrar no caixa');
  }
});

router.post('/ativar', authenticate, async (req, res) => {
  try {
    const terminal = await terminais.ativarTerminal({ user: req.user, nome: req.body?.nome });
    registrarLog(req.user, {
      modulo: 'vendas',
      acao: 'criacao',
      descricao: `Ativou o computador "${terminal.nome}" como caixa (entrada com código e senha).`,
      registroId: terminal.terminalId,
      documentoTipo: 'terminal_caixa',
      documentoNumero: terminal.nome,
    });
    return res.status(201).json(terminal);
  } catch (erro) {
    return responderErro(res, erro, 'ativar o computador como caixa');
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    return res.json({ terminais: await terminais.listarTerminais({ user: req.user }) });
  } catch (erro) {
    return responderErro(res, erro, 'listar os computadores do caixa');
  }
});

router.post('/:id/desativar', authenticate, async (req, res) => {
  try {
    const terminal = await terminais.desativarTerminal({ user: req.user, terminalId: req.params.id });
    registrarLog(req.user, {
      modulo: 'vendas',
      acao: 'edicao',
      descricao: `Desativou o computador "${terminal.nome}" do caixa: ninguém mais entra nele com código e senha até ser ativado de novo.`,
      registroId: terminal.id,
      documentoTipo: 'terminal_caixa',
      documentoNumero: terminal.nome,
    });
    return res.json({ ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'desativar o computador do caixa');
  }
});

module.exports = router;
