const { auth, db } = require('../config/firebase');
const { parseNivelAcesso } = require('../domain/visibilidadeVendasDomain');
const { MENSAGEM_SERVIDOR_BLOQUEADO } = require('../domain/mensalidadeDomain');
const { sessaoEncerrada } = require('../services/sessoes');

/** Timestamp do Firestore (ou Date) em ms; outra coisa = 0. */
const instanteEmMs = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
};

const PLATFORM_ROLES = ['NexarAdmin', 'SuperAdmin'];
const TENANT_MANAGER_ROLES = ['Master', 'Admin'];
const VALID_ROLES = [...PLATFORM_ROLES, ...TENANT_MANAGER_ROLES, 'Funcionario'];

const isPlatformAdminRole = (role) => PLATFORM_ROLES.includes(role);
const isTenantManagerRole = (role) => TENANT_MANAGER_ROLES.includes(role);

const normalizeRole = (role, fallback = 'Funcionario') => (
  VALID_ROLES.includes(role) ? role : fallback
);

const getClaimRole = (decodedToken) => {
  if (decodedToken.nexarAdmin === true || decodedToken.role === 'NexarAdmin') {
    return 'NexarAdmin';
  }

  if (decodedToken.superAdmin === true || decodedToken.role === 'SuperAdmin') {
    return 'SuperAdmin';
  }

  return decodedToken.role ? normalizeRole(decodedToken.role) : null;
};

