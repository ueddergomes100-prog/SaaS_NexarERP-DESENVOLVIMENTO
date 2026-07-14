const { db } = require('../config/firebase');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { uploadBackup, applyRetentionPolicy } = require('./cloudStorage');

// Lista das coleções que usam a filtragem tenantId
const COLLECTIONS_TO_BACKUP = [
  'clientes',
  'veiculos',
  'produtos',
  'estoque',
  'categorias',
  'servicos',
  'transacoes',
  'ordens_de_servico',
  'lembretes',
  'agendamentos',
  'pedidos_venda',
  'orcamentos',
  'devolucoes_venda',
  'unidades_medida',
  'notas_fiscais',
  'creditos_cliente'
];

/**
 * Deriva uma chave de 32 bytes a partir de qualquer senha informada (usando SHA-256)
 * para evitar erros de chave inválida no algoritmo AES-256-CBC.
 */
function getEncryptionKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BACKUP_ENCRYPTION_KEY é obrigatório em produção.');
    }

    console.warn('[Backup] BACKUP_ENCRYPTION_KEY ausente. Usando chave local apenas para desenvolvimento.');
  }

  const effectiveSecret = secret || 'NexusERPLocalDevelopmentKeyOnly2026!';
  return crypto.createHash('sha256').update(effectiveSecret).digest();
}

/**
 * Criptografa um buffer usando AES-256-CBC com um IV aleatório.
 * O IV (16 bytes) é colocado no início do buffer resultante.
 */
function encryptBuffer(buffer) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  const encrypted = Buffer.concat([
    iv,
    cipher.update(buffer),
    cipher.final()
  ]);
  
  return encrypted;
}

/**
 * Executa a rotina de exportação, compactação, criptografia e envio do backup para o Cloud Storage.
 */
async function generateCompanyBackup(companyId) {
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

  // 6. Compressão com Gzip (zlib)
  const gzipBuffer = zlib.gzipSync(Buffer.from(finalJsonString, 'utf8'));

  // 7. Criptografia AES-256-CBC
  const encryptedBuffer = encryptBuffer(gzipBuffer);

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

module.exports = {
  generateCompanyBackup,
  getEncryptionKey
};
