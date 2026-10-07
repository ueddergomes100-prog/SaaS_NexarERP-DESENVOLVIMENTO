const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

const { version: VERSAO } = require('./package.json');
const { db } = require('./config/firebase');
const { initScheduler } = require('./services/scheduler');
const { initQueueService } = require('./services/queue');
const { diagnosticoConfiguracao, pendenciasDeProducao, trustProxyHops, emProducao } = require('./services/configuracaoAmbiente');
const { estadoDoFirestore } = require('./services/saude');
const { limitadorGlobalApi } = require('./middleware/rateLimit');
const { ipDoCliente } = require('./utils/requestIp');
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
const financeiroRoutes = require('./routes/financeiro.routes');
const condicionaisRoutes = require('./routes/condicionais.routes');
const filiaisRoutes = require('./routes/filiais.routes');
const transferenciasRoutes = require('./routes/transferencias.routes');
const { iniciarEspelhoDosCadastros } = require('./services/espelhoCadastros');

const app = express();
const PORT = process.env.PORT || 3001;

// Quantos proxies existem entre a internet e este processo (TRUST_PROXY_HOPS,
// padrao 1 = o proxy da hospedagem). Com isso o Express resolve `req.ip` a
// partir do IP que o PROXY acrescentou em X-Forwarded-For, e ignora o que o
// cliente escreveu -- e' o que faz o limite de requisicoes valer de verdade.
// Conferir no /health: `seuIp` tem que ser o seu IP publico, nao um IP interno.
app.set('trust proxy', trustProxyHops());

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

    const erro = new Error(`Origem não permitida pelo CORS: ${origin}`);
    erro.status = 403;
    callback(erro);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// Uma linha por requisicao no log da hospedagem: metodo, rota, status, tempo,
// IP e usuario (quando autenticado). Sem isso, investigar um incidente
// dependia so' dos console.error espalhados. O segredo do webhook da Spedy
// fica na URL e e' mascarado; /health fica fora pra nao poluir com o monitor.
const caminhoParaLog = (url) => {
  const caminho = String(url || '').split('?')[0];
  return caminho.startsWith('/api/spedy-webhook/') ? '/api/spedy-webhook/***' : caminho;
};
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    const uid = req.user && req.user.uid ? ` uid=${req.user.uid}` : '';
    console.log(`[req] ${req.method} ${caminhoParaLog(req.originalUrl)} ${res.statusCode} ${ms.toFixed(0)}ms ip=${ipDoCliente(req)}${uid}`);
  });
  next();
});

// Limite padrao do express.json() e' 100 KB: uma NF-e com ~130 itens (cada
// item leva o bloco de impostos) ja passava disso e voltava "request entity
// too large", em ingles, na tela.
app.use(express.json({ limit: '2mb' }));

// Freio global por IP em todo /api (ver middleware/rateLimit.js). As rotas
// publicas (onboarding, login do app) tem limites proprios, mais apertados.
app.use('/api', limitadorGlobalApi);

/**
 * Health check com prova de vida do banco. Responde 503 quando o Firestore
 * nao esta acessivel (credencial faltando, rede) -- e' isso que um monitor
 * externo precisa pra avisar. `configuracao` diz so' se cada variavel esta
 * PRESENTE, nunca o valor.
 */
