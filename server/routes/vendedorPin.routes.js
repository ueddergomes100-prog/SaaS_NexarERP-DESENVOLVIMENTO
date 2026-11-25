const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { definirPin, removerPin, validarPin } = require('../services/vendedorPin');
const { emitirComprovante } = require('../services/comprovantes');
const { TIPO_IDENTIFICACAO } = require('../domain/conferenciaDescontoDomain');
const { gerentePodeGerir, motivoGestorNaoPodeNoAlvo } = require('../middleware/gestaoEquipe');
const { encerrarSessoes } = require('../services/sessoes');
const { db } = require('../config/firebase');
const { registrarLog } = require('../services/auditoria');

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

/**
 * Historico de alteracoes (09/11/2026): quem definiu ou removeu a senha de
 * qual vendedor. NUNCA o valor da senha. Nao segura a resposta: le' o nome do
 * vendedor e grava em seguida (falha so' vai pro console).
 */
const registrarSenhaNoHistorico = (user, usuarioId, acao, texto) => {
  void (async () => {
    let nome = '';
    let codigo = '';
    try {
      const snap = await db.collection('usuarios').doc(String(usuarioId || '')).get();
      if (snap.exists) {
        nome = String(snap.data().nome || '');
        codigo = String(snap.data().codigoVendedor || '');
      }
    } catch (erro) {
      console.error('[VendedorPin] historico: nao leu o vendedor:', erro.message);
    }
    const quem = `${nome || 'Vendedor'}${codigo ? ` (código ${codigo})` : ''}`;
    await registrarLog(user, {
      modulo: 'usuarios',
      acao,
      descricao: `Senha de identificação de ${quem} ${texto}.`,
      registroId: String(usuarioId || ''),
      documentoTipo: 'vendedor',
      documentoNumero: `Vendedor ${quem}`,
      alteracoes: [{ campo: 'Senha de identificação (PIN)', valorAnterior: null, valorNovo: texto }],
    });
  })();
};

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
      canal: 'balcao',
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
const { podeEmVendas, mensagemSemPermissao } = require('../services/permissoesVendas');
const { PERMISSAO_VENDAS } = require('../domain/permissoesNovasDomain');
const ehGestor = (user) => Boolean(user && (user.isPlatformAdmin || user.isTenantManager));
const podeDefinirPin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Usuario nao autenticado.' });
  if (ehGestor(req.user)) {
    // Bloco B (25/11/2026): PIN do dono so' ele; de administrador, so' o dono.
    try {
      const motivo = await motivoGestorNaoPodeNoAlvo(req.user, req.body?.usuarioId);
      if (motivo) return res.status(403).json({ error: motivo });
    } catch (erro) {
      console.error('[PIN] conferir o alvo:', erro);
      return res.status(500).json({ error: 'Não foi possível conferir sua permissão agora. Tente de novo em instantes.' });
    }
    return next();
  }
  // 26/10/2026: o gerente (Equipe e Acessos) define o PIN de funcionario comum, sem a restricao de "so' balcao".
  try {
    if (await gerentePodeGerir(req.user, req.body?.usuarioId)) {
      req.gerenteDaEquipe = true;
      return next();
    }
  } catch (erro) {
    console.error('[PIN] conferir gerente:', erro);
  }
  // Item 15 (25/11/2026): a permissao propria (que estava no catalogo sem ninguem
  // conferir). Quem tinha "Cadastros: Vendedores — incluir" ja' vem com ela (pacote 'vendas-1').
  if (podeEmVendas(req.user, PERMISSAO_VENDAS.gerenciarPinVendedor)) return next();
  return res.status(403).json({ error: mensagemSemPermissao([PERMISSAO_VENDAS.gerenciarPinVendedor]) });
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
    registrarSenhaNoHistorico(req.user, resultado.usuarioId, 'edicao', 'definida');
    // Bloco B: senha trocada derruba quem ja' tinha entrado com ela (menos quem trocou a propria).
    if (resultado.usuarioId !== req.user.uid) await encerrarSessoes([resultado.usuarioId], 'senha de vendedor trocada');
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'definir');
  }
});

/** Remove o PIN (funcionario deixa de poder ser identificado na venda). */
router.post('/remover', requireAdmin, async (req, res) => {
  try {
    const motivo = await motivoGestorNaoPodeNoAlvo(req.user, req.body?.usuarioId);
    if (motivo) return res.status(403).json({ error: motivo });
    const resultado = await removerPin({
      tenantId: req.user.tenantId,
      usuarioId: req.body?.usuarioId,
    });
    if (resultado.removido) {
      registrarSenhaNoHistorico(req.user, req.body?.usuarioId, 'exclusao', 'removida');
      if (String(req.body?.usuarioId) !== req.user.uid) await encerrarSessoes([String(req.body?.usuarioId)], 'senha de vendedor removida');
    }
    return res.json({ ...resultado, ok: true });
  } catch (erro) {
    return responderErro(res, erro, 'remover');
  }
});

module.exports = router;
