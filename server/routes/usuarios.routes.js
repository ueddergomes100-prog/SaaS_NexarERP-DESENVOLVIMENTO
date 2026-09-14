const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { redefinirSenhaAcesso, ErroSenhaAcesso } = require('../services/usuarioSenha');

const router = express.Router();

// Mesma trava das rotas de PIN (vendedorPin.routes.js): tudo autenticado, e
// o tenantId sai sempre do token de quem chamou, nunca do corpo.
router.use(authenticate);

/** Redefine a senha de ACESSO (login) de um funcionario. So administrador. */
router.post('/redefinir-senha', requireAdmin, async (req, res) => {
  try {
    const resultado = await redefinirSenhaAcesso({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
      novaSenha: req.body?.novaSenha,
    });
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    if (erro instanceof ErroSenhaAcesso) {
      return res.status(erro.status).json({ error: erro.message });
    }
    console.error('[Usuarios] redefinir-senha:', erro);
    return res.status(500).json({ error: 'Não foi possível redefinir a senha. Tente novamente.' });
  }
});

module.exports = router;
