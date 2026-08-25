const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { definirPin, removerPin, validarPin } = require('../services/vendedorPin');

const router = express.Router();

/**
 * Rotas do PIN do vendedor (identificacao na hora da venda).
 *
 * TODAS passam por `authenticate` -- sem excecao. Uma rota de PIN aberta
 * seria "qualquer pessoa na internet valida ou troca a senha de qualquer
 * funcionario, de qualquer empresa".
 *
 * Em nenhuma delas o `tenantId` vem do corpo da requisicao: ele sai sempre
 * do token de quem chamou (`req.user.tenantId`). E o que impede uma estacao
 * de uma empresa de tocar em vendedor de outra.
 */
router.use(authenticate);

const responderErro = (res, erro, contexto) => {
  if (erro && typeof erro.status === 'number') {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`[VendedorPin] ${contexto}:`, erro);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
};

/**
 * Valida codigo + PIN e devolve quem e' o vendedor.
 * Qualquer usuario autenticado da empresa pode chamar -- e' a estacao de
 * balcao (`balcao01`, ...) que chama, a cada venda.
 */
router.post('/validar', async (req, res) => {
  try {
    const resultado = await validarPin({
      tenantId: req.user.tenantId,
      codigo: req.body?.codigo,
      pin: req.body?.pin,
    });
    return res.json(resultado);
  } catch (erro) {
    return responderErro(res, erro, 'validar');
  }
});

/**
 * Define ou RESETA o PIN de um funcionario. So administrador da empresa.
 * O reset e' o caminho pra quem esqueceu a senha -- antes disto, o sistema
 * nao tinha nenhum.
 */
router.post('/definir', requireAdmin, async (req, res) => {
  try {
    const resultado = await definirPin({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
      pin: req.body?.pin,
      autorId: req.user.uid,
    });
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'definir');
  }
});

/** Remove o PIN (funcionario deixa de poder ser identificado na venda). */
router.post('/remover', requireAdmin, async (req, res) => {
  try {
    const resultado = await removerPin({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
    });
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'remover');
  }
});

module.exports = router;
