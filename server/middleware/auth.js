const { auth, db } = require('../config/firebase');

/**
 * Middleware para validar o token JWT do Firebase Auth e carregar o perfil do usuário (role e tenantId).
 */
async function authenticate(req, res, next) {
  try {
    if (!auth || !db) {
      return res.status(503).json({ error: 'Firebase Admin SDK nao configurado no backend.' });
    }

    let token;
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split('Bearer ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Token de autenticação não fornecido ou inválido.' });
    }
    
    // Verifica o token usando o Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(token);
    const { uid, email } = decodedToken;
    const claimRole = decodedToken.superAdmin === true || decodedToken.role === 'SuperAdmin'
      ? 'SuperAdmin'
      : decodedToken.role;

    // Busca o perfil do usuário no Firestore para obter o role e o tenantId
    const userDoc = await db.collection('usuarios').doc(uid).get();
    
    let role = claimRole || 'Admin'; // Role padrão caso o doc não exista (primeiro login do dono)
    let tenantId = uid;   // Tenant padrão é o próprio UID do dono
    let permissoes = [];

    if (userDoc.exists) {
      const userData = userDoc.data();
      role = userData.role || role;
      tenantId = userData.tenantId || uid;
      permissoes = userData.permissoes || [];
    }

    if (claimRole === 'SuperAdmin') {
      role = 'SuperAdmin';
    }

    // Anexa as informações do usuário logado ao objeto de requisição
    req.user = {
      uid,
      email,
      role,
      tenantId,
      permissoes
    };

    next();
  } catch (error) {
    console.error('Erro na autenticação do middleware:', error.message);
    return res.status(401).json({ error: 'Não autorizado. Token expirado ou inválido.' });
  }
}

/**
 * Middleware para restringir o acesso apenas a SuperAdmin ou Administradores autorizados.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const { role } = req.user;
  if (role !== 'SuperAdmin' && role !== 'Admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar backups.' });
  }

  next();
}

/**
 * Middleware para garantir que o usuário só acesse dados de sua própria empresa (tenant),
 * exceto se ele for SuperAdmin (que pode acessar qualquer empresa).
 */
function authorizeTenant(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const { role, tenantId } = req.user;
  const requestedTenantId = req.query.tenantId || req.body.tenantId;

  // Se for SuperAdmin, tem acesso livre
  if (role === 'SuperAdmin') {
    return next();
  }

  // Se for Admin normal, ele PRECISA especificar o próprio tenantId ou o parâmetro deve bater com o dele
  if (!requestedTenantId) {
    // Se não informou, anexa automaticamente o tenantId do próprio usuário na requisição
    if (req.method === 'GET') {
      req.query.tenantId = tenantId;
    } else {
      req.body.tenantId = tenantId;
    }
    return next();
  }

  if (tenantId !== requestedTenantId) {
    return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para gerenciar dados de outra empresa.' });
  }

  next();
}

module.exports = {
  authenticate,
  requireAdmin,
  authorizeTenant
};
