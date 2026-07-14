const { db } = require('../config/firebase');
const crypto = require('crypto');
const zlib = require('zlib');
const { downloadBackup } = require('./cloudStorage');
const { getEncryptionKey, generateCompanyBackup } = require('./backup');

// Lista das coleções de destino a serem limpas e restauradas
const COLLECTIONS_TO_RESTORE = [
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
 * Descriptografa um buffer seguro criptografado com AES-256-CBC
 * Extrai o IV dos primeiros 16 bytes do buffer.
 */
function decryptBuffer(buffer) {
  const key = getEncryptionKey();
  const iv = buffer.slice(0, 16);
  const ciphertext = buffer.slice(16);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  
  return decrypted;
}

/**
 * Limpa todos os documentos de uma determinada empresa (tenantId) nas coleções
 * utilizando lotes (batches) de até 500 itens.
 */
async function clearCompanyData(companyId) {
  console.log(`[Restauração] Limpando dados atuais da empresa ${companyId}...`);

  // Limpa configuracao da empresa
  try {
    await db.collection('configuracoes').doc(companyId).delete();
  } catch (err) {
    console.warn(`[Restauração] Erro ao limpar 'configuracoes':`, err.message);
  }

  // Limpa demais coleções estruturadas
  for (const colName of COLLECTIONS_TO_RESTORE) {
    let hasMore = true;
    while (hasMore) {
      // Busca em blocos de 400 para garantir folga no limite de 500 operações por batch
      const snap = await db.collection(colName)
        .where('tenantId', '==', companyId)
        .limit(400)
        .get();

      if (snap.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      snap.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`[Restauração] Deletados ${snap.size} documentos da coleção '${colName}'...`);
    }
  }

  // Limpa usuários vinculados à empresa (ignora o dono se o UID dele for o tenantId)
  let usersHasMore = true;
  while (usersHasMore) {
    const snap = await db.collection('usuarios')
      .where('tenantId', '==', companyId)
      .limit(400)
      .get();

    // Filtra para remover apenas funcionários, mantendo o dono (UID == tenantId)
    const docsToDelete = snap.docs.filter(doc => doc.id !== companyId);
    
    if (docsToDelete.length === 0) {
      usersHasMore = false;
      break;
    }

    const batch = db.batch();
    docsToDelete.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`[Restauração] Deletados ${docsToDelete.length} usuários vinculados...`);
    
    if (snap.size < 400) {
      usersHasMore = false;
    }
  }
}

/**
 * Restaura os dados importados no Firestore usando batches sequenciais.
 */
