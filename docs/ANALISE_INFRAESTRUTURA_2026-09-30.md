> **Nota (mesmo dia, depois da análise):** os itens 1 a 7, 9 e 10 da seção 11 foram corrigidos no código na sequência — ver [`OPERACAO_INFRA_2026-09-30.md`](OPERACAO_INFRA_2026-09-30.md) para o que mudou e o que ainda depende do dono nos painéis. O item 8 (mover venda/baixa/saldo para o servidor) ficou planejado, não executado. Correção à seção 5: a emissão de NF-e/NFC-e já mandava `integrationId` para a Spedy (idempotência dela), então o risco de nota duplicada por timeout era menor do que está escrito abaixo; o que faltava era o timeout em si, agora presente.

# Análise de infraestrutura do Hennder ERP — 2026-09-30

Análise somente leitura. Nada foi alterado no código, no banco, na hospedagem ou nas configurações.
Fontes: código do repositório (commit `c8f3dea`), `firestore.rules`, sondas HTTP em produção
(`accounts.nexarcompany.com.br` e `api.nexarcompany.com.br`), projeto Firebase de **dev** via CLI
(produção não foi tocada, conforme a regra do projeto), `npm audit`, typecheck, testes e lint.

Severidade: **ALTA** = pode causar perda/adulteração de dado, indisponibilidade ou abuso real hoje;
**MÉDIA** = risco concreto que cresce com o uso; **BAIXA** = higiene.

---

## 1. Resumo executivo

| Área | Situação | Nota |
|---|---|---|
| Isolamento entre empresas (multi-tenant) | Sólido nas rules e no backend | Boa |
| Autenticação e PIN do vendedor | Bem feita (scrypt, bloqueio progressivo transacional) | Boa |
| Integridade dos dados financeiros | Depende do navegador: valores não são validados no servidor nem nas rules | **Fraca** |
| Limite de requisições (rate limit) | Só em 2 rotas públicas, contornável por cabeçalho | **Fraca** |
| Balanceamento de carga | Não existe: 1 processo Node em hospedagem compartilhada | Aceitável para o porte atual |
| Deploy | Automático, mas sem gate e reinicia o backend em horário comercial | **Fraca** |
| Monitoramento e alerta | Não existe nenhum | **Fraca** |
| Backups | Rotina existe, mas provavelmente falha em produção (chave não configurada) e é pesada | **Fraca** |
| Desempenho hoje | Backend 3 ms no upstream, front carrega em ~1 s | Boa |
| Desempenho futuro | Telas assinam coleções inteiras; cresce linear com o histórico | Risco crescente |
| Cabeçalhos de segurança | API com Helmet completo; **front sem nenhum** | Parcial |
| Qualidade de código | Typecheck limpo, 1.187 testes passando, lint com 10 erros (regrediu) | Boa com ressalva |

### Os 8 pontos que mais importam, em ordem

1. **ALTA — Venda, baixa financeira e saldo bancário são gravados direto pelo navegador.** As rules só conferem empresa e permissão, não o valor. Quem tem `vendas.pedidos` pode, pelo DevTools, gravar `saldoCentavos` de qualquer banco, `quantidade` de qualquer produto, ou criar `transacoes` de entrada com qualquer valor. Detalhe em 3.2.
2. **ALTA — Rate limit por IP contornável.** As duas rotas públicas confiam no primeiro valor de `X-Forwarded-For`, que o cliente controla. Permite disparar e-mails de código de verificação para qualquer endereço sem limite e usar o servidor como proxy de consulta de CNPJ. Detalhe em 4.
3. **ALTA — Push na `main` publica em produção na hora, sem teste, e reinicia o backend.** Hoje aconteceu 3 vezes entre 14:34 e 15:27. Requisição em andamento (emissão de NF-e, restauração de backup) cai. Detalhe em 5.
4. **ALTA — Backup em produção provavelmente nunca funcionou** (`BACKUP_ENCRYPTION_KEY` não confirmada, pendência registrada desde agosto) e a rotina carrega a empresa inteira na memória com compressão síncrona. Detalhe em 7.
5. **MÉDIA — Zero monitoramento.** Nenhum alerta de queda, erro ou custo. O incidente de 27/08 (backend "online" com credencial quebrada) passaria despercebido de novo. Detalhe em 8.
6. **MÉDIA — Dashboard e listas assinam coleções inteiras da empresa** (pedidos, OS, orçamentos, estoque, transações) sem limite, e o sistema de abas mantém tudo montado. Detalhe em 6.
7. **MÉDIA — Front na Hostinger sem cabeçalhos de segurança** (sem HSTS, X-Frame-Options, nosniff, CSP) e `index.html` sem `Cache-Control`. Detalhe em 3.3.
8. **MÉDIA — Sem timeout em nenhuma chamada externa** (Spedy, BrasilAPI, apicpf, Resend) nem no `fetch` do navegador. Tela fica presa em "Transmitindo..." e retry pode duplicar nota. Detalhe em 5.

