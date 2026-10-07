const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { ErroNumeracao, listarNumeracao, ajustarNumeracao } = require('../services/numeracao');

/**
 * NUMERACAO DOS DOCUMENTOS (Configuracoes por filial, fase C) -- ver
 * services/numeracao.js. So' dono/administrador; vale para a filial ativa.
 *   GET /api/numeracao            ultimo e proximo numero de cada documento
 *   PUT /api/numeracao/:chave     adianta a sequencia ({ proximo })
 */
const router = express.Router();
router.use(authenticate);

const responderErro = (res, erro, acao) => {
  if (erro instanceof ErroNumeracao) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Numeracao] erro ao ${acao}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${acao}. Tente de novo em instantes.` });
};

router.get('/', async (req, res) => {
  try {
    return res.json(await listarNumeracao({ user: req.user }));
  } catch (erro) {
    return responderErro(res, erro, 'ler a numeração dos documentos');
  }
});

router.put('/:chave', async (req, res) => {
  try {
    const r = await ajustarNumeracao({
      user: req.user,
      chave: req.params.chave,
      proximo: req.body ? req.body.proximo : undefined,
      nomeUsuario: String(req.user.nome || req.user.email || req.user.uid),
    });
    registrarLog(req.user, {
      modulo: 'configuracoes',
      acao: 'edicao',
      descricao: `Numeração de ${r.rotulo.toLowerCase()} adiantada: último ${r.antes} → próximo ${r.proximo}`,
      registroId: String(req.params.chave),
    });
    return res.json(r);
  } catch (erro) {
    return responderErro(res, erro, 'ajustar a numeração');
  }
});

module.exports = router;
