const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

const { initScheduler } = require('./services/scheduler');
const { initQueueService } = require('./services/queue');
const backupRoutes = require('./routes/backup.routes');
const spedyRoutes = require('./routes/spedy.routes');
const spedyCompaniesRoutes = require('./routes/spedyCompanies.routes');
const spedyWebhookRoutes = require('./routes/spedyWebhook.routes');
const sessionRoutes = require('./routes/session.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const vendedorPinRoutes = require('./routes/vendedorPin.routes');
const vendedorMobileAuthRoutes = require('./routes/vendedorMobileAuth.routes');
const usuariosRoutes = require('./routes/usuarios.routes');
const documentosRoutes = require('./routes/documentos.routes');
const cadastrosRoutes = require('./routes/cadastros.routes');
const devolucaoNfeRoutes = require('./routes/devolucaoNfe.routes');
const trocasRoutes = require('./routes/trocas.routes');
const notaRecebidaRoutes = require('./routes/notaRecebida.routes');
const notaEmailRoutes = require('./routes/notaEmail.routes');

const app = express();
const PORT = process.env.PORT || 3001;

const buildAllowedOrigins = () => {
  const configuredOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
  const firebaseOrigins = firebaseProjectId
    ? [
        `https://${firebaseProjectId}.web.app`,
        `https://${firebaseProjectId}.firebaseapp.com`
      ]
    : [];

  return new Set([
    ...configuredOrigins,
    ...firebaseOrigins,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
  ]);
};

const allowedOrigins = buildAllowedOrigins();

// Middlewares Globais de Segurança e Utilidades
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));
// Limite padrao do express.json() e' 100 KB: uma NF-e com ~130 itens (cada
// item leva o bloco de impostos) ja passava disso e voltava "request entity
// too large", em ingles, na tela.
app.use(express.json({ limit: '2mb' }));

// Rota de Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Vincular as rotas do módulo de backup
app.use('/api/backups', backupRoutes);
app.use('/api/spedy', spedyRoutes);
// Cadastro de empresa+certificado na Spedy -- admin da PLATAFORMA, nao do
// tenant (ver spedyCompanies.routes.js). Separado de spedyRoutes porque
// usa a chave MESTRA da conta, nunca a chave por tenant.
app.use('/api/spedy-admin', spedyCompaniesRoutes);
// Fora do middleware de autenticacao de spedyRoutes de proposito -- quem
// chama aqui e a propria Spedy, sem token Firebase (ver spedyWebhook.routes.js).
app.use('/api/spedy-webhook', spedyWebhookRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/onboarding', onboardingRoutes);
// Identificacao do vendedor na venda (codigo + PIN). Todas as rotas exigem
// token Firebase -- ver vendedorPin.routes.js.
app.use('/api/vendedor-pin', vendedorPinRoutes);
app.use('/api/vendedor', vendedorMobileAuthRoutes);
app.use('/api/usuarios', usuariosRoutes);
// Consulta de CNPJ (Receita Federal) pra validar Cliente/Fornecedor ja
// cadastrado. Todas as rotas exigem token Firebase -- ver documentos.routes.js.
app.use('/api/documentos', documentosRoutes);
// Inativar/reativar/excluir cadastros com checagem de pendencias -- a unica
// porta pra essas operacoes (as firestore.rules proibem a tela de fazer direto).
app.use('/api/cadastros', cadastrosRoutes);
// NF-e de devolucao de venda: o servidor monta a nota a partir do que esta gravado
// (devolucao, pedido, nota original) -- a tela so' diz QUAL devolucao emitir.
app.use('/api/devolucao-nfe', devolucaoNfeRoutes);
// Trocas de mercadoria (reposicao sem cobranca, pedida pelo app do vendedor): toda escrita e
// todo movimento de estoque passam por aqui; as firestore.rules deixam a colecao so' pra leitura.
app.use('/api/trocas', trocasRoutes);
app.use('/api/entrada-nfe', notaRecebidaRoutes);
// E-mail da nota fiscal ao cliente (PDF + XML) pelo SMTP da propria empresa -- ver notaEmail.routes.js.
app.use('/api/nota-email', notaEmailRoutes);

// Middleware para tratamento global de erros HTTP
// Erro que chega aqui e' da infraestrutura (corpo invalido, grande demais,
// origem bloqueada) -- as rotas tratam os proprios. Mensagem em portugues,
// sem repassar o texto cru da biblioteca pra tela (regra 2 do CLAUDE.md).
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err);
  const status = err.status || err.statusCode || 500;
  let mensagem = 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes; se continuar, fale com o suporte.';
  if (err.type === 'entity.too.large') {
    mensagem = 'Os dados enviados são grandes demais para uma operação só. Divida em partes menores (por exemplo, menos itens por nota) e tente de novo.';
  } else if (err.type === 'entity.parse.failed') {
    mensagem = 'O servidor recebeu dados inválidos. Atualize a página (F5) e tente de novo.';
  } else if (String(err.message || '').startsWith('Origem não permitida pelo CORS')) {
    mensagem = 'Este endereço não tem permissão para acessar o servidor. Use o endereço oficial do sistema.';
  }
  res.status(status).json({ error: mensagem });
});

// Inicialização dos Serviços em Background
console.log('[Hennder Server] Inicializando serviços...');

// 1. Inicia o agendador node-cron de backups automáticos salvos no banco
initScheduler();

// 2. Inicia o verificador automático da fila de backups offline pendentes
initQueueService();

// Inicialização do servidor HTTP Express
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 SERVIDOR NEXUS BACKUP & RESTORE ONLINE NA PORTA :${PORT}`);
  console.log(`📅 Inicializado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`===========================================================`);
});
