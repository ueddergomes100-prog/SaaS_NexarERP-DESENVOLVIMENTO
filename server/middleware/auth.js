const { auth, db } = require('../config/firebase');

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
    const claimRole = getClaimRole(decodedToken);
    const userDoc = await db.collection('usuarios').doc(uid).get();

    let role = claimRole;
    let tenantId = uid;
    let homeTenantId = uid;
    let permissoes = [];

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

      // Funcionario inativado perde o acesso ao servidor tambem, nao so' a
      // tela (mesma regra de perfilAtivo() nas firestore.rules, 2026-09-29).
      if (userData.status === 'Inativo' && !isPlatformAdminRole(role) && !isTenantManagerRole(role)) {
        return res.status(403).json({ error: 'Seu usuário foi inativado pelo administrador da empresa. Fale com ele para reativar o acesso.' });
      }
    }

    if (isPlatformAdminRole(claimRole)) {
      role = claimRole;
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
