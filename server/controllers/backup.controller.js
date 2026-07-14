const { db } = require('../config/firebase');
const fs = require('fs');
const { generateCompanyBackup } = require('../services/backup');
const { restoreCompanyBackup } = require('../services/restore');
const { deleteBackup } = require('../services/cloudStorage');
const { reloadCompanyJob } = require('../services/scheduler');

/**
 * Retorna todos os tenants (empresas) cadastrados no ERP.
 * Apenas acessível por SuperAdmin.
 */
async function getTenants(req, res) {
  try {
    if (!req.user.isPlatformAdmin) {
      return res.status(403).json({ error: 'Acesso negado. Apenas a equipe Nexar pode listar as empresas.' });
    }

    const snap = await db.collection('usuarios').get();
    const listOfTenants = [];
    
    snap.forEach(doc => {
      const data = doc.data();
      // Filtra contas SuperAdmin para não poluir a lista de empresas clientes
      if (data.role === 'NexarAdmin' || data.role === 'SuperAdmin') {
        return;
      }

      if (data.role === 'Master' || data.role === 'Admin' || doc.id === data.tenantId) {
        listOfTenants.push({
          id: doc.id,
          nomeOficina: data.nomeOficina || 'Sem Nome',
          email: data.email || 'N/A'
        });
      }
    });

    return res.json(listOfTenants);
  } catch (error) {
    console.error('[Controller] Erro ao listar empresas:', error.message);
    return res.status(500).json({ error: 'Erro interno ao obter lista de empresas.' });
  }
}

/**
 * Obtém o histórico de backups gerados para uma empresa específica.
 */
async function getBackupsHistory(req, res) {
  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
    }

    // Se for admin comum, valida se ele está solicitando backups de outra empresa
    if (!req.user.isPlatformAdmin && req.user.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Não autorizado. Você só pode ver os backups da sua empresa.' });
    }

    const snap = await db.collection('backups_historico')
      .where('companyId', '==', tenantId)
      .get();

    const history = [];
    snap.forEach(doc => {
      history.push(doc.data());
    });

    // Ordena do mais recente para o mais antigo em memória (caso o Firestore não tenha índice composto criado)
    history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json(history);
  } catch (error) {
    console.error('[Controller] Erro ao obter histórico de backups:', error.message);
    return res.status(500).json({ error: 'Erro interno ao consultar histórico.' });
  }
}

/**
 * Dispara manualmente a geração imediata de um novo backup.
 */
async function generateBackup(req, res) {
  try {
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'O campo tenantId é obrigatório no corpo da requisição.' });
    }

    if (!req.user.isPlatformAdmin && req.user.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Não autorizado. Você só pode gerar backups da sua própria empresa.' });
    }

    // Executa em segundo plano para não dar timeout no HTTP (processo assíncrono)
    // Mas retorna o registro inicializado para o frontend exibir progresso
    generateCompanyBackup(tenantId)
      .then(result => {
        console.log(`[Controller] Geração manual de backup concluída via API para ${tenantId}. Status: ${result.status}`);
      })
      .catch(err => {
        console.error(`[Controller] Erro assíncrono na geração do backup para ${tenantId}:`, err.message);
      });

    return res.status(202).json({ 
      message: 'A geração do backup foi iniciada em segundo plano. Acompanhe o status na tabela em instantes.',
      status: 'processando'
    });
  } catch (error) {
    console.error('[Controller] Erro ao iniciar backup:', error.message);
    return res.status(500).json({ error: 'Erro interno ao disparar backup.' });
  }
}

/**
 * Dispara de forma segura a restauração de um backup.
 */
async function restoreBackup(req, res) {
  try {
    const { backupId } = req.body;

    if (!backupId) {
      return res.status(400).json({ error: 'O campo backupId é obrigatório.' });
    }

    // Busca o registro do backup no histórico
    const docRef = db.collection('backups_historico').doc(backupId);
    const backupSnap = await docRef.get();

    if (!backupSnap.exists) {
      return res.status(404).json({ error: 'Registro de backup não localizado no histórico do ERP.' });
    }

    const backupData = backupSnap.data();
    const { companyId, companyName, filename, status } = backupData;

    // Proteção de segurança contra cruzamento de tenants
    if (!req.user.isPlatformAdmin && req.user.tenantId !== companyId) {
      return res.status(403).json({ error: 'Não autorizado. Você não pode restaurar backups de outras empresas.' });
    }

    if (status !== 'enviado' && status !== 'local') {
      return res.status(400).json({ error: `Este backup não está disponível para restauração direta. Status atual: ${status}` });
    }

    // A restauração limpa e reescreve dados, o que é um processo pesado.
    // Executamos de forma assíncrona ou síncrona.
    // Como a restauração necessita de feedback imediato de sucesso/falha, podemos rodar e aguardar (Sync),
    // ou fazê-lo em blocos rápidos.
    // Vamos aguardar o resultado do processamento já que as coleções são leves (JSON.gz).
    const result = await restoreCompanyBackup(companyId, companyName, filename, req.user.email);

    // Marca no histórico que este backup específico foi restaurado com sucesso
    await docRef.update({
      restauradoEm: new Date().toISOString(),
      restauradoPor: req.user.email
    });

    return res.json({
      message: 'Restauração concluída com sucesso!',
      safetyBackup: result.safetyBackupFilename,
      timestamp: result.timestamp
    });
  } catch (error) {
    console.error('[Controller] Erro crítico ao restaurar backup:', error.message);
    return res.status(500).json({ error: error.message || 'Erro crítico interno durante a restauração.' });
  }
}

