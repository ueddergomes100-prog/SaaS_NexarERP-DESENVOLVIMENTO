const express = require('express');
const { authenticate } = require('../middleware/auth');
const { alterarSituacao, excluirCadastro, ErroCadastro } = require('../services/cadastroIntegridade');

const router = express.Router();

// Tudo autenticado; o tenant sai do token de quem chamou, nunca do corpo.
// Ver services/cadastroIntegridade.js pro porque de isto morar no backend.
router.use(authenticate);

const responderErro = (res, erro, operacao) => {
  if (erro instanceof ErroCadastro) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Cadastros] ${operacao}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente em instantes.' });
};

/** Ativa ou inativa um cadastro, conferindo as pendencias antes. */
router.post('/situacao', async (req, res) => {
  try {
    const resultado = await alterarSituacao({
      user: req.user,
      colecao: req.body?.colecao,
      id: req.body?.id,
      ativo: req.body?.ativo,
    });
    return res.json({ ok: true, ...resultado });
  } catch (erro) {
    return responderErro(res, erro, 'situacao');
  }
});

/** Exclui um cadastro que nunca teve movimentacao. */
router.post('/excluir', async (req, res) => {
  try {
    const resultado = await excluirCadastro({ user: req.user, colecao: req.body?.colecao, id: req.body?.id });
    return res.json({ ok: true, ...resultado });
  } catch (erro) {
    return responderErro(res, erro, 'excluir');
  }
});

module.exports = router;
