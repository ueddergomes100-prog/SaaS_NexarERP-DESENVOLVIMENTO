const cron = require('node-cron');
const { db } = require('../config/firebase');
const { generateCompanyBackup } = require('./backup');

// Dicionário em memória para armazenar as tarefas agendadas ativas
const activeJobs = {};

/**
 * Converte configurações de frequência e horário em uma expressão Cron clássica de 5 campos.
 */
function getCronExpression(frequency, timeStr) {
  const [hour, minute] = (timeStr || '02:00').split(':');
  
  const m = parseInt(minute, 10) || 0;
  const h = parseInt(hour, 10) || 2;

  switch (frequency) {
    case 'diario':
      return `${m} ${h} * * *`;
    case 'semanal':
      // Roda todos os domingos
      return `${m} ${h} * * 0`;
    case 'mensal':
      // Roda no dia 1 de cada mês
      return `${m} ${h} 1 * *`;
    default:
      // Diário padrão
      return `${m} ${h} * * *`;
  }
}

/**
 * Carrega e agenda o job de backup para uma empresa específica.
 */
async function scheduleCompanyBackup(companyId, configData) {
  try {
    // Se já houver um job rodando para essa empresa, cancela-o
    if (activeJobs[companyId]) {
      activeJobs[companyId].stop();
      delete activeJobs[companyId];
    }

    const { enabled, frequency, time } = configData;

    if (!enabled) {
      console.log(`[Scheduler] Backups automáticos desativados para a empresa ${companyId}.`);
      return;
    }

    const cronExpr = getCronExpression(frequency, time);
    console.log(`[Scheduler] Agendando backup automático para ${companyId}. Freq: ${frequency}, Hora: ${time} (Cron: ${cronExpr})`);

    const task = cron.schedule(cronExpr, async () => {
      console.log(`[Scheduler] Disparando cron job automático de backup para a empresa ${companyId}...`);
      try {
        await generateCompanyBackup(companyId);
      } catch (err) {
        console.error(`[Scheduler] Erro ao executar backup automático de cron para ${companyId}:`, err.message);
      }
    });

    activeJobs[companyId] = task;
  } catch (error) {
    console.error(`[Scheduler] Falha ao agendar backup para a empresa ${companyId}:`, error.message);
  }
}

/**
 * Inicializa todos os agendamentos salvos no Firestore ao subir o servidor.
 */
async function initScheduler() {
  if (!db) {
    console.warn('[Scheduler] Firestore não disponível. Agendamentos automáticos desativados.');
    return;
  }

  console.log('[Scheduler] Inicializando agendador de backups automáticos...');
  try {
    const snap = await db.collection('backups_configuracoes').get();
    
    let scheduledCount = 0;
    snap.forEach(doc => {
      const config = doc.data();
      if (config.enabled) {
        scheduleCompanyBackup(doc.id, config);
        scheduledCount++;
      }
    });

    console.log(`[Scheduler] Inicialização concluída. ${scheduledCount} rotinas automáticas de backup ativadas.`);
  } catch (error) {
    console.error('[Scheduler] Erro ao carregar agendamentos do Firestore:', error.message);
  }
}

/**
 * Recarrega o agendamento de uma empresa específica (chamado após o usuário atualizar na tela).
 */
async function reloadCompanyJob(companyId) {
  try {
    const doc = await db.collection('backups_configuracoes').doc(companyId).get();
    if (doc.exists) {
      await scheduleCompanyBackup(companyId, doc.data());
    } else {
      // Se a configuração foi excluída do banco, para o job
      if (activeJobs[companyId]) {
        activeJobs[companyId].stop();
        delete activeJobs[companyId];
        console.log(`[Scheduler] Agendamento removido para a empresa ${companyId} por falta de registro de configuração.`);
      }
    }
  } catch (error) {
    console.error(`[Scheduler] Erro ao recarregar rotina da empresa ${companyId}:`, error.message);
  }
}

module.exports = {
  initScheduler,
  reloadCompanyJob
};