/**
 * Exclui permanentemente um backup físico e seu registro de histórico.
 */
async function removeBackup(req, res) {
  try {
    const { backupId } = req.body;

    if (!backupId) {
      return res.status(400).json({ error: 'O campo backupId é obrigatório.' });
    }

    const docRef = db.collection('backups_historico').doc(backupId);
    const backupSnap = await docRef.get();

    if (!backupSnap.exists) {
      return res.status(404).json({ error: 'Backup não encontrado.' });
    }

    const backupData = backupSnap.data();
    const { companyId, companyName, filename } = backupData;

    if (!req.user.isPlatformAdmin && req.user.tenantId !== companyId) {
      return res.status(403).json({ error: 'Não autorizado. Você não pode excluir backups de outras empresas.' });
    }

    // 1. Tenta apagar do Cloud Storage (se estiver enviado)
    if (backupData.status === 'enviado') {
      try {
        await deleteBackup(companyId, companyName, filename);
      } catch (err) {
        console.warn('[Controller] Erro ao excluir do Storage, tentando excluir do banco assim mesmo:', err.message);
      }
    }

    // 2. Exclui o documento do histórico no Firestore
    await docRef.delete();

    return res.json({ message: 'Backup excluído permanentemente com sucesso.' });
  } catch (error) {
    console.error('[Controller] Erro ao excluir backup:', error.message);
    return res.status(500).json({ error: 'Erro interno ao remover backup.' });
  }
}

/**
 * Obtém as configurações de backup automático da empresa.
 */
async function getBackupSettings(req, res) {
  try {
    const { tenantId } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'O parâmetro tenantId é obrigatório.' });
    }

    if (!req.user.isPlatformAdmin && req.user.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Não autorizado. Acesso negado.' });
    }

    const docSnap = await db.collection('backups_configuracoes').doc(tenantId).get();
    
    if (docSnap.exists) {
      return res.json(docSnap.data());
    } else {
      // Retorna objeto padrão caso a empresa nunca tenha configurado
      return res.json({
        enabled: false,
        frequency: 'diario',
        time: '02:00',
        keepCount: 7
      });
    }
  } catch (error) {
    console.error('[Controller] Erro ao buscar configurações:', error.message);
    return res.status(500).json({ error: 'Erro ao carregar configurações de backup automático.' });
  }
}

/**
 * Salva as configurações de backup automático e recarrega os agendamentos no scheduler.
 */
async function saveBackupSettings(req, res) {
  try {
    const { tenantId, enabled, frequency, time, keepCount } = req.body;

    if (!tenantId) {
      return res.status(400).json({ error: 'O campo tenantId é obrigatório.' });
    }

    if (!req.user.isPlatformAdmin && req.user.tenantId !== tenantId) {
      return res.status(403).json({ error: 'Não autorizado. Acesso negado.' });
    }

    const updatedConfig = {
      enabled: !!enabled,
      frequency: frequency || 'diario',
      time: time || '02:00',
      keepCount: parseInt(keepCount, 10) || 7,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.email
    };

    // Salva ou atualiza a configuração no Firestore
    await db.collection('backups_configuracoes').doc(tenantId).set(updatedConfig, { merge: true });

    // Força o Scheduler a recarregar/atualizar a cron task desta empresa em tempo real!
    await reloadCompanyJob(tenantId);

    return res.json({ 
      message: 'Configurações de backup automático salvas e agendamento atualizado com sucesso.',
      config: updatedConfig
    });
  } catch (error) {
    console.error('[Controller] Erro ao salvar configurações de backup:', error.message);
    return res.status(500).json({ error: 'Erro ao gravar novas configurações.' });
  }
}

/**
 * Faz o download do arquivo físico de backup (criptografado) diretamente no navegador.
 */
async function downloadBackup(req, res) {
  try {
    const { backupId } = req.query;

    if (!backupId) {
      return res.status(400).json({ error: 'O parâmetro backupId é obrigatório.' });
    }

    const docRef = db.collection('backups_historico').doc(backupId);
    const backupSnap = await docRef.get();

    if (!backupSnap.exists) {
      return res.status(404).json({ error: 'Backup não localizado no histórico.' });
    }

    const backupData = backupSnap.data();
    const { companyId, companyName, filename, status, localPath } = backupData;

    // Proteção de segurança
    if (!req.user.isPlatformAdmin && req.user.tenantId !== companyId) {
      return res.status(403).json({ error: 'Não autorizado. Você não pode baixar backups de outra empresa.' });
    }

    let fileBuffer;

    if (status === 'local' || status === 'pendente') {
      if (!localPath || !fs.existsSync(localPath)) {
        return res.status(404).json({ error: 'Arquivo físico local não encontrado no servidor.' });
      }
      fileBuffer = fs.readFileSync(localPath);
    } else if (status === 'enviado') {
      const { downloadBackup: downloadFromStorage } = require('../services/cloudStorage');
      fileBuffer = await downloadFromStorage(companyId, companyName, filename);
    } else {
      return res.status(400).json({ error: 'Este backup não possui arquivo disponível para download.' });
    }

    // Define cabeçalhos HTTP para download forçado
    const safeFilename = String(filename || 'backup.bin').replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fileBuffer.length);

    return res.send(fileBuffer);
  } catch (error) {
    console.error('[Controller] Erro ao baixar backup:', error.message);
    return res.status(500).json({ error: 'Erro ao processar download do arquivo de backup.' });
  }
}

module.exports = {
  getTenants,
  getBackupsHistory,
  generateBackup,
  restoreBackup,
  removeBackup,
  getBackupSettings,
  saveBackupSettings,
  downloadBackup
};