async function authenticate(req, res, next) {
  try {
    if (!auth || !db) {
      return res.status(503).json({ error: 'Firebase Admin SDK nao configurado no backend.' });
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split('Bearer ')[1]
      : '';

    if (!token) {
      return res.status(401).json({ error: 'Token de autenticacao nao fornecido ou invalido.' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const { uid, email } = decodedToken;
    // Login por codigo e senha (token emitido pelo servidor: caixa, sistema no computador
    // ativado, app Vendas) nunca vale como equipe da plataforma, mesmo que a conta tenha o
    // papel gravado nela. A plataforma entra so' com usuario e senha (auditoria de 24/11/2026).
    const entrouPorCodigo = Boolean(decodedToken.firebase && decodedToken.firebase.sign_in_provider === 'custom');
    const papelDoToken = getClaimRole(decodedToken);
    const claimRole = entrouPorCodigo && isPlatformAdminRole(papelDoToken) ? null : papelDoToken;
    // Equipe da plataforma pelo token: a ficha em `usuarios` (que uma empresa pode ter criado
    // com o id dela) nao a barra nem a rebaixa.
    const plataformaPeloToken = isPlatformAdminRole(claimRole);
    const userDoc = await db.collection('usuarios').doc(uid).get();

    let role = claimRole;
    let tenantId = uid;
    let homeTenantId = uid;
    let permissoes = [];
    // Nivel de acesso (funcionario/supervisor/gerente): o gerente cria login (26/10/2026).
    let nivelAcesso = 'funcionario';
    // Historico de alteracoes (09/11/2026): o nome do cadastro vai em cada registro.
    let nome = '';

    if (userDoc.exists) {
      const userData = userDoc.data();
      const ownerFallback = userData.tenantId === uid ? 'Master' : 'Funcionario';
      role = normalizeRole(userData.role, role || ownerFallback);
      // Empresa da vez = a FILIAL ATIVA, quando o usuario entrou em outra
      // filial do grupo (so' o servidor grava, ver services/filiais.js); sem
      // ela, a filial "casa" do usuario. Mesma regra de currentTenantId() nas
      // firestore.rules.
      tenantId = userData.filialAtiva || userData.tenantId || uid;
      homeTenantId = userData.tenantId || uid;
      permissoes = Array.isArray(userData.permissoes) ? userData.permissoes : [];
      nivelAcesso = parseNivelAcesso(userData.nivelAcesso);
      nome = String(userData.nome || userData.nomeResponsavel || '').trim();

      // Sessao encerrada pelo servidor (bloco B, 25/11/2026: senha/PIN trocado,
      // usuario inativado, computador do caixa desativado): login feito antes
      // disso nao vale mais aqui. Ver services/sessoes.js.
      if (sessaoEncerrada(userData, decodedToken.auth_time)) {
        return res.status(401).json({ error: 'Sua sessão foi encerrada (a senha foi trocada, o usuário foi inativado ou o computador do caixa foi desativado). Entre de novo.', codigo: 'sessao_encerrada' });
      }

      // Inativado perde o acesso ao servidor tambem, nao so' a tela (mesma regra
      // de perfilAtivo() nas firestore.rules, 2026-09-29). Bloco B (25/11/2026):
      // vale tambem para o ADMINISTRADOR -- antes ele seguia com acesso total.
      // So' o dono (nunca pode ser inativado) e a plataforma ficam de fora.
      if (userData.status === 'Inativo' && !plataformaPeloToken && !isPlatformAdminRole(role) && userData.tenantId !== uid) {
        return res.status(403).json({ error: 'Seu usuário foi inativado pelo administrador da empresa. Fale com ele para reativar o acesso.' });
      }
      // Vendedor de balcao (sem login) so' pelo app, com o token do codigo+PIN
      // (19/10/2026; mesma regra das firestore.rules).
      if (userData.tipoRegistro === 'vendedor' && decodedToken.isVendedorBalcao !== true && !plataformaPeloToken) {
        return res.status(403).json({ error: 'Este cadastro é de vendedor de balcão: ele entra só pelo aplicativo, com o código e a senha de vendedor.' });
      }
    }

    if (isPlatformAdminRole(claimRole)) {
      role = claimRole;
    }

    // Mensalidade em atraso (24/11/2026): a partir do instante gravado pelo
    // servidor no perfil (services/mensalidades.js), a empresa inteira fica
    // sem servidor -- mesma regra de perfilAtivo() nas firestore.rules. O
    // admin da plataforma nunca e' bloqueado.
    if (userDoc.exists && !isPlatformAdminRole(role)) {
      const bloqueioMs = instanteEmMs(userDoc.data().cobrancaBloqueioEm);
      if (bloqueioMs && Date.now() >= bloqueioMs) {
        return res.status(402).json({ error: MENSAGEM_SERVIDOR_BLOQUEADO, codigo: 'cobranca_bloqueada' });
      }
    }

    if (!role) {
      return res.status(403).json({ error: 'Perfil de acesso nao encontrado para este usuario.' });
    }

    req.user = {
      uid,
      email,
      role,
      tenantId,
      homeTenantId,
      permissoes,
      nivelAcesso,
      nome: nome || email || uid,
      // Dono da empresa: o login cujo uid e' o da empresa casa (mesma regra do AuthContext: isOwner).
      dono: homeTenantId === uid,
      // Caminho da tela que chamou (fetchComTimeout manda em `_tela`): diz no
      // historico se veio do sistema, do app Vendas, do app do motorista...
      telaCliente: typeof req.query?._tela === 'string' ? req.query._tela.slice(0, 200) : '',
      isPlatformAdmin: isPlatformAdminRole(role),
      isTenantManager: isTenantManagerRole(role)
    };

    next();
  } catch (error) {
    console.error('Erro na autenticacao do middleware:', error.message);
    return res.status(401).json({ error: 'Nao autorizado. Token expirado ou invalido.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuario nao autenticado.' });
  }

  if (!req.user.isPlatformAdmin && !req.user.isTenantManager) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar backups.' });
  }

  next();
}

function authorizeTenant(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuario nao autenticado.' });
  }

  const { tenantId } = req.user;
  const requestedTenantId = req.query.tenantId || req.body.tenantId;

  if (req.user.isPlatformAdmin) {
    return next();
  }

  if (!requestedTenantId) {
    if (req.method === 'GET') {
      req.query.tenantId = tenantId;
    } else {
      req.body.tenantId = tenantId;
    }
    return next();
  }

  if (tenantId !== requestedTenantId) {
    return res.status(403).json({ error: 'Acesso negado. Voce nao tem permissao para gerenciar dados de outra empresa.' });
  }

  next();
}

module.exports = {
  authenticate,
  requireAdmin,
  authorizeTenant,
  isPlatformAdminRole,
  isTenantManagerRole,
  normalizeRole
};