---

## 2. Mapa do que roda onde (verificado hoje)

- **Frontend de produção**: `accounts.nexarcompany.com.br`, Hostinger (CDN `hcdn`), build Vite do repo, deploy automático no push em `production/main`. Deep link e F5 funcionam (200). HTTP redireciona para HTTPS (301).
- **Backend de produção**: `api.nexarcompany.com.br`, aplicação Node 22 na mesma conta Hostinger, Express 4, Helmet, CORS restrito. Upstream responde em 3 ms; latência total daqui 0,3 a 0,5 s (quase tudo TLS).
- **Backend de rollback**: Render (`sistema-nexus-company-commit.onrender.com`) continua no ar, respondendo 200, com código antigo.
- **Dados**: Firestore (projetos `nexus-erp-2026` prod / `sistema-nexus-dev` dev), Firebase Auth. Storage só é usado pelo backend (backups); o navegador não faz upload.
- **Terceiros críticos**: Spedy (fiscal), BrasilAPI (CNPJ no onboarding), apicpf.com (CPF), Resend/SendGrid (e-mail do onboarding, se configurado), SMTP de cada empresa (e-mail da nota).
- **Dev**: Vercel (front) + backend local.

Restarts do backend observados hoje (uptime do `/health`): início às 18:02 UTC e às 18:28 UTC. Batem com os pushes das 14:52 e 15:27 (horário local) — **é o deploy, não hibernação**. Entre o front publicar (17:53) e o backend voltar (18:02) houve uma janela de 9 minutos com front novo e backend velho/reiniciando.

---

## 3. Segurança

### 3.1 Backend (Express)

**O que está bom**
- Toda rota, exceto as 3 públicas por desenho (`/api/onboarding/*`, `/api/vendedor/mobile-login`, `/api/spedy-webhook/:secret`) e o `/health`, passa por `authenticate`, que verifica o ID token do Firebase e lê o perfil em `usuarios/{uid}`. Funcionário inativado é barrado também no servidor.
- O `tenantId` das operações sai do token, nunca do corpo (exceto para admin da plataforma). Confirmado em Spedy, trocas, cadastros, PIN, senha.
- Helmet ativo (HSTS 180 dias, nosniff, frame SAMEORIGIN, etc.). CORS só libera as origens configuradas; origem estranha é recusada.
- Chave da Spedy e senha SMTP nunca voltam ao navegador. O webhook da Spedy nunca confia no corpo: reconsulta a API antes de gravar. Ids da Spedy são validados antes de ir na URL (fecha o path traversal achado em 29/09).
- PIN: scrypt com salt, coleção `usuarios_pin` negada a todos nas rules, tentativa contada **antes** de conferir dentro de transação, bloqueio dobrando até 24 h. Login mobile só abre conta de `Funcionario`, nunca de dono/admin.
- Restauração e exclusão de backup fechadas para a equipe da plataforma.

