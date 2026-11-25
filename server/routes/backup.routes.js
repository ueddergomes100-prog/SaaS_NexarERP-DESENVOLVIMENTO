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
  downloadBackup,
  getResumo,
  restoreFromFile
} = require('../controllers/backup.controller');
const { authenticate, requireAdmin, authorizeTenant } = require('../middleware/auth');
const { limitadorPorChave, MINUTO_MS } = require('../middleware/rateLimit');
const { exigirPermissao } = require('../services/permissoesAdministracao');
const { PERMISSAO_ADMINISTRACAO: PA } = require('../domain/permissoesNovasDomain');

// Todas as rotas de backup exigem usuario autenticado. Item 15 (fase
// Administracao, 25/11/2026): gerar e baixar deixam de ser so' do
// administrador -- cada uma pede a sua permissao (o dono/administrador segue
// liberado). Restaurar, excluir e o que e' da plataforma continuam so' dela
// (conferido tambem no controller).
router.use(authenticate);
const podeGerar = exigirPermissao([PA.backupGerar]);
const podeBaixar = exigirPermissao([PA.backupBaixar]);
const podeVer = exigirPermissao([PA.backupGerar, PA.backupBaixar], { qualquer: true });

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
router.get('/tenants', requireAdmin, getTenants);
// Situacao dos backups de todas as empresas e filiais (12/11/2026). So' a plataforma.
router.get('/resumo', requireAdmin, getResumo);
// Restaurar a partir de um arquivo enviado (12/11/2026). So' a plataforma; o
// corpo e' o arquivo cifrado inteiro, por isso o leitor proprio (o json global
// do servidor ignora este tipo de conteudo).
const arquivoDeBackup = express.raw({ type: 'application/octet-stream', limit: '300mb' });
// Confere a plataforma ANTES de receber o arquivo (auditoria de 24/11/2026): o dono de
// qualquer empresa conseguia mandar 300 MB para a memoria do servidor e so' entao levava o 403.
const soPlataforma = (req, res, next) => (
  req.user && req.user.isPlatformAdmin
    ? next()
    : res.status(403).json({ error: 'Só a equipe Hennder pode restaurar um backup. Fale com o suporte.' })
);
router.post('/restore-file', requireAdmin, soPlataforma, limiteRestaurar, arquivoDeBackup, restoreFromFile);

// Rotas de backups por empresa (validam automaticamente o isolamento de tenantId)
router.get('/history', podeVer, authorizeTenant, getBackupsHistory);
router.get('/download', podeBaixar, authorizeTenant, downloadBackup);
router.post('/generate', podeGerar, limiteGerar, authorizeTenant, generateBackup);
router.post('/restore', requireAdmin, limiteRestaurar, authorizeTenant, restoreBackup);
router.post('/remove', requireAdmin, authorizeTenant, removeBackup);

// Rotas de configurações de agendamento automático de backups
router.get('/settings', podeVer, authorizeTenant, getBackupSettings);
router.post('/settings', podeGerar, authorizeTenant, saveBackupSettings);

module.exports = router;
