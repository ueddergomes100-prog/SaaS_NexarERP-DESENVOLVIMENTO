const express = require('express');
const { authenticate } = require('../middleware/auth');
const { redefinirSenhaAcesso, ErroSenhaAcesso } = require('../services/usuarioSenha');
const { ErroLimite, criarLogin, alterarAcessoApp, vincularMotorista, editarFicha, alterarSituacao } = require('../services/limitesDoPlano');
const { podeGerirFuncionario } = require('../middleware/gestaoEquipe');
const { registrarLog } = require('../services/auditoria');
const { podeCriarLoginDeEquipe } = require('../domain/visibilidadeVendasDomain');

const router = express.Router();

// Mesma trava das rotas de PIN (vendedorPin.routes.js): tudo autenticado, e
// o tenantId sai sempre do token de quem chamou, nunca do corpo.
router.use(authenticate);

/** Redefine a senha de ACESSO (login) de um funcionario. Dono/administrador, ou gerente sobre funcionario comum (26/10/2026). */
router.post('/redefinir-senha', podeGerirFuncionario, async (req, res) => {
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

// Limites do plano (19/10/2026): criar login e ligar o app Vendas so' pelo
// servidor, que confere o limite contratado. Ver services/limitesDoPlano.js.
const soAdministrador = (req, res, next) => {
  if (req.user && (req.user.isPlatformAdmin || req.user.isTenantManager)) return next();
  return res.status(403).json({ error: 'Só o dono ou um administrador da empresa pode criar logins e liberar o aplicativo mobile.' });
};

// Criar login (26/10/2026): tambem o Gerente com Equipe e Acessos liberada. O
// login nasce Funcionario comum, sem permissao (services/limitesDoPlano.js).
const podeCriarLogin = (req, res, next) => {
  const u = req.user;
  if (u && (u.isPlatformAdmin || podeCriarLoginDeEquipe({ role: u.role, isOwner: false, nivelAcesso: u.nivelAcesso, permissoes: u.permissoes }))) return next();
  return res.status(403).json({ error: 'Só o dono, um administrador ou um gerente com "Admin: Equipe e Acessos" liberado pode criar logins.' });
};

const responderErroLimite =(res, erro, oQue) => {
  if (erro instanceof ErroLimite) return res.status(erro.status).json({ error: erro.message });
  console.error(`[Usuarios] ${oQue}:`, erro);
  return res.status(500).json({ error: `Não foi possível ${oQue}. Nada foi gravado. Tente de novo em instantes.` });
};

/** POST /api/usuarios/criar -- { nome, usuario, senha, codigoVendedor? }. */
router.post('/criar', podeCriarLogin, async (req, res) => {
  try {
    const r = await criarLogin({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'administrativo',
      acao: 'criacao',
      descricao: `Login criado para ${r.nome} (usuário ${r.usuario}). Logins em uso: ${r.emUso} de ${r.limite}.`,
      registroId: r.uid,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'criar o login');
  }
});

/** POST /api/usuarios/vincular-motorista -- { usuarioId, motoristaId } (26/10/2026). */
router.post('/vincular-motorista', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await vincularMotorista({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'administrativo',
      acao: 'edicao',
      descricao: `Usuário ${r.nome} vinculado ao motorista ${r.motoristaNome}${r.appLiberado ? '' : ' (aplicativo sem vaga no plano)'}.`,
      registroId: r.usuarioId,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'vincular o motorista');
  }
});

/** POST /api/usuarios/ficha -- { usuarioId, nome, codigoVendedor?, motorista? } (26/10/2026). */
router.post('/ficha', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await editarFicha({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'administrativo',
      acao: 'edicao',
      descricao: `Ficha do funcionário ${r.nome} alterada${r.motorista && r.motorista.novo ? ' (cadastrado como motorista)' : ''}.`,
      registroId: r.usuarioId,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'salvar o funcionário');
  }
});

/** POST /api/usuarios/situacao -- { usuarioId, ativo } (26/10/2026). */
router.post('/situacao', podeGerirFuncionario, async (req, res) => {
  try {
    const r = await alterarSituacao({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'administrativo',
      acao: 'edicao',
      descricao: `Usuário ${r.nome} ${r.ativo ? 'reativado' : 'inativado'}.`,
      registroId: r.usuarioId,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'alterar a situação do usuário');
  }
});

/** POST /api/usuarios/acesso-app -- { usuarioId, ligar }. */
router.post('/acesso-app', soAdministrador, async (req, res) => {
  try {
    const r = await alterarAcessoApp({ user: req.user, tenantId: req.user.tenantId, corpo: req.body || {} });
    registrarLog(req.user, {
      modulo: 'administrativo',
      acao: 'edicao',
      descricao: `Aplicativo mobile ${r.ligado ? 'liberado' : 'desligado'} para ${r.nome}.`,
      registroId: r.usuarioId,
    });
    return res.json({ ok: true, ...r });
  } catch (erro) {
    return responderErroLimite(res, erro, 'alterar o acesso ao aplicativo');
  }
});

module.exports = router;
