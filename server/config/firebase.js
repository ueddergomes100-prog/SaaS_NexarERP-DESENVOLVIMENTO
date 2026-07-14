const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

let app;
try {
  if (process.env.NODE_ENV === 'production' && !process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID deve ser configurado em producao.');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'sistema-nexus-dev';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Substitui os caracteres de quebra de linha escapados da chave privada
  const privateKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined;

  if (clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
    });
    console.log('Firebase Admin SDK inicializado com Conta de Serviço.');
  } else {
    // Tenta inicializar com Application Default Credentials (ADC) ou de forma silenciosa
    // Para não travar caso o desenvolvedor não tenha fornecido as credenciais ainda
    app = admin.initializeApp({
      projectId,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
    });
    console.log('Firebase Admin SDK inicializado com credenciais padrão.');
  }
} catch (error) {
  console.warn('Alerta na inicialização do Firebase Admin SDK:', error.message);
  console.warn('Se você estiver rodando localmente, configure as chaves do Firebase em server/.env para poder acessar o Firestore e o Storage.');
}

const isInitialized = admin.apps.length > 0;
const db = isInitialized ? admin.firestore() : null;
const storage = isInitialized ? admin.storage() : null;
const auth = isInitialized ? admin.auth() : null;

// Configuração opcional para silenciar alertas do Firestore em modo de testes
if (db) {
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    // As configurações podem ser imutáveis se já inicializadas
  }
}

module.exports = { admin, db, storage, auth };