async function writeRestoredData(companyId, backupData) {
  console.log(`[Restauração] Gravando novos dados restaurados para ${companyId}...`);

  // 1. Grava configurações se existirem
  if (backupData['configuracoes']) {
    const configData = { ...backupData['configuracoes'] };
    const docId = configData.id || companyId;
    delete configData.id;
    await db.collection('configuracoes').doc(docId).set(configData);
    console.log(`[Restauração] Configurações da empresa gravadas com sucesso.`);
  }

  // 2. Grava usuários da empresa (garante que não sobrescreve o admin principal caso haja mudanças)
  if (backupData['usuarios'] && Array.isArray(backupData['usuarios'])) {
    const users = backupData['usuarios'];
    let batch = db.batch();
    let opCount = 0;

    for (const u of users) {
      const uData = { ...u };
      const docId = uData.id;
      delete uData.id;

      // Se for o dono do tenant (UID == tenantId), mescla as informações ou ignora se já logado
      if (docId === companyId) {
        // Gravamos como merge para não perder sessões ou chaves ativas do administrador
        await db.collection('usuarios').doc(docId).set(uData, { merge: true });
        continue;
      }

      batch.set(db.collection('usuarios').doc(docId), uData);
      opCount++;

      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
    console.log(`[Restauração] ${users.length} usuários importados.`);
  }

  // 3. Grava demais coleções
  for (const colName of COLLECTIONS_TO_RESTORE) {
    const list = backupData[colName];
    if (!list || !Array.isArray(list) || list.length === 0) continue;

    console.log(`[Restauração] Importando ${list.length} registros para '${colName}'...`);
    let batch = db.batch();
    let opCount = 0;

    for (const item of list) {
      const itemData = { ...item };
      const docId = itemData.id;
      delete itemData.id;

      // Garante que o tenantId do registro restaurado corresponde ao tenant de destino (Prevenção de Injeção)
      itemData.tenantId = companyId;

      batch.set(db.collection(colName).doc(docId), itemData);
      opCount++;

      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      await batch.commit();
    }
  }

  console.log(`[Restauração] Gravação de dados concluída para ${companyId}.`);
}

/**
 * Orquestra todo o processo de restauração segura.
 */
async function restoreCompanyBackup(companyId, companyName, filename, userEmail) {
  if (!db) {
    throw new Error('Banco de dados Firestore não inicializado ou inacessível.');
  }

  console.log(`[Restauração] Iniciando restauração para ${companyName} (${companyId}) a partir do arquivo: ${filename}`);

  // Passo 1: Disparar Backup de Emergência (Segurança) do estado atual do cliente
  let safetyBackup = null;
  try {
    console.log(`[Restauração] Gerando backup automático de segurança antes da restauração...`);
    safetyBackup = await generateCompanyBackup(companyId);
    console.log(`[Restauração] Backup de segurança gerado com sucesso: ${safetyBackup.filename}`);
  } catch (err) {
    console.error(`[Restauração] Falha crítica ao gerar backup de segurança anterior:`, err.message);
    throw new Error(`Restauração cancelada por segurança: não foi possível gerar o backup de emergência da base de dados atual. Detalhes: ${err.message}`);
  }

  // Passo 2: Baixar o arquivo de backup do Cloud Storage
  let encryptedBuffer;
  try {
    encryptedBuffer = await downloadBackup(companyId, companyName, filename);
  } catch (err) {
    throw new Error(`Erro ao baixar o arquivo de backup do Cloud Storage: ${err.message}`);
  }

  // Passo 3: Descriptografar e Descompactar
  let decryptedJson;
  try {
    const decryptedBuffer = decryptBuffer(encryptedBuffer);
    const gunzippedBuffer = zlib.gunzipSync(decryptedBuffer);
    decryptedJson = JSON.parse(gunzippedBuffer.toString('utf8'));
  } catch (err) {
    throw new Error(`Falha ao descriptografar ou descompactar o arquivo. Chave inválida ou arquivo corrompido: ${err.message}`);
  }

  // Passo 4: Validar Integridade e Pertencimento
  const metadata = decryptedJson.metadata;
  const data = decryptedJson.data;

  if (!metadata || !data) {
    throw new Error('Estrutura de arquivo de backup inválida ou incompleta.');
  }

  // Validação 4.1: Confere se o backup pertence a esta empresa (Prevenção de cruzamento de tenants)
  if (metadata.companyId !== companyId) {
    throw new Error(`Falha de Segurança: O arquivo de backup pertence à empresa ID (${metadata.companyId} - ${metadata.companyName}), mas você está tentando restaurar na empresa ID (${companyId} - ${companyName}). Operação bloqueada.`);
  }

  // Validação 4.2: Recalcular o Checksum SHA-256 dos dados e comparar com os metadados do arquivo
  const dataString = JSON.stringify(data);
  const recalculatedChecksum = crypto.createHash('sha256').update(dataString).digest('hex');

  if (recalculatedChecksum !== metadata.checksum) {
    throw new Error('Erro de Integridade: O Checksum SHA-256 calculado não confere com o original do backup. Os dados podem ter sido adulterados ou corrompidos.');
  }

  // Passo 5: Executar restauração (Operações de Escrita em Lote)
  try {
    // 5.1 Limpa os dados do Firestore atuais
    await clearCompanyData(companyId);

    // 5.2 Grava os dados descriptografados
    await writeRestoredData(companyId, data);

    // Passo 6: Registrar histórico de restauração (Coleção 'restauracoes_historico')
    const restoreRecord = {
      companyId,
      companyName,
      filename,
      restoredBy: userEmail,
      timestamp: new Date().toISOString(),
      safetyBackupFilename: safetyBackup.filename,
      status: 'sucesso'
    };
    await db.collection('restauracoes_historico').add(restoreRecord);

    console.log(`[Restauração] Processo de restauração de ${companyName} finalizado com absoluto sucesso.`);

    return {
      message: 'Restauração realizada com sucesso.',
      safetyBackupFilename: safetyBackup.filename,
      timestamp: restoreRecord.timestamp
    };
  } catch (restoreError) {
    console.error(`[Restauração] Falha crítica durante a gravação dos dados:`, restoreError.message);
    
    // Como foi em lotes sequenciais, um erro no meio pode deixar a base parcial.
    // Registra a falha na coleção
    await db.collection('restauracoes_historico').add({
      companyId,
      companyName,
      filename,
      restoredBy: userEmail,
      timestamp: new Date().toISOString(),
      safetyBackupFilename: safetyBackup.filename,
      status: 'erro',
      error: restoreError.message
    });

    throw new Error(`Restauração falhou no meio do processo de gravação. Alguns dados podem ter sido corrompidos. Por segurança, recomendamos restaurar imediatamente o backup de salvaguarda automática gerado em: ${safetyBackup.filename}. Detalhes: ${restoreError.message}`);
  }
}

module.exports = {
  restoreCompanyBackup
};
