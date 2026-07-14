const fs = require('fs');
const cron = require('node-cron');
const { db } = require('../config/firebase');
const { uploadBackup, applyRetentionPolicy } = require('./cloudStorage');

/**
 * Orquestra a verificação e o reenvio de backups pendentes (fallback local).
 */
async function processPendingBackups() {
  if (!db) return;

  console.log('[Queue] Iniciando verificação de backups pendentes para reenvio à nuvem...');

  try {
    // Consulta todos os históricos marcados como "pendente" (salvos localmente)
    const snap = await db.collection('backups_historico')
      .where('status', '==', 'pendente')
      .get();

    if (snap.empty) {
      console.log('[Queue] Nenhum backup pendente encontrado para sincronizar.');
      return;
    }

    console.log(`[Queue] Encontrados ${snap.size} backups pendentes. Iniciando tentativas de sincronização...`);

    for (const doc of snap.docs) {
      const backup = doc.data();
      const { id, companyId, companyName, filename, localPath, checksum } = backup;

      if (!localPath || !fs.existsSync(localPath)) {
        console.warn(`[Queue] Arquivo local de backup não encontrado para o registro ${id}: ${localPath}. Marcando como erro.`);
        await doc.ref.update({
          status: 'erro',
          error: 'Arquivo físico local do backup de fallback não foi encontrado no servidor.'
        });
        continue;
      }

      console.log(`[Queue] Tentando reenviar backup de ${companyName} (${filename})...`);

      try {
        const fileBuffer = fs.readFileSync(localPath);
        
        // Efetua o upload para o Google Cloud Storage
        const storagePath = await uploadBackup(companyId, companyName, filename, fileBuffer, {
          checksum,
          sizeBytes: String(fileBuffer.length),
          syncedFromFallback: 'true'
        });

        // Exclui o arquivo físico local para liberar espaço em disco no servidor
        fs.unlinkSync(localPath);
        console.log(`[Queue] Arquivo local deletado para liberar disco: ${localPath}`);

        // Atualiza o status no banco
        await doc.ref.update({
          status: 'enviado',
          storagePath,
          localPath: null
        });

        // Roda a política de retenção
        await applyRetentionPolicy(companyId, companyName);

        console.log(`[Queue] Backup ${filename} de ${companyName} sincronizado na nuvem com sucesso!`);
      } catch (uploadError) {
        console.error(`[Queue] Falha na tentativa de reenvio do backup ${filename}:`, uploadError.message);
        // Mantém como pendente para a próxima rodada
      }
    }
  } catch (error) {
    console.error('[Queue] Erro ao processar fila de backups pendentes:', error.message);
  }
}

/**
 * Inicializa a verificação recorrente da fila de sincronização.
 * Roda a cada 1 hora.
 */
function initQueueService() {
  console.log('[Queue] Inicializando serviço de fila e reenvio de backups (rodará a cada 1 hora)...');
  
  // Agendamento cron: minuto 0 de cada hora
  cron.schedule('0 * * * *', async () => {
    await processPendingBackups();
  });

  // Roda uma vez de forma assíncrona logo após subir o servidor para tratar pendências antigas
  setTimeout(async () => {
    await processPendingBackups();
  }, 10000); // aguarda 10 segundos
}

module.exports = {
  initQueueService,
  processPendingBackups
};