**Problemas**
- **ALTA — Rate limit contornável** (ver seção 4).
- **MÉDIA — Sem tratamento de `unhandledRejection` / `uncaughtException` e sem shutdown gracioso.** Node 22 derruba o processo numa rejeição não tratada. As rotas têm try/catch, então o risco é baixo, mas a recuperação depende inteiramente da Hostinger reiniciar o processo. Nenhuma evidência de como ela trata isso.
- **MÉDIA — Segredos em texto puro no Firestore**: chave mestra da Spedy em `plataforma/spedy` (lida e escrita pelo navegador do SuperAdmin), chave Spedy + senha SMTP por empresa em `configuracoes_privadas` (legível pelo Master/Admin da empresa). O backend e o webhook ainda aceitam o campo legado `configuracoes.spedyApiKey`, que qualquer funcionário da empresa lê se algum tenant ainda o tiver. O Firestore criptografa em repouso, mas qualquer vazamento da service account entrega tudo.
- **BAIXA — CORS recusado responde 500** (o erro chega no handler global sem `status`). Deveria ser 403; polui qualquer monitor de erro futuro.
- **BAIXA — Rota inexistente devolve o HTML padrão do Express em inglês** (`Cannot GET /api/...`). Fere a regra 2 do CLAUDE.md e revela o framework.
- **BAIXA — `authenticate` faz 1 leitura no Firestore por requisição**, sem cache. Irrelevante hoje; vira custo com o PIN a cada venda em dezenas de estações.
- **BAIXA — Sem `express.static`, sem request log.** Investigar um incidente depende só do `console.log` que a Hostinger guardar.

### 3.2 Regras do Firestore (`firestore.rules`, 913 linhas)

**O que está bom**
- Isolamento por empresa vem do perfil (`usuarios/{uid}.tenantId`), não de claim do token: listar exige o filtro `tenantId`, criar exige `tenantId` igual ao do perfil, atualizar proíbe trocar `tenantId`.
- Tenant Admin só cria `Funcionario` e não muda `role`; o próprio usuário só edita sessão e nome; campos da plataforma (plano, limites, `spedyCompanyId`) só o servidor/SuperAdmin.
- Exclusão física fechada para SuperAdmin em todas as coleções. Situação ativo/inativo só via backend. Trocas só leitura no cliente. Sequências só andam para frente. Log de auditoria só em nome de quem está logado. `usuarios_pin` e `onboarding_pendentes` fechados.
- Ordem das expressões já otimizada para o limite de 1.000 avaliações do Firestore (documentado no próprio arquivo).

**Problemas**
- **ALTA — As rules não validam valor, só permissão.** Consequências concretas para um usuário comum com permissão de venda, pelo DevTools:
  - `canMoveBankBalance`: grava **qualquer** `saldoCentavos` em qualquer banco da empresa.
  - `canAdjustStockQuantity`: grava **qualquer** `quantidade` em qualquer produto.
  - `transacoes`: cria entrada/saída com qualquer valor, status e data (`vendas.pedidos` está na lista).
  - `pedidos_venda`: cria/edita pedido com desconto, total e status de pagamento arbitrários.
  Isso é consequência da arquitetura "o navegador grava direto", e vai contra a regra do dono de 21/09 ("nada altera via DevTools"). Trocas, situação de cadastro e PIN já foram movidos para o servidor; venda, baixa, caixa e banco ainda não. Não há como validar "delta de saldo" em rules; a solução é mover o fechamento de venda/baixa/estorno para o backend (ou Cloud Functions), por etapas.
- **MÉDIA — Risco de bater de novo no limite de 1.000 expressões.** As listas de coleção e permissão crescem a cada módulo; já aconteceu uma vez (estorno de venda em banco inativo). Sem teste automatizado de rules no repositório para pegar isso.
- **BAIXA — `usernames/{chave}` tem `allow get: if true`.** Qualquer pessoa, sem login, resolve `{cnpj}-{usuario}` para o e-mail sintético e o `tenantId`. Dá enumeração e alvo para força bruta no Firebase Auth (o Google limita, mas não bloqueia). Sem App Check, e as restrições da API key web não são verificáveis daqui.
- **BAIXA — Log de auditoria é gravado pelo cliente** (`logService.ts`). As rules impedem forjar o autor, mas não impedem **omitir** o log. Ações críticas de servidor já têm `services/auditoria.js`; as do navegador, não.

### 3.3 Frontend e hospedagem (Hostinger)