app.get('/health', async (req, res) => {
  const firestore = await estadoDoFirestore(db);
  const configuracao = diagnosticoConfiguracao();
  const pendencias = emProducao() ? pendenciasDeProducao(configuracao) : [];
  res.status(firestore.ok ? 200 : 503).json({
    status: firestore.ok ? 'online' : 'degradado',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    versao: VERSAO,
    node: process.version,
    firestore: firestore.ok ? 'ok' : 'erro',
    ...(firestore.ok ? {} : { firestoreMotivo: firestore.motivo }),
    configuracao,
    pendencias,
    // O IP que o servidor enxerga pra quem chamou. Tem que ser o seu IP
    // publico; se vier um IP interno da hospedagem, TRUST_PROXY_HOPS esta errado.
    seuIp: ipDoCliente(req),
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
// Baixa e estorno de titulos (Contas a Pagar/Receber): saldo do banco e venda/OS
// sao gravados aqui, nao pelo navegador -- ver services/baixaFinanceira.js.
app.use('/api/financeiro', financeiroRoutes);
// Condicional (cliente leva para provar, devolve o que nao quer, o resto vira pre-venda):
// toda escrita e reserva de estoque aqui; as firestore.rules deixam a colecao so' para leitura.
app.use('/api/condicionais', condicionaisRoutes);
app.use('/api/filiais', filiaisRoutes);
app.use('/api/transferencias', transferenciasRoutes);

// Rota que nao existe: JSON em portugues, em vez do "Cannot GET /..." em HTML
// do Express (que ainda entregava o nome do framework de brinde).
app.use((req, res) => {
  res.status(404).json({ error: 'Este endereço não existe no servidor. Confira a URL ou atualize a página (F5).' });
});

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

// Promise rejeitada sem ninguem tratando derrubaria o processo inteiro (Node
// 15+), com toda requisicao em andamento junto. Loga e segue: o erro de uma
// rota nao pode tirar o servidor do ar pra todos os clientes.
process.on('unhandledRejection', (motivo) => {
  console.error('[Processo] Promise rejeitada sem tratamento (o servidor continua no ar):', motivo);
});
// Excecao sincrona fora de qualquer rota: o processo esta em estado
// indefinido, e' mais seguro encerrar e deixar a hospedagem subir de novo.
// (Sem este handler o Node faz o mesmo, so' que sem log legivel.)
process.on('uncaughtException', (erro) => {
  console.error('[Processo] Erro não tratado, encerrando para a hospedagem reiniciar:', erro);
  setTimeout(() => process.exit(1), 200).unref();
});

// Inicialização dos Serviços em Background
console.log('[Hennder Server] Inicializando serviços...');

// 1. Inicia o agendador node-cron de backups automáticos salvos no banco
initScheduler();

// 2. Inicia o verificador automático da fila de backups offline pendentes
initQueueService();

// Inicialização do servidor HTTP Express
const servidor = app.listen(PORT, () => {
  // Filiais (2026-10-06): mantem iguais os cadastros de clientes e produtos
  // das filiais de cada grupo -- ver services/espelhoCadastros.js.
  iniciarEspelhoDosCadastros();
  console.log(`===========================================================`);
  console.log(`🚀 SERVIDOR HENNDER ERP (v${VERSAO}) ONLINE NA PORTA :${PORT}`);
  console.log(`📅 Inicializado em: ${new Date().toLocaleString('pt-BR')}`);
  console.log(`🔀 trust proxy = ${trustProxyHops()} | ambiente = ${process.env.NODE_ENV || 'development'}`);
  const pendencias = emProducao() ? pendenciasDeProducao(diagnosticoConfiguracao()) : [];
  pendencias.forEach((pendencia) => console.warn(`⚠️  [Configuração] ${pendencia}`));
  console.log(`===========================================================`);
});

// Conexao keep-alive: o Node fecha em 5 s por padrao; um proxy que reaproveita
// a conexao por mais tempo pega "socket hang up" e devolve 502 ao usuario.
servidor.keepAliveTimeout = 65 * 1000;
servidor.headersTimeout = 66 * 1000;

// Deploy/reinicio da hospedagem manda SIGTERM: para de aceitar conexao nova,
// deixa as requisicoes em andamento terminarem (ate 10 s) e so' entao sai.
// Antes, o processo morria no meio de uma emissao de nota.
const encerrar = (sinal) => {
  console.log(`[Processo] ${sinal} recebido: parando de aceitar conexões...`);
  servidor.close(() => {
    console.log('[Processo] Conexões encerradas.');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[Processo] Encerramento forçado após 10 s com requisições ainda abertas.');
    process.exit(1);
  }, 10 * 1000).unref();
};
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
