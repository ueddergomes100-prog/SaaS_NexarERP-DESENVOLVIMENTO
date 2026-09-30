const { db } = require('../config/firebase');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { format } = require('date-fns');
const { uploadBackup, applyRetentionPolicy } = require('./cloudStorage');
const { COLECOES_DA_EMPRESA } = require('./backupColecoes');
const { cifrar } = require('./backupCripto');

const gzip = promisify(zlib.gzip);

// Lista das coleções que usam a filtragem tenantId -- ver backupColecoes.js.
const COLLECTIONS_TO_BACKUP = COLECOES_DA_EMPRESA;

/**
 * Segredo que protege os arquivos de backup (BACKUP_ENCRYPTION_KEY). A chave
 * em si e' derivada em backupCripto.js. Em producao a variavel e' obrigatoria:
 * sem ela todo backup falha -- e o /health avisa (services/configuracaoAmbiente.js).
 */
function getEncryptionKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BACKUP_ENCRYPTION_KEY é obrigatório em produção.');
    }

    console.warn('[Backup] BACKUP_ENCRYPTION_KEY ausente. Usando chave local apenas para desenvolvimento.');
  }

  return secret || 'HennderERPLocalDevelopmentKeyOnly2026!';
}

/**
 * Exporta, compacta, cifra e envia o backup de UMA empresa. Nao chame direto:
 * use generateCompanyBackup, que enfileira -- ver abaixo.
 */