- **MÉDIA — Nenhum cabeçalho de segurança no front.** A resposta de `accounts.nexarcompany.com.br` traz só `Content-Security-Policy: upgrade-insecure-requests`. Faltam `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors` (clickjacking possível), `X-Content-Type-Options`, `Referrer-Policy`. O arquivo `public/_headers` (formato Netlify) é **ignorado** pela Hostinger.
- **MÉDIA — `index.html` sem `Cache-Control`.** O navegador aplica cache heurístico (10% da idade pelo `Last-Modified`). Depois de um deploy, um usuário pode receber `index.html` velho apontando para chunks que não existem mais. O `main.tsx` já mitiga (recarrega uma vez no `vite:preloadError`), mas a intenção de `no-store` em `_headers`/`firebase.json` não está valendo. Os assets com hash saem com `max-age=604800` (7 dias, política da Hostinger, não `immutable`) — aceitável.
- **BAIXA — `manifest.webmanifest` servido como `text/plain` e `sw.js` como `application/x-javascript`.** Funciona no Chrome, mas está fora do padrão e pode quebrar "Instalar app" em outros navegadores.
- **Bom**: HTTPS forçado, deep link funciona, service worker sem cache (decisão certa para dado financeiro), bot protection do CDN bloqueia `curl` nos assets (403) mas serve navegadores normalmente.

Carga inicial medida no navegador (login): 20 arquivos, **1,1 MB comprimido / 2,9 MB descomprimido**, `load` em 980 ms, TTFB 198 ms. O chunk `vendor` sozinho tem 1,67 MB (jspdf, sweetalert2, date-fns, router…); dá para fatiar mais, mas não é urgente.

### 3.4 Segredos e credenciais

- Credencial do Admin SDK local aponta para `sistema-nexus-dev` e fica fora do repositório (`H:/Firebase Keys Dev/...`). Correto.
- **MÉDIA — `backup-sol-life-202609241615.json` (80 KB, dados reais de cliente) está na raiz do repo, não versionado e não ignorado.** Um `git add .` manda dado de cliente para o GitHub. O `.gitignore` só ignora `*.zip`.
- **BAIXA — `.env.development` e `.env.production` estão versionados** apesar de `.gitignore` listar `.env.*`. Contêm só config pública do Firebase e URLs, então não é vazamento, mas a intenção diverge do que está no Git.
- **Pendência antiga não confirmada**: rotação da chave de service account que apareceu em texto puro numa conversa (Seção 9, item 16 do plano). O Render ainda usa o formato antigo de credencial.
- Scripts soltos na raiz (`fix_tenant.cjs`, `fix_colors.cjs`) apontam para caminhos de máquina antiga; são lixo, não risco.

### 3.5 Dependências (`npm audit`, só produção)

- **Backend: 16 vulnerabilidades (1 crítica, 2 altas, 13 moderadas).** A crítica é `websocket-driver` (via `firebase-admin` → Realtime Database, que o sistema não usa). **`npm audit fix` sem `--force` resolve** a maior parte; `uuid` moderado vem de `node-cron`/`google-gax`.
- **Frontend: 5 altas.** `xlsx` (ReDoS/prototype pollution, sem correção, só na tela de Importar Produtos, arquivo do próprio usuário) e `@grpc/grpc-js` (não vai para o bundle do navegador; o Firestore web usa WebChannel). Impacto real baixo.
- Versões principais estão atuais: React 19, Vite 8, Firebase 12, Express 4.19, firebase-admin 12 (13 disponível).

---

## 4. Limite de requisições e abuso

**Estado**: não há rate limit global. Existem dois limitadores em memória, um por arquivo:
- `/api/onboarding/*`: 30 req / 15 min por IP, por rota.
- `/api/vendedor/mobile-login`: 20 req / 15 min por IP.

**ALTA — Os dois são contornáveis.** `getRequestIp` usa o **primeiro** valor de `X-Forwarded-For`, e o Express está sem `trust proxy`. Proxies e CDNs normalmente **acrescentam** o IP real ao fim do cabeçalho que o cliente mandou, então o primeiro valor continua sendo o que o atacante escreveu. Cada requisição com um `X-Forwarded-For` diferente vira um "IP" novo com contador zerado. Não testei ao vivo em produção (seriam dezenas de requisições contra o servidor real); o comportamento exato depende de a borda da Hostinger limpar ou não o cabeçalho do cliente, e isso não está documentado.

