const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Normaliza a chave privada vinda de variavel de ambiente.
 *
 * Dois estragos que painel de hospedagem faz com PEM e que precisam ser
 * desfeitos aqui (achados em producao, migrando o backend pra Hostinger):
 *
 * 1. ASPAS NAS PONTAS. Arquivo .env exportado costuma vir
 *    FIREBASE_PRIVATE_KEY='-----BEGIN...' -- quando o painel importa esse
 *    arquivo sem interpretar as aspas, elas viram parte do valor e o PEM
 *    fica invalido ("Failed to parse private key: Invalid PEM formatted
 *    message"). Tirar aqui e' barato e nao tem efeito nenhum quando o valor
 *    ja vem limpo.
 * 2. QUEBRAS ESCAPADAS. `\n` literal precisa virar quebra de linha real.
 *    Ja era feito antes; mantido.
 */
const normalizarChavePrivada = (valorBruto) => {
  let chave = String(valorBruto || '').trim();
  if (!chave) return '';

  const primeiro = chave[0];
  const ultimo = chave[chave.length - 1];
  if ((primeiro === "'" || primeiro === '"') && primeiro === ultimo) {
    chave = chave.slice(1, -1);
  }

  return chave.replace(/\\n/g, '\n');
};

/**
 * Diagnostico das variaveis de credencial -- SO nome, presenca e tamanho,
 * nunca o valor.
 *
 * Existe porque a falha real que aconteceu em producao era invisivel: o
 * servidor subia, dizia "online", respondia /health com 200, e so as rotas
 * que tocam no banco quebravam. O log dizia apenas "inicializado com
 * credenciais padrao", sem dizer QUAL variavel faltou. Custou horas.
 */
const diagnosticoCredencial = () => (
  ['FIREBASE_SERVICE_ACCOUNT_BASE64', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .map((nome) => {
      const valor = process.env[nome];
      if (valor === undefined) return `${nome}=AUSENTE`;
      if (!String(valor).trim()) return `${nome}=VAZIA`;
      return `${nome}=presente (${String(valor).length} caracteres)`;
    })
    .join(' | ')
);

/**
 * Le a conta de servico de uma das duas formas aceitas, nesta ordem:
 *
 * 1. FIREBASE_SERVICE_ACCOUNT_BASE64 -- o JSON inteiro da conta de servico
 *    em base64. RECOMENDADO em hospedagem: base64 e' uma linha so, sem
 *    quebra, aspas ou caractere especial, entao nenhum painel consegue
 *    corromper. Tambem mantem project_id, client_email e private_key numa
 *    fonte unica, em vez de tres variaveis que podem divergir.
 * 2. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY -- formato antigo,
 *    mantido pra nao quebrar ambiente nenhum que ja esteja configurado
 *    assim (o Render usa este).
 */
const lerContaDeServico = () => {
  const base64 = String(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '').trim();

  if (base64) {
    const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    if (!json.client_email || !json.private_key) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 decodificou, mas nao tem client_email/private_key. Confira se o base64 e\' do JSON da conta de servico.');
    }
    return {
      origem: 'FIREBASE_SERVICE_ACCOUNT_BASE64',
      projectId: process.env.FIREBASE_PROJECT_ID || json.project_id,
      clientEmail: json.client_email,
      privateKey: json.private_key
    };
  }

  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = normalizarChavePrivada(process.env.FIREBASE_PRIVATE_KEY);

  if (clientEmail && privateKey) {
    return {
      origem: 'FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY',
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail,
      privateKey
    };
  }

  return null;
};

let app;
try {
  if (process.env.NODE_ENV === 'production' && !process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID deve ser configurado em producao.');
  }

  const contaDeServico = lerContaDeServico();
  const projectId = (contaDeServico && contaDeServico.projectId)
    || process.env.FIREBASE_PROJECT_ID
    || 'sistema-nexus-dev';
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;

  if (contaDeServico) {
    if (!contaDeServico.privateKey.includes('BEGIN PRIVATE KEY')) {
      // Falha cedo e explicita. Sem isto, o admin.credential.cert() abaixo
      // estoura com "Invalid PEM formatted message", que nao diz ao operador
      // o que fazer.
      throw new Error(`A chave privada lida de ${contaDeServico.origem} nao parece um PEM valido (nao contem "BEGIN PRIVATE KEY"). Verifique se o painel de hospedagem nao truncou o valor.`);
    }

    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail: contaDeServico.clientEmail,
        privateKey: contaDeServico.privateKey
      }),
      storageBucket
    });
    console.log(`Firebase Admin SDK inicializado com Conta de Serviço (origem: ${contaDeServico.origem}, projeto: ${projectId}).`);
  } else {
    // Application Default Credentials. Em hospedagem isso quase sempre
    // significa "as variaveis nao chegaram" -- e nao um ambiente Google com
    // credencial implicita. Por isso o diagnostico vai junto: sem ele, o
    // sintoma e' /health respondendo 200 e todo o resto falhando.
    app = admin.initializeApp({ projectId, storageBucket });
    console.warn('Firebase Admin SDK inicializado SEM conta de serviço (credenciais padrão).');
    console.warn('Se este ambiente não for Google Cloud, o acesso ao Firestore vai falhar com "Could not load the default credentials".');
    console.warn(`Diagnóstico das variáveis: ${diagnosticoCredencial()}`);
  }
} catch (error) {
  console.warn('Alerta na inicialização do Firebase Admin SDK:', error.message);
  console.warn(`Diagnóstico das variáveis: ${diagnosticoCredencial()}`);
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

module.exports = { admin, db, storage, auth, normalizarChavePrivada };