async function gerarBackupDaEmpresa(companyId) {
  if (!db) {
    throw new Error('Banco de dados Firestore não inicializado ou inacessível.');
  }

  console.log(`[Backup] Iniciando rotina de backup para a empresa: ${companyId}`);

  // 1. Obter informações básicas da empresa (nomeOficina e CNPJ)
  let companyName = 'Empresa Desconhecida';
  let cnpj = 'N/A';

  try {
    const configDoc = await db.collection('configuracoes').doc(companyId).get();
    if (configDoc.exists) {
      const configData = configDoc.data();
      companyName = configData.nomeOficina || configData.razaoSocial || companyName;
      cnpj = configData.cnpj || cnpj;
    } else {
      const userDoc = await db.collection('usuarios').doc(companyId).get();
      if (userDoc.exists) {
        companyName = userDoc.data().nomeOficina || companyName;
      }
    }
  } catch (err) {
    console.warn(`[Backup] Não foi possível ler o nome da empresa ${companyId}, usando padrão.`, err.message);
  }

  const exportData = {
    metadata: {
      companyId,
      companyName,
      cnpj,
      createdAt: new Date().toISOString(),
      systemVersion: '1.0.0',
      tableCounts: {},
      checksum: ''
    },
    data: {}
  };

  // 2. Exportar o documento de configurações (onde ID = tenantId)
  try {
    const configSnap = await db.collection('configuracoes').doc(companyId).get();
    if (configSnap.exists) {
      exportData.data['configuracoes'] = { id: configSnap.id, ...configSnap.data() };
      exportData.metadata.tableCounts['configuracoes'] = 1;
    } else {
      exportData.data['configuracoes'] = null;
      exportData.metadata.tableCounts['configuracoes'] = 0;
    }
  } catch (err) {
    console.error(`[Backup] Erro ao extrair 'configuracoes':`, err.message);
    exportData.data['configuracoes'] = null;
  }

  // 3. Exportar a lista de usuários da empresa (usuarios onde tenantId == companyId)
  try {
    const usersSnap = await db.collection('usuarios').where('tenantId', '==', companyId).get();
    const usersList = [];
    usersSnap.forEach(doc => {
      usersList.push({ id: doc.id, ...doc.data() });
    });
    exportData.data['usuarios'] = usersList;
    exportData.metadata.tableCounts['usuarios'] = usersList.length;
  } catch (err) {
    console.error(`[Backup] Erro ao extrair 'usuarios':`, err.message);
    exportData.data['usuarios'] = [];
  }

  // 4. Exportar as demais tabelas filtradas por tenantId
  for (const collectionName of COLLECTIONS_TO_BACKUP) {
    try {
      const snap = await db.collection(collectionName).where('tenantId', '==', companyId).get();
      const records = [];
      snap.forEach(doc => {
        records.push({ id: doc.id, ...doc.data() });
      });
      exportData.data[collectionName] = records;
      exportData.metadata.tableCounts[collectionName] = records.length;
    } catch (err) {
      console.error(`[Backup] Erro ao extrair coleção '${collectionName}':`, err.message);
      exportData.data[collectionName] = [];
      exportData.metadata.tableCounts[collectionName] = 0;
    }
  }

  // 5. Validar que exportou dados estruturados e calcular o Checksum SHA-256
  const dataString = JSON.stringify(exportData.data);
  const checksum = crypto.createHash('sha256').update(dataString).digest('hex');
  exportData.metadata.checksum = checksum;

  const finalJsonString = JSON.stringify(exportData);

  // 6. Compressão com Gzip -- assincrona: a versao sincrona travava o servidor
  // inteiro (PIN, fiscal, webhook) por varios segundos numa empresa grande.
  const gzipBuffer = await gzip(Buffer.from(finalJsonString, 'utf8'));

  // 7. Criptografia AES-256-GCM (ver backupCripto.js)
  const encryptedBuffer = cifrar(gzipBuffer, getEncryptionKey());

  // 8. Nome do arquivo
  const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm');
  const filename = `backup_${timestamp}.json.gz`;

  // 9. Salvar os logs e o histórico de backups no banco (Coleção 'backups_historico')
  const backupDocRef = db.collection('backups_historico').doc();
  const backupRecord = {
    id: backupDocRef.id,
    companyId,
    companyName,
    filename,
    sizeBytes: encryptedBuffer.length,
    status: 'gerando',
    createdAt: new Date().toISOString(),
    tableCounts: exportData.metadata.tableCounts,
    checksum
  };
  await backupDocRef.set(backupRecord);

  // 10. Enviar para o Google Cloud Storage
  let storagePath = null;
  let uploadSuccess = false;

  try {
    storagePath = await uploadBackup(companyId, companyName, filename, encryptedBuffer, {
      checksum,
      sizeBytes: String(encryptedBuffer.length)
    });
    uploadSuccess = true;
  } catch (err) {
    console.error(`[Backup] Erro no upload para o Cloud Storage:`, err.message);
  }

  const localBackupPath = path.join(
    __dirname,
    '../',
    process.env.BACKUP_LOCAL_TEMP_PATH || './storage/backups'
  );

  if (uploadSuccess) {
    // Atualiza status no banco para "enviado"
    await backupDocRef.update({
      status: 'enviado',
      storagePath
    });

    // Aplica política de retenção automática de backups no Cloud Storage
    await applyRetentionPolicy(companyId, companyName);

    console.log(`[Backup] Backup concluído e sincronizado na nuvem com sucesso para ${companyName}.`);
    return { ...backupRecord, status: 'enviado', storagePath };
  } else {
    // Fallback: Salva localmente se a nuvem falhar
    if (!fs.existsSync(localBackupPath)) {
      fs.mkdirSync(localBackupPath, { recursive: true });
    }

    const localFilePath = path.join(localBackupPath, `${companyId}_${filename}`);
    fs.writeFileSync(localFilePath, encryptedBuffer);

    await backupDocRef.update({
      status: 'pendente',
      localPath: localFilePath
    });

    console.warn(`[Backup] Upload falhou. Backup salvo temporariamente localmente em: ${localFilePath}`);
    return { ...backupRecord, status: 'pendente', localPath: localFilePath };
  }
}

/**
 * Um backup por vez neste processo. Cada backup carrega a empresa inteira na
 * memoria (JSON + gzip + cifra); dois ao mesmo tempo (cron de duas empresas
 * no mesmo horario, ou clique repetido no painel) dobravam o pico e podiam
 * derrubar o processo na hospedagem compartilhada. A fila e' uma corrente de
 * promessas: o proximo so' comeca quando o anterior termina, com ou sem erro.
 */
let filaDeBackups = Promise.resolve();

function generateCompanyBackup(companyId) {
  const execucao = filaDeBackups.then(() => gerarBackupDaEmpresa(companyId));
  filaDeBackups = execucao.catch(() => {});
  return execucao;
}

module.exports = {
  generateCompanyBackup,
  getEncryptionKey
};
