const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

const { initScheduler } = require('./services/scheduler');
const { initQueueService } = require('./services/queue');
const backupRoutes = require('./routes/backup.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares Globais de Segurança e Utilidades
app.use(helmet());
app.use(cors({
  // Permite conexões do frontend React do usuário (geralmente roda na porta 5173 com Vite)
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
