const express = require('express');
const { authenticate } = require('../middleware/auth');
const { registrarLog } = require('../services/auditoria');
const { ErroModulos, salvarModulosBloqueados } = require('../services/modulosDoPlano');

/**
 * Painel da Plataforma (SuperAdmin), 28/10/2026: o que o dono da plataforma
 * muda numa empresa cliente sem precisar entrar no sistema dela.
 */
const router = express.Router();
router.use(authenticate);

router.put('/modulos-bloqueados', async (req, res) => {
  if (!req.user?.isPlatformAdmin) {
    return res.status(403).json({ error: 'Só o administrador da plataforma pode mudar os módulos de uma empresa.' });
  }
  try {
    const resultado = await salvarModulosBloqueados({ user: req.user, tenantId: req.body?.tenantId, modulos: req.body?.modulos });
    registrarLog(req.user, {
      modulo: 'plataforma',
      acao: 'modulos_bloqueados',
      descricao: `Módulos da empresa ${resultado.tenantId} atualizados (${resultado.modulosBloqueados.length} bloqueados${resultado.filiais ? `, ${resultado.filiais} filial(is) junto` : ''}).`,
      registroId: resultado.tenantId,
      alteracoes: { modulosBloqueados: resultado.modulosBloqueados },
      critico: true,
    });
    return res.json(resultado);
  } catch (erro) {
    if (erro instanceof ErroModulos) return res.status(erro.status).json({ error: erro.message });
    console.error('[Plataforma] modulos bloqueados falhou:', erro.message);
    return res.status(500).json({ error: 'Não foi possível salvar os módulos agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
