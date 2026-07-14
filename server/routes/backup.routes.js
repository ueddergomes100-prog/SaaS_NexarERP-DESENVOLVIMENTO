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

// Todas as rotas de backup exigem usuário autenticado e perfil administrativo (Admin ou SuperAdmin)
router.use(authenticate);
router.use(requireAdmin);

// Rota exclusiva para o SuperAdmin do SaaS para listar as empresas clientes
router.get('/tenants', getTenants);

// Rotas de backups por empresa (validam automaticamente o isolamento de tenantId)
router.get('/history', authorizeTenant, getBackupsHistory);
router.get('/download', authorizeTenant, downloadBackup);
router.post('/generate', authorizeTenant, generateBackup);
router.post('/restore', authorizeTenant, restoreBackup);
router.post('/remove', authorizeTenant, removeBackup);

// Rotas de configurações de agendamento automático de backups
router.get('/settings', authorizeTenant, getBackupSettings);
router.post('/settings', authorizeTenant, saveBackupSettings);

module.exports = router;
