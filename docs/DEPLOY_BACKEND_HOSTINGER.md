# Migrar o backend do Render para a Hostinger

Roteiro da parte manual. O código já está pronto — nada aqui exige alteração
no `server/`.

## Por que migrar

O backend (`server/`) roda hoje no **Render**, em plano **pago**, e a produção
aponta para lá (`VITE_BACKEND_API_URL` no `.env.production`). O plano
**Business Web Hosting** da Hostinger, que você já paga, mostra
**"Aplicações web: 3 / 5"** — dois slots livres. Migrar elimina uma mensalidade
sem perder nada.

O que foi verificado no hPanel em 2026-08-25: deploy automático do GitHub,
variáveis de ambiente com importação de `.env`, logs de execução, Node 22.x,
SSH, subdomínios e SSL. Limites: 3 GB de memória, 120 processos, 50 GB de
disco (1,63 GB em uso). Datacenter em **South America (Brazil)** — melhor que
o Render para o popup de PIN, que bate no servidor a cada venda.

## O único risco real: hibernação

**Não foi possível confirmar no painel se uma aplicação Node dorme por
inatividade.** Importa por dois motivos:

- **Cold start** na primeira venda do dia (o popup de identificação do
  vendedor trava até o servidor acordar);
- **`node-cron`**: o backend agenda backups automáticos (`initScheduler`) e
  varre a fila de backups pendentes (`initQueueService`). Isso só roda com o
  processo de pé.

No Render isso não é problema hoje: medi **uptime de 7,9 dias contínuos**.

Antes de desligar o Render, confirme com o suporte da Hostinger — ou deixe os
dois no ar por alguns dias e compare o `uptime` do `/health`.

## Passo a passo

### 1. Criar o subdomínio

hPanel → site `accounts.nexarcompany.com.br` → **Domínios → Subdomínios**.
Crie `api` (resultado: `api.nexarcompany.com.br`). Confirme que o SSL é
emitido para ele — **o front é HTTPS, e chamada para `http://` puro é
bloqueada pelo navegador**.

### 2. Criar a aplicação Node

hPanel → **Web Apps** → adicionar aplicação apontando para o subdomínio.

- **Repositório:** o mesmo repositório do sistema
- **Diretório raiz:** `server/` (não `./` — a raiz é o frontend)
- **Branch:** a que você usa para produção
- **Node:** 22.x
- **Start:** `npm start` (já definido em `server/package.json` → `node server.js`)

O `server/node_modules` **não** é versionado, então a plataforma instala as
dependências no deploy. Isso é o esperado.

### 3. Variáveis de ambiente

Copie do painel do Render (os **valores** ficam lá; nunca precisam passar por
aqui). A lista completa está em [`server/.env.example`](../server/.env.example).

Obrigatórias para o backend subir e funcionar:

| Variável | Observação |
|---|---|
| `NODE_ENV` | `production` |
| `FIREBASE_PROJECT_ID` | **`nexus-erp-2026`** (produção) |
| `FIREBASE_CLIENT_EMAIL` | service account |
| `FIREBASE_PRIVATE_KEY` | service account — quebras de linha como `\n` |
| `FIREBASE_STORAGE_BUCKET` | bucket dos backups |
| `CORS_ORIGINS` | `https://accounts.nexarcompany.com.br,https://gestao.nexarcompany.com.br` |
| `BACKUP_ENCRYPTION_KEY` | **obrigatória em produção** — sem ela o serviço de backup lança erro, e sem guardar o valor os backups já criados ficam irrecuperáveis |
| `ONBOARDING_CODE_SECRET` | obrigatório em produção |
| `SPEDY_WEBHOOK_SECRET` | precisa ser o **mesmo** já registrado na Spedy |

Não defina `PORT`: a plataforma injeta a dela, e o `server.js` já usa
`process.env.PORT`.

> **Atenção com a chave do Firebase Admin.** Ela **ignora todas as
> `firestore.rules`** — lê e escreve o banco inteiro, de todos os seus
> clientes. Use a chave do projeto certo e não a compartilhe fora do painel.

### 4. Verificar antes de virar a chave

Com o backend novo no ar e o Render **ainda ligado**:

```bash
curl -s https://api.nexarcompany.com.br/health
```

Deve responder `{"status":"online",...}`. Depois, o CORS:

```bash
curl -s -D - -o /dev/null -H "Origin: https://accounts.nexarcompany.com.br" https://api.nexarcompany.com.br/health
```

Precisa vir `access-control-allow-origin: https://accounts.nexarcompany.com.br`.

E uma rota autenticada (tem que dar **401**, não 404 nem 500):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.nexarcompany.com.br/api/spedy/config
```

### 5. Apontar o sistema para o backend novo

Em [`.env.production`](../.env.production), trocar:

```
VITE_BACKEND_API_URL=https://api.nexarcompany.com.br
```

Commit + push para o remote `production`. O site **redeploya sozinho** (deploy
automático do GitHub) e o build passa a usar a URL nova — lembrando que essa
variável é lida **no momento do build**, não em tempo de execução.

### 6. Reapontar o webhook da Spedy

O webhook aponta para a URL antiga. Registrar de novo em:

```
https://api.nexarcompany.com.br/api/spedy-webhook/<SPEDY_WEBHOOK_SECRET>
```

**Se este passo for esquecido, notas emitidas param de ter o status
atualizado** — e o sintoma aparece só depois, como nota "pendente" que nunca
resolve.

### 7. Só então desligar o Render

Depois de alguns dias com tudo funcionando, e depois de confirmar que a
aplicação na Hostinger não hiberna.

## Rollback

Reverter é uma linha: voltar `VITE_BACKEND_API_URL` para a URL do Render no
`.env.production`, commitar e deixar o deploy automático publicar. Por isso o
Render só deve ser desligado no fim.
