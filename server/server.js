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
const sessionRoutes = require('./routes/session.routes');
const onboardingRoutes = require('./routes/onboarding.routes');

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
app.use(express.json());

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
app.use('/api/sessions', sessionRoutes);
app.use('/api/onboarding', onboardingRoutes);

// Middleware para tratamento global de erros HTTP
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Ocorreu um erro interno inesperado no servidor de backups.'
  });
});

// Inicialização dos Serviços em Background
console.log('[Nexus Server] Inicializando serviços...');

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
