const express = require('express');
const router = express.Router();
const { 
  getTenants, 
  getBackupsHistory, 
  generateBackup, 
  restoreBackup, 
  removeBackup, 
  getBackupSettings, 
  saveBackupSettings,
  downloadBackup
} = require('../controllers/backup.controller');
const { authenticate, requireAdmin, authorizeTenant } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');

// Todas as rotas de backup exigem usuário autenticado e perfil administrativo (Admin ou SuperAdmin)
router.use(authenticate);
router.use(requireAdmin);

// Gerar/restaurar carrega a empresa inteira na memoria do servidor: poucas
// vezes por hora, por usuario -- um clique repetido nao pode enfileirar
// dez backups de uma vez.
const porUsuario = (req) => (req.user && req.user.uid) || req.ip;
const limiteGerar = limitadorPorChave('backup-gerar', porUsuario, {
  limite: 5,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Limite de backups manuais por hora atingido. Os já disparados continuam em andamento; acompanhe a lista.',
});
const limiteRestaurar = limitadorPorChave('backup-restaurar', porUsuario, {
  limite: 3,
  janelaMs: 60 * MINUTO_MS,
  mensagem: 'Limite de restaurações por hora atingido. Aguarde antes de tentar de novo.',
});

// Rota exclusiva para o SuperAdmin do SaaS para listar as empresas clientes
router.get('/tenants', getTenants);

// Rotas de backups por empresa (validam automaticamente o isolamento de tenantId)
router.get('/history', authorizeTenant, getBackupsHistory);
router.get('/download', authorizeTenant, downloadBackup);
router.post('/generate', limiteGerar, authorizeTenant, generateBackup);
router.post('/restore', limiteRestaurar, authorizeTenant, restoreBackup);
router.post('/remove', authorizeTenant, removeBackup);

// Rotas de configurações de agendamento automático de backups
router.get('/settings', authorizeTenant, getBackupSettings);
router.post('/settings', authorizeTenant, saveBackupSettings);

module.exports = router;
