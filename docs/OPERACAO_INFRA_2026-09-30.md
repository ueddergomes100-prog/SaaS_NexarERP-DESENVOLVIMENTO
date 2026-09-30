# Operação e infraestrutura — o que mudou em 2026-09-30 e o que falta

Complemento de [`ANALISE_INFRAESTRUTURA_2026-09-30.md`](ANALISE_INFRAESTRUTURA_2026-09-30.md)
(a análise). Este arquivo diz **o que foi corrigido no código**, **o que só o dono
consegue fazer nos painéis** e **como conferir** que está tudo valendo.

---

## 1. O que foi corrigido no código (ordem da análise)

| # | Item | Onde | Estado |
|---|---|---|---|
| 1 | Backup: chave obrigatória avisada no `/health`; arquivo em **AES-256-GCM** (autenticado; o formato antigo CBC continua legível); gzip assíncrono; **um backup por vez** no processo | `server/services/backup.js`, `backupCripto.js`, `restore.js` | Feito. **Configurar `BACKUP_ENCRYPTION_KEY` na Hostinger é manual (seção 2).** |
| 2 | `/health` com prova de vida do Firestore (503 quando o banco não responde), lista de variáveis faltando, `seuIp`; log de uma linha por requisição; `unhandledRejection` não derruba mais o processo; encerramento gracioso no SIGTERM | `server/server.js`, `services/saude.js`, `services/configuracaoAmbiente.js` | Feito. **Monitor externo é manual (seção 2).** |
| 3 | Rate limit de verdade: `trust proxy` (`TRUST_PROXY_HOPS`), limite global por IP em `/api`, limites por IP + por e-mail/CNPJ/vendedor nas rotas públicas, teto total da consulta de CNPJ, limites por usuário em CPF/backup | `server/middleware/rateLimit.js`, `routes/onboarding`, `vendedorMobileAuth`, `documentos`, `backup` | Feito e testado localmente. **Conferir `seuIp` em produção (seção 3).** |
| 4 | Timeout em **toda** chamada externa do backend (Spedy 30/60/90 s, Receita 15 s, e-mail 20 s) e em toda chamada do front ao backend/ViaCEP, com mensagem em português | `server/utils/fetchComTimeout.js`, `src/utils/fetchComTimeout.ts` e todos os `src/services/*` | Feito. A NF-e já tinha `integrationId` (idempotência da Spedy), então retry após timeout não duplica nota. |
| 5 | Gate antes do push: `.githooks/pre-push` (dev: typecheck + testes; production: + lint) e workflow do GitHub (`.github/workflows/ci.yml`) | raiz | Feito. **Ativar em cada clone: `git config core.hooksPath .githooks`.** |
| 6 | Cabeçalhos de segurança e cache do front (`HSTS`, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `index.html` sem cache, chunks com hash 1 ano, MIME do manifest) | `public/.htaccess` | Feito no arquivo. **Só vale se a Hostinger honrar `.htaccess` — conferir (seção 3).** |
| 7 | `npm audit fix` no servidor (16 → 9 vulnerabilidades moderadas, 0 críticas); `backup-*.json` e `server/storage/` ignorados pelo Git | `server/package-lock.json`, `.gitignore` | Feito. |
| 8 | Mover venda/baixa/saldo para o servidor | — | **Não feito nesta rodada** — ver seção 4 (plano). |
| 9 | Dashboard: OS, pedidos e orçamentos consultados **só do período** (índice `tenantId+createdAt`, com fallback para a coleção inteira enquanto o índice não existe) | `src/pages/Dashboard/Dashboard.tsx`, `firestore.indexes.json` | Feito; índices publicados no **dev**. **Produção: publicar índices (seção 2).** |
| 10 | Lint 10 → 0 erros; `engines` no `server/package.json` (Node 22–24); 404 em JSON/português; CORS recusado responde 403 | vários | Feito. Render continua no ar: decisão do dono. |

Testes: 1.049 no front + **164** no servidor (26 novos), typecheck e lint limpos, build ok.

---

## 2. O que só o dono consegue fazer (painéis)

### Hostinger — aplicação `api.nexarcompany.com.br` → Variáveis de ambiente