O que fica exposto se o contorno funcionar:
- `/onboarding/start`: manda e-mail com código para **qualquer** endereço, sem limite → e-mail-bombing, reputação do domínio remetente, cota do Resend.
- `/onboarding/validate-cnpj`: consulta ilimitada na BrasilAPI usando o IP do servidor → pode bloquear o servidor lá e derrubar o onboarding para todos.
- `mobile-login`: força bruta no PIN continua barrada pelo bloqueio **por vendedor** (transação no Firestore), que não depende do IP. Boa defesa em profundidade.
- O `Map` dos buckets nunca é podado: chave nova a cada requisição forjada → memória cresce até o processo cair.

As rotas autenticadas não têm limite nenhum. Um usuário legítimo (ou token vazado) pode chamar `/api/spedy/*`, `/api/backups/generate` (dispara backup pesado em segundo plano, várias vezes) ou `/api/documentos/consultar-cpf` (custa dinheiro por consulta na apicpf) sem freio.

O que a Spedy devolve 429 é tratado no front (`SpedyApiError.retryable`). Isso é bom.

---

## 5. Disponibilidade, travamentos e balanceamento

**Balanceamento de carga: não existe.** Um único processo Node em hospedagem compartilhada (3 GB de RAM divididos entre 3–4 aplicações, 120 processos). Sem cluster, sem PM2, sem réplica. Escalar horizontalmente hoje **quebraria** o sistema: rate limit em memória, `node-cron` de backup dentro do processo (duas instâncias fariam dois backups), fila de reenvio idem. Firestore e Firebase Auth escalam sozinhos; o front é estático no CDN. Para o porte atual (uma dezena de estações por empresa, poucas empresas) o gargalo real não é o backend — só o PIN, o fiscal, o e-mail e o backup passam por ele.

**Deploy (ALTA)**
- Não há `.github/workflows`, nenhum teste roda antes de publicar. `git push production main` = produção em ~1 min, com o backend reinstalando dependências e reiniciando. Hoje: 3 restarts em menos de uma hora, em horário comercial.
- Front e backend publicam em momentos diferentes (9 min de diferença no primeiro deploy de hoje). Nesse intervalo, front novo fala com backend velho.
- Rollback do backend é manual (trocar `VITE_BACKEND_API_URL` e dar push). Não há tag/versão de release.
- `server/package.json` não fixa `engines`; Hostinger usa Node 22, local Node 24.

**Travamentos previsíveis**
- **MÉDIA — Sem timeout em chamadas externas.** `fetch` do Node para Spedy/BrasilAPI/apicpf/Resend sem `AbortSignal.timeout`; o padrão do undici é 300 s. O proxy da Hostinger provavelmente corta antes (valor desconhecido), o usuário vê erro, mas o servidor continua processando. Na emissão de NF-e isso significa: tela em "Transmitindo…", timeout, usuário clica de novo → **segunda nota na Spedy**. O `isSubmitting` da tela só evita clique duplo na mesma tentativa.
- **MÉDIA — Nenhum `fetch` do navegador tem `AbortController`/timeout.** Backend fora do ar = spinner infinito, sem mensagem.
- **Restauração de backup roda dentro da requisição HTTP**, apaga a empresa inteira e regrava em lotes sem atomicidade. Se o proxy cortar, a tela mostra erro enquanto o servidor segue restaurando; se o servidor cair no meio, a base fica parcial (o código reconhece isso e gera backup de segurança antes — bom).
- **Backup síncrono** (`gzipSync` + AES) bloqueia o event loop; durante esses segundos, PIN, fiscal e webhook não respondem. Um admin da plataforma pode disparar vários ao mesmo tempo.
- Recuperação de chunk obsoleto após deploy existe (reload automático em `main.tsx` e `ErrorBoundary`). Bom.

**Pontos únicos de falha, sem fallback automático**: Hostinger (front + API), Firebase, Spedy (todo o fiscal), BrasilAPI (todo o onboarding), SMTP da empresa.

---

## 6. Gargalos de desempenho e custo (Firestore)

