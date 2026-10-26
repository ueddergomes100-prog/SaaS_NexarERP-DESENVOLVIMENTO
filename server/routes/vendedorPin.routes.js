const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { definirPin, removerPin, validarPin } = require('../services/vendedorPin');
const { emitirComprovante } = require('../services/comprovantes');
const { TIPO_IDENTIFICACAO } = require('../domain/conferenciaDescontoDomain');
const { gerentePodeGerir } = require('../middleware/gestaoEquipe');

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
    // Venda pelo servidor (19/10/2026): com a identificacao exigida, o Finalizar
    // gasta este comprovante -- prova que o vendedor da venda digitou o PIN.
    if (req.body?.emitirComprovante === true) {
      const comprovante = await emitirComprovante({
        tenantId: req.user.tenantId,
        emitidoPara: req.user.uid,
        tipo: TIPO_IDENTIFICACAO,
        pessoaId: resultado.vendedorId,
        pessoaNome: resultado.vendedorNome,
      });
      return res.json({ ...resultado, comprovanteId: comprovante.comprovanteId });
    }
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
// 21/10/2026: alem do dono/administrador, quem tem "Cadastros: Vendedores — incluir e
// alterar" define a senha -- so' de vendedor de balcao COMUM (ver definirPin, `restrito`).
const PERMISSAO_INCLUIR_VENDEDOR = 'cadastros.vendedores_incluir';
const ehGestor = (user) => Boolean(user && (user.isPlatformAdmin || user.isTenantManager));
const podeDefinirPin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Usuario nao autenticado.' });
  if (ehGestor(req.user)) return next();
  // 26/10/2026: o gerente (Equipe e Acessos) define o PIN de funcionario comum, sem a restricao de "so' balcao".
  try {
    if (await gerentePodeGerir(req.user, req.body?.usuarioId)) {
      req.gerenteDaEquipe = true;
      return next();
    }
  } catch (erro) {
    console.error('[PIN] conferir gerente:', erro);
  }
  if ((req.user.permissoes || []).includes(PERMISSAO_INCLUIR_VENDEDOR)) return next();
  return res.status(403).json({ error: 'Só o dono, um gerente da equipe ou quem tem a permissão "Cadastros: Vendedores — incluir e alterar" define a senha do vendedor.' });
};

router.post('/definir', podeDefinirPin, async (req, res) => {
  try {
    const resultado = await definirPin({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
      pin: req.body?.pin,
      autorId: req.user.uid,
      restrito: !ehGestor(req.user) && !req.gerenteDaEquipe,
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