| Variável | Por quê | Como saber que está certo |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | Sem ela **todo backup falha** em produção. Valor longo e aleatório (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). **Guardar o valor** fora do painel: sem ele nenhum backup é restaurável. | `/health` → `configuracao.backupCriptografado: true` e `pendencias` sem essa linha |
| `TRUST_PROXY_HOPS` | Quantos proxies existem antes do Node. Padrão `1`. | `/health` → `seuIp` = o seu IP público (compare com https://ifconfig.me). Se vier um IP interno (10.x, 172.x), troque para `2`; se vier o IP que você mesmo mandar em `X-Forwarded-For`, troque para `0`… mas isso não deve acontecer na Hostinger. |
| `ONBOARDING_CODE_SECRET`, `RESEND_API_KEY` + `EMAIL_FROM`, `SPEDY_WEBHOOK_SECRET`, `CORS_ORIGINS` | Já eram necessárias; agora o `/health` lista cada uma que falta em `pendencias`. | `pendencias: []` |

Depois de salvar variáveis, reimplantar a aplicação (o painel não recarrega o processo sozinho).

### Firebase — projeto de produção `nexus-erp-2026`

1. **PITR (Point-in-Time Recovery)** do Firestore: Console → Firestore → Recuperação de desastres → ativar (7 dias). É a rede de segurança que não depende do backup do sistema.
2. **Índices do Dashboard** (3 novos, já publicados no dev). Publicar em produção **antes ou depois** do push — o Dashboard funciona nos dois casos (cai na consulta inteira enquanto o índice não existe):
   ```bash
   npx --yes firebase-tools deploy --only firestore:indexes --project nexus-erp-2026 --account ueddergomes100@gmail.com
   ```
3. Alerta de orçamento (Billing → Budgets) e restrição da API key web por referrer (`accounts.nexarcompany.com.br`, domínio da Vercel) — não verificáveis daqui.

### Monitoramento (gratuito, 10 minutos)

- **UptimeRobot** (ou similar): monitor HTTP em `https://api.nexarcompany.com.br/health`, a cada 5 min, alertando em status ≠ 200. O `/health` responde **503** quando o Firestore não responde — é isso que dispara o alerta.
- Um segundo monitor em `https://accounts.nexarcompany.com.br/` (front).
- Erros do navegador/servidor (Sentry ou similar) ficam como próximo passo; não foi feito porque exige conta.

### Render

Continua no ar com código antigo. Ou desliga (economia) ou atualiza com `FIREBASE_SERVICE_ACCOUNT_BASE64` e o código atual para valer como rollback.

### Gate de push nas outras máquinas/clones

```bash
git config core.hooksPath .githooks
```

---

## 3. Como conferir em produção depois do deploy

```bash
# saúde + variáveis + IP que o servidor enxerga
curl -s https://api.nexarcompany.com.br/health

# 404 em português (era HTML do Express)
curl -s https://api.nexarcompany.com.br/api/nao-existe

# cabeçalhos do front (HSTS, nosniff, X-Frame-Options; index sem cache)
curl -s -D - -o /dev/null https://accounts.nexarcompany.com.br/ | grep -iE "strict|x-content|x-frame|referrer|cache-control"
```

Se os cabeçalhos do front **não** aparecerem, a Hostinger não está honrando o `.htaccess` nesse tipo de hospedagem: configurar no painel do site ("Configurações de compilação e saída" / cabeçalhos), se existir a opção.

O log de requisições (`[req] POST /api/... 200 812ms ip=... uid=...`) aparece nos logs da aplicação no hPanel.

---

## 4. Item 8 — mover venda, baixa e saldo para o servidor (plano, não executado)

**Por que não foi feito agora:** é a mudança mais invasiva do sistema. Fechar venda (`PedidoVendaForm`, 4.800 linhas), PDV, OS, baixa/estorno de títulos, cheques, boletos, nota avulsa, devolução e o app do vendedor gravam `pedidos_venda`, `transacoes`, `estoque.quantidade` e `bancos.saldoCentavos` direto do navegador, dentro de `runTransaction`. Mover isso exige reescrever cada fluxo como rota do servidor, reaproveitar o domínio (`financeDomain.ts`, `baixaFinanceiraDomain.ts`, `estoqueReservaDomain.ts`…) do lado do Node e **testar com login real** cada tela — nada disso dá para fazer às cegas numa sessão sem quebrar a operação dos clientes.

**Ordem sugerida (uma fatia por sessão, com o dono testando no dev):**

1. **Baixa e estorno de títulos** (`baixaFinanceiraService.ts` → `POST /api/financeiro/baixa` e `/estorno`). Menos telas (Contas a Pagar/Receber, Fluxo de Caixa), lógica já isolada, regras puras já testadas. Depois, tirar `financeiro.receber/pagar/estornar` de `canMoveBankBalance` nas rules.
2. **Movimento de saldo bancário** genérico (`POST /api/bancos/{id}/movimento` com origem obrigatória) e fechar `bancos` para escrita do cliente.
3. **Fechamento de venda/OS** (numeração, estoque, lotes, comissão, financeiro) — a maior. Antes, compilar os módulos de domínio TS para o servidor (`tsc` com saída CommonJS em `server/domain/`, gerado por script e versionado), para não reescrever regra financeira em duplicidade.
4. Por último, PDV e app do vendedor, que reaproveitam a rota da venda.

Enquanto isso não acontece, o que protege é o que já existe: permissão por usuário, log de auditoria com autor obrigatório, sequências só para frente, e o fato de que qualquer adulteração deixa rastro (título sem venda, saldo sem lançamento). Não é blindagem; é rastreabilidade.

---

## 5. Rollback

- **Backend/front:** `git revert` do(s) commit(s) e push em `production` (deploy automático em ~1 min). Nenhuma mudança de banco foi feita: os índices novos só aceleram consultas e podem ficar.
- **Rate limit muito apertado em produção** (429 para usuários legítimos): subir `RATE_LIMIT_MAX` nas variáveis da Hostinger e reimplantar, sem mexer em código.
- **Backup antigo (CBC)** continua restaurável: o formato é reconhecido pelo prefixo.
