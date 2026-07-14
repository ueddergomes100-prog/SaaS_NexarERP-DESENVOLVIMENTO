const { storage } = require('../config/firebase');
const { parse, differenceInDays, format, subDays, startOfWeek, startOfMonth } = require('date-fns');

// Obter o bucket do Google Cloud Storage
function getBucket() {
  if (!storage) {
    throw new Error('Serviço do Google Cloud Storage não inicializado.');
  }
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  return bucketName ? storage.bucket(bucketName) : storage.bucket();
}

/**
 * Normaliza o nome da empresa para ser usado em caminhos de pastas (remove acentos, espaços e caracteres especiais)
 */
function getCleanCompanyName(companyName) {
  if (!companyName) return 'sem_nome';
  return companyName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9]/g, '_')   // substitui não-alfanuméricos por _
    .toLowerCase();
}

/**
 * Obtém o caminho da pasta da empresa no Storage
 */
function getCompanyFolderPath(companyId, companyName) {
  const cleanName = getCleanCompanyName(companyName);
  return `backups/empresa_${companyId}_${cleanName}/`;
}

/**
 * Faz upload de um backup criptografado para a pasta correspondente à empresa no Cloud Storage
 */
async function uploadBackup(companyId, companyName, filename, fileBuffer, metadata = {}) {
  const bucket = getBucket();
  const folderPath = getCompanyFolderPath(companyId, companyName);
  const fullPath = `${folderPath}${filename}`;
  const file = bucket.file(fullPath);

  await file.save(fileBuffer, {
    metadata: {
      contentType: 'application/octet-stream',
      metadata: {
        companyId,
        companyName,
        createdAt: new Date().toISOString(),
        ...metadata
      }
    }
  });

  console.log(`Backup salvo no Cloud Storage com sucesso: ${fullPath}`);
  return fullPath;
}

/**
 * Baixa um backup criptografado do Cloud Storage
 */
async function downloadBackup(companyId, companyName, filename) {
  const bucket = getBucket();
  const folderPath = getCompanyFolderPath(companyId, companyName);
  const fullPath = `${folderPath}${filename}`;
  const file = bucket.file(fullPath);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`O arquivo de backup solicitado não existe no Cloud Storage: ${fullPath}`);
  }

  const [buffer] = await file.download();
  return buffer;
}

/**
 * Lista os backups disponíveis no Cloud Storage para uma determinada empresa
 */
async function listBackups(companyId, companyName) {
  const bucket = getBucket();
  const folderPath = getCompanyFolderPath(companyId, companyName);

  // Busca todos os arquivos que começam com o prefixo da pasta da empresa
  const [files] = await bucket.getFiles({ prefix: folderPath });

  const backupsList = [];
  for (const file of files) {
    // Ignora a pasta em si, queremos apenas arquivos de backup
    if (file.name === folderPath) continue;

    const [metadata] = await file.getMetadata();
    const filename = file.name.substring(folderPath.length);

    backupsList.push({
      filename,
      fullPath: file.name,
      sizeBytes: parseInt(metadata.size, 10),
      createdAt: metadata.metadata?.createdAt || metadata.timeCreated,
      metadata: metadata.metadata || {}
    });
  }

  // Ordena os backups do mais recente para o mais antigo
  return backupsList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Exclui um backup específico do Cloud Storage
 */
async function deleteBackup(companyId, companyName, filename) {
  const bucket = getBucket();
  const folderPath = getCompanyFolderPath(companyId, companyName);
  const fullPath = `${folderPath}${filename}`;
  const file = bucket.file(fullPath);

  const [exists] = await file.exists();
  if (exists) {
    await file.delete();
    console.log(`Backup excluído do Cloud Storage: ${fullPath}`);
  }
}

/**
 * Aplica a política de retenção aos backups da empresa no Cloud Storage
 * Mantém os últimos 7 diários, 4 semanais e 6 mensais.
 */
async function applyRetentionPolicy(companyId, companyName) {
  try {
    const list = await listBackups(companyId, companyName);
    if (list.length === 0) return;

    const dailyLimit = parseInt(process.env.BACKUP_RETENTION_DAILY || '7', 10);
    const weeklyLimit = parseInt(process.env.BACKUP_RETENTION_WEEKLY || '4', 10);
    const monthlyLimit = parseInt(process.env.BACKUP_RETENTION_MONTHLY || '6', 10);

    // Dicionários para controlar o que manter
    const keepBackups = new Set();

    // 1. Separar backups por dia, semana e mês de criação
    // Mapeamos cada backup para suas chaves de período
    const parsedBackups = list.map(item => {
      const date = new Date(item.createdAt);
      return {
        ...item,
        date,
        dayKey: format(date, 'yyyy-MM-dd'),
        weekKey: format(startOfWeek(date), 'yyyy-\'W\'ww'),
        monthKey: format(startOfMonth(date), 'yyyy-MM')
      };
    });

    // 2. Determinar backups Diários a manter (Newest para cada um dos últimos N dias únicos)
    const dailyGroups = {};
    parsedBackups.forEach(b => {
      if (!dailyGroups[b.dayKey]) {
        dailyGroups[b.dayKey] = b; // O mais novo entra primeiro pois list já está ordenada desc
      }
    });
    // Pega as chaves dos dias únicos e ordena decrescente, pegando as primeiras N chaves
    const activeDays = Object.keys(dailyGroups).sort().reverse().slice(0, dailyLimit);
    activeDays.forEach(day => keepBackups.add(dailyGroups[day].filename));

    // 3. Determinar backups Semanais a manter (Newest de cada semana nos últimos N semanas únicas)
    const weeklyGroups = {};
    parsedBackups.forEach(b => {
      if (!weeklyGroups[b.weekKey]) {
        weeklyGroups[b.weekKey] = b;
      }
    });
    const activeWeeks = Object.keys(weeklyGroups).sort().reverse().slice(0, weeklyLimit);
    activeWeeks.forEach(week => keepBackups.add(weeklyGroups[week].filename));

    // 4. Determinar backups Mensais a manter (Newest de cada mês nos últimos N meses únicos)
    const monthlyGroups = {};
    parsedBackups.forEach(b => {
      if (!monthlyGroups[b.monthKey]) {
        monthlyGroups[b.monthKey] = b;
      }
    });
    const activeMonths = Object.keys(monthlyGroups).sort().reverse().slice(0, monthlyLimit);
    activeMonths.forEach(month => keepBackups.add(monthlyGroups[month].filename));

    // 5. Deletar os backups que não estão no conjunto 'keepBackups'
    let deleteCount = 0;
    for (const backup of list) {
      if (!keepBackups.has(backup.filename)) {
        console.log(`Retenção: Excluindo backup antigo excedente no Cloud Storage: ${backup.filename}`);
        await deleteBackup(companyId, companyName, backup.filename);
        deleteCount++;
      }
    }

    console.log(`Política de retenção aplicada para ${companyName}. Mantidos: ${keepBackups.size} backups. Excluídos: ${deleteCount} backups.`);
  } catch (error) {
    console.error(`Erro ao processar política de retenção para ${companyName}:`, error.message);
  }
}

module.exports = {
  uploadBackup,
  downloadBackup,
  listBackups,
  deleteBackup,
  applyRetentionPolicy,
  getCleanCompanyName
};
