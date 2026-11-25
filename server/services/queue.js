const fs = require('fs');
const cron = require('node-cron');
const { db } = require('../config/firebase');
const { uploadBackup, downloadBackup, applyRetentionPolicy, getCompanyFolderPath } = require('./cloudStorage');
const { copiarParaOExterno, externoConfigurado } = require('./backupExterno');
const { rodarNaVez } = require('./travaDeRotina');

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

/** So' tenta de novo a copia externa de backup recente: o antigo ja' saiu da retencao. */
const JANELA_DO_REENVIO_EXTERNO_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Copia externa que falhou (12/11/2026): tenta de novo, de hora em hora, com o
 * arquivo que esta' no bucket principal (ou no disco, se ainda nao subiu).
 * Ver backupExterno.js.
 */
async function reenviarExternosComErro(agoraMs = Date.now()) {
  if (!db || !externoConfigurado()) return 0;
  let reenviados = 0;
  try {
    const snap = await db.collection('backups_historico').where('externo.status', '==', 'erro').get();
    for (const doc of snap.docs) {
      const backup = doc.data();
      if (agoraMs - (Date.parse(backup.createdAt) || 0) > JANELA_DO_REENVIO_EXTERNO_MS) continue;
      let arquivo = null;
      try {
        if (backup.status === 'enviado') arquivo = await downloadBackup(backup.companyId, backup.companyName, backup.filename);
        else if (backup.localPath && fs.existsSync(backup.localPath)) arquivo = fs.readFileSync(backup.localPath);
      } catch (erroLeitura) {
        console.warn(`[Queue] Cópia externa de ${backup.filename}: não consegui ler o arquivo para reenviar:`, erroLeitura.message);
      }
      if (!arquivo) continue;
      const externo = await copiarParaOExterno(`${getCompanyFolderPath(backup.companyId, backup.companyName)}${backup.filename}`, arquivo);
      await doc.ref.update({ externo });
      if (externo.status === 'enviado') {
        reenviados += 1;
        console.log(`[Queue] Cópia externa de ${backup.filename} (${backup.companyName}) enviada no reenvio.`);
      }
    }
  } catch (error) {
    console.error('[Queue] Erro ao reenviar cópias externas:', error.message);
  }
  return reenviados;
}

const HORA_MS = 60 * 60 * 1000;
/** Se o processo morre no meio da fila, outro assume depois disto. */
const VALIDADE_DA_RESERVA_DA_FILA_MS = 30 * 60 * 1000;

/**
 * Uma passada da fila, UMA vez por hora no servidor inteiro (25/11/2026).
 *
 * Com dois processos do servidor no ar, os dois reenviavam o mesmo backup
 * pendente ao mesmo tempo: um subia o arquivo e apagava do disco, o outro nao
 * achava mais o arquivo e marcava "erro" num backup que estava salvo na nuvem.
 * A vez e' a hora cheia -- ver travaDeRotina.js. Devolve true se este processo
 * rodou a fila.
 */
async function passarAFila(agoraMs = Date.now()) {
  if (!db) return false;
  try {
    const vez = Math.floor(agoraMs / HORA_MS) * HORA_MS;
    const { rodou } = await rodarNaVez('fila_de_backups', vez, { validadeMs: VALIDADE_DA_RESERVA_DA_FILA_MS, agoraMs }, async () => {
      await processPendingBackups();
      await reenviarExternosComErro(agoraMs);
    });
    if (!rodou) console.log('[Queue] A fila de backups desta hora já foi (ou está sendo) tratada por outro processo do servidor.');
    return rodou;
  } catch (erro) {
    console.error('[Queue] Erro na passada da fila de backups:', erro.message);
    return false;
  }
}

/**
 * Inicializa a verificação recorrente da fila de sincronização.
 * Roda a cada 1 hora.
 */
function initQueueService() {
  console.log('[Queue] Inicializando serviço de fila e reenvio de backups (rodará a cada 1 hora)...');

  // Agendamento cron: minuto 0 de cada hora
  cron.schedule('0 * * * *', () => { void passarAFila(); });

  // Roda uma vez logo após subir o servidor para tratar pendências antigas
  // (se a fila desta hora já rodou, espera a próxima hora cheia).
  setTimeout(() => { void passarAFila(); }, 10000); // aguarda 10 segundos
}

module.exports = {
  initQueueService,
  passarAFila,
  processPendingBackups,
  reenviarExternosComErro
};
