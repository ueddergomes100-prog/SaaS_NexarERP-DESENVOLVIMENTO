# App Check — passo a passo (2026-10-14)

**Para que serve:** o banco (Firestore), os arquivos (Storage) e o nosso servidor
passam a saber se o pedido veio **do sistema Hennder de verdade** ou de um script
por fora (alguém com um login disparando leituras em loop, por exemplo). Pergunta
do dono em 14/10: "não podemos sofrer com ataque de hacker ou usuários maliciosos
disparando requisições".

**Como está no código** (ramo `otimizar-leituras`):
- `src/services/firebase.ts` liga o App Check **só se** existir a chave
  `VITE_FIREBASE_APPCHECK_SITE_KEY` no `.env`. Sem ela, nada muda.
- Toda chamada ao nosso servidor leva o comprovante no cabeçalho
  `X-Firebase-AppCheck` (`src/utils/fetchComTimeout.ts`).
- O servidor confere e **só anota no log** (`appCheck=valido|invalido|ausente` em
  cada linha `[req]`). O bloqueio liga com a variável `APP_CHECK_EXIGIR=true`
  (`server/middleware/appCheck.js`). Ficam de fora: webhook da Spedy, `/health` e o
  encerramento de sessão (vai por `sendBeacon`, que não aceita cabeçalho).

**Começa só observando.** Nada é bloqueado até você decidir.

---

## 1. Criar a chave do reCAPTCHA Enterprise (uma por projeto)

Faça primeiro no projeto de **desenvolvimento** (`sistema-nexus-dev`) e depois no de
**produção** (`nexus-erp-2026`).

1. Google Cloud Console → escolha o projeto → menu **Segurança › reCAPTCHA**
   (se pedir, **Ativar** a API "reCAPTCHA Enterprise").
2. **Criar chave**:
   - Nome: `Hennder web`
   - Plataforma: **Site**
   - Domínios:
     - produção: `accounts.nexarcompany.com.br`
     - desenvolvimento: o domínio da Vercel do dev e `localhost`
   - Tipo: **baseado em pontuação** (sem caixinha "não sou um robô" — invisível
     para o usuário).
3. Copie o **ID da chave** (começa com `6L...`). Ele é público, igual ao resto da
   configuração do Firebase que já está no `.env`.

## 2. Registrar no Firebase

1. Firebase Console → mesmo projeto → **App Check** → aba **Apps**.
2. No app da Web, **Registrar** → provedor **reCAPTCHA Enterprise** → cole o ID da
   chave.
3. **Validade do token: 1 dia** (diminui as consultas ao reCAPTCHA e o custo).
4. **NÃO** clique em **Aplicar / Enforce** no Cloud Firestore nem no Storage ainda.

## 3. Me passar a chave

Mande o ID da chave de cada projeto. Eu coloco em:
- `.env.development` → chave do **dev**
- `.env.production` → chave de **produção**
- na **Vercel** (deploy do dev): variável `VITE_FIREBASE_APPCHECK_SITE_KEY` com a
  chave do dev (a Vercel usa as variáveis dela por cima do `.env`).

Rodando local (`npm run dev`), o sistema usa o **token de depuração** do Firebase:
ele aparece no console do navegador ("App Check debug token: ..."). Para o
computador local contar como verificado, cadastre esse token em **App Check ›
Apps › ⋮ › Gerenciar tokens de depuração** — só no projeto **dev**, nunca em
produção.

## 4. Observar (uns 7 dias)

- **Firebase › App Check › APIs › Cloud Firestore / Cloud Storage:** mostra quantos
  pedidos chegaram **verificados** e **não verificados**.
- **Log do servidor (Hostinger):** procurar `appCheck=ausente` e `appCheck=invalido`
  vindos de usuário de verdade.
- Esperado: quase tudo verificado. O que sobrar não verificado é navegador antigo,
  bloqueador de anúncio agressivo ou acesso por fora.

## 5. Ligar o bloqueio (quando a observação estiver limpa)

1. Firebase › App Check › APIs › **Cloud Firestore → Aplicar**; **Cloud Storage →
   Aplicar**.
2. Hostinger (variáveis do backend): `APP_CHECK_EXIGIR=true` e reiniciar o backend
   (fora do horário de pico).
3. Se algo legítimo for barrado, desligar é imediato: **Desaplicar** no console e
   `APP_CHECK_EXIGIR=false`.

## Custos e cuidados

- O reCAPTCHA Enterprise tem uma faixa gratuita mensal de avaliações; com token de 1
  dia, cada aparelho gasta cerca de uma por dia. Conferir o valor atual no próprio
  console do reCAPTCHA antes de ligar em produção.
- O app Vendas (instalado pela Play Store) é o mesmo site: usa a mesma chave.
- Junto com o App Check, ligar o **alerta de orçamento** do Google Cloud (Billing ›
  Budgets) — já está na lista de pendências.