- **MÉDIA — Dashboard assina 5 coleções inteiras da empresa** (`ordens_de_servico`, `pedidos_venda`, `orcamentos`, `estoque`, `transacoes`) com `onSnapshot` sem `limit`, e ordena em memória. Cada abertura baixa o histórico inteiro; cada gravação de qualquer colega reentrega o documento. Com 20 mil pedidos e 40 mil transações, abrir a Dashboard custa ~60 mil leituras, dezenas de MB e vários segundos, por usuário, por sessão. Hoje é rápido porque as bases são pequenas.
- 73 `onSnapshot` e 171 `getDocs` no front, só 18 com `limit()`. Não há paginação server-side em lugar nenhum; o projeto evita `orderBy` de propósito (para não precisar de índice composto: só 6 existem, e os 6 estão publicados no dev). É uma troca consciente: simplicidade agora, custo linear com o histórico depois.
- **O sistema de abas mantém toda aba montada** (`TabPane.tsx`). Cada aba aberta mantém seus listeners vivos; Dashboard não pausa quando fica em segundo plano. Com 6 abas, são dezenas de assinaturas de coleção inteira por estação.
- **Heartbeat de sessão a cada 30 s por usuário, via transação**, e `AuthContext` assina `usuarios where tenantId` (todos os colegas). Cada heartbeat de um usuário reentrega para todos os outros: N² entregas por minuto. Trivial com 12 usuários; perceptível com 50 por empresa.
- Contadores por sequência já estão separados (1 escrita/s por documento no Firestore); numeração, estoque e saldo rodam em `runTransaction` com tradução de erro para português. Corrida de limite de crédito fechada com versão. **Isso é o núcleo transacional correto** — não foi testado sob carga real, só por raciocínio e teste unitário (registrado no plano em 31/08).
- `loadTenantOptions` (navegador do SuperAdmin) e `getTenants` (backend) leem a coleção `usuarios` **inteira da plataforma**. Cresce com o número de clientes.
- Backend: `authenticate` = 1 leitura por requisição; PIN = 1 consulta + 1 transação + 1 update por venda. Barato.

---

## 7. Backups e recuperação

- Rotina: exporta todas as coleções da empresa → JSON → gzip → AES-256-CBC → Google Cloud Storage, com retenção 7/4/6 e fallback em disco local se o upload falhar. Restauração confere empresa e checksum antes de apagar/regravar, preserva campos da plataforma e gera backup de segurança antes. Desenho razoável.
- **ALTA — `BACKUP_ENCRYPTION_KEY` em produção**: com `NODE_ENV=production` e a variável vazia, `getEncryptionKey()` lança erro e **todo backup falha**. A memória do projeto diz que ela nunca foi configurada nem no Render nem na Hostinger. Não consigo confirmar daqui (exigiria ler `backups_historico` em produção). Se estiver assim, **não existe backup nenhum funcionando** hoje.
- AES-CBC sem HMAC (sem autenticação do ciphertext); chave derivada por SHA-256 do segredo sem KDF. Aceitável se o segredo for longo e aleatório; fraco se for uma senha curta.
- O agendamento (`node-cron`) só roda enquanto o processo está de pé. Cada deploy reinicia e recarrega; se a Hostinger dormir a aplicação, o backup das 02:00 não acontece.
- **Recomendação de rede de segurança que não depende do código**: ativar o Point-in-Time Recovery do Firestore (7 dias) no projeto de produção. Não é verificável daqui.

---

## 8. Operação: monitoramento, logs, custo

- **MÉDIA — Nenhum monitoramento.** Sem uptime check no `/health`, sem rastreamento de erro (Sentry ou similar) no front ou no backend, sem alerta de orçamento do Firebase conhecido. `/health` responde 200 mesmo com o Admin SDK sem credencial (exatamente o incidente de 27/08); um health check que faça uma leitura no Firestore evitaria isso.
- Logs: só `console.log`, sem estrutura, sem id de requisição, retidos pelo que a Hostinger guardar.
- Custo: Firestore cobra por leitura; o padrão "coleção inteira em tempo real" (seção 6) é o que vai crescer a fatura primeiro, não o backend.

---

## 9. Estado do código (verificado agora)

- `npm run typecheck`: limpo.
- Testes: **1.049** de domínio no front + **138** no backend, todos passando.
- ESLint: **10 erros e 70 avisos** (em 31/08 eram 0 erros e 65 avisos). 9 erros são `no-useless-assignment` inofensivos (`importacaoClientesDomain.ts`, `importacaoFornecedoresDomain.ts`, `Orcamentos.tsx`); **1 é real**: `VendedorMeusPedidos.tsx:199`, função impura chamada durante o render (regra do React Compiler). Os avisos de `exhaustive-deps` seguem como dívida controlada desde a auditoria de junho.
- Arquivos gigantes (`PedidoVendaForm.tsx` 4.823 linhas, `NFE.tsx` 3.537, `Configuracoes.tsx` 3.292) não são risco de infra, mas são onde bug de tela vai continuar nascendo.

---

## 10. O que não dá para verificar daqui (checklist para o dono)

Painel da Hostinger (aplicação `api`):
- [ ] `NODE_ENV=production`, `FIREBASE_PROJECT_ID=nexus-erp-2026`, `FIREBASE_SERVICE_ACCOUNT_BASE64`
- [ ] `BACKUP_ENCRYPTION_KEY` (e o valor guardado em lugar seguro)
- [ ] `ONBOARDING_CODE_SECRET`, `RESEND_API_KEY` + `EMAIL_FROM` (sem isso, cadastro novo falha com 503)
- [ ] `SPEDY_WEBHOOK_SECRET` igual ao registrado na Spedy
- [ ] `CORS_ORIGINS=https://accounts.nexarcompany.com.br`
- [ ] Como a borda trata `X-Forwarded-For` de cliente, timeout do proxy, limite de memória por app, política de reinício e se a aplicação dorme

Console do Firebase / Google Cloud (produção):
- [ ] PITR do Firestore ligado
- [ ] Alerta de orçamento (billing budget)
- [ ] Restrição da API key web por referrer (`accounts.nexarcompany.com.br`, Vercel de dev)
- [ ] Proteção contra enumeração de e-mail no Auth
- [ ] Rules e índices de produção iguais ao repositório (memória diz que as rules foram publicadas em 30/09)
- [ ] Chave de service account antiga revogada

Render:
- [ ] Decidir desligar (custo mensal, código desatualizado) ou atualizar credencial e código para ser um rollback de verdade

---

## 11. Ordem sugerida de correção (nada disto foi feito)

1. **Configurar/confirmar `BACKUP_ENCRYPTION_KEY` e ligar PITR** — é o único item que, se estiver errado, significa perda irrecuperável de dado. Meia hora.
2. **Uptime check no `/health` + alerta de erro** (UptimeRobot gratuito + Sentry gratuito). Meia hora. Fazer o `/health` ler um documento do Firestore.
3. **Rate limit correto**: `app.set('trust proxy', 1)` com o número certo de saltos da Hostinger, `express-rate-limit` global (por IP real) + limites por rota nas públicas, poda dos buckets. Uma tarde.
4. **Timeouts**: `AbortSignal.timeout` em todo `fetch` do backend (Spedy 60 s, BrasilAPI 15 s, e-mail 30 s) e no front. Meio dia. Junto: idempotência na emissão de nota (gravar a intenção local antes de chamar a Spedy, reconsultar antes de reemitir).
5. **Gate de deploy**: um workflow que roda `typecheck` + testes no push e só depois a Hostinger publica (ou pelo menos um script local obrigatório antes do `git push production`). Publicar fora do horário de pico. Meio dia.
6. **Cabeçalhos do front**: descobrir no painel da Hostinger onde configurar headers (ou `.htaccess` com `Header set`) e aplicar HSTS, `X-Frame-Options`, `nosniff`, `Cache-Control: no-store` no `index.html`. Uma hora.
7. **`npm audit fix` no `server/`** (sem `--force`) e ignorar `backup-*.json` no `.gitignore`. Minutos.
8. **Mover fechamento de venda, baixa e movimento de saldo para o backend**, no mesmo padrão de trocas/cadastros — é o item mais caro e o único que fecha de verdade a integridade financeira. Planejar por módulo, começar por baixa/estorno (menos telas).
9. **Dashboard e listas com limite/período** e pausa de listeners em aba inativa — antes que algum cliente chegue a dezenas de milhares de documentos.
10. Limpar os 10 erros de lint; decidir o destino do Render; fixar `engines` no `server/package.json`.
