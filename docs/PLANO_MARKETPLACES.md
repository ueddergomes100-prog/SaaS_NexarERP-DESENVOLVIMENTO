# Plano — Integração com Mercado Livre e Shopee

Levantamento e decisões de 2026-10-05. Estimativa original: ~21 a 28 dias úteis
para o primeiro pacote (sem criar anúncio pelo ERP e sem conciliação financeira),
mais a espera de aprovação de parceiro da Shopee.

## O que já existe (05/10/2026)

- Tela `/integracoes/marketplaces` é só vitrine (`RoadmapModule`), nada funciona.
- Cadastro do produto já tem SKU, EAN, marca, peso, dimensões, "Descrição
  marketplace" e "Imagens" (URLs em texto, sem upload).
- Backend na Hostinger sempre ligado, com `node-cron`, webhook da Spedy,
  `fetchComTimeout` (regra 6 do CLAUDE.md) e rate limit.
- NF-e pela Spedy já funciona; fluxo pré-venda → conferência → faturamento existe.

## Decisões do dono (05/10/2026)

1. **Pedido do marketplace segue o fluxo da empresa**, com opção na tela da
   integração: **"Gerar como: Pré-venda | Pedido"**.
   - Escolher **Pré-venda** exige que a empresa trabalhe com pré-venda
     (`trabalhaComPreVenda` em Configurações). Se não estiver marcado, a tela
     **bloqueia com mensagem** pedindo para marcar "Trabalha com pré-venda"
     (CLAUDE.md, regra 1: bloquear com mensagem clara, nunca contornar).
   - **Pedido** (venda direta) depende do servidor criar venda — item 8 da
     auditoria, fatia 3 (fechamento de venda no servidor). Até lá, só
     Pré-venda fica disponível; a opção Pedido aparece desabilitada com o motivo.
2. **Nota fiscal pela Spedy, normal** (não usar o faturador do Mercado Livre).
   Depois de emitida, o XML/chave é enviado ao marketplace
   (ML: `/packs/{id}/fiscal_documents`; Shopee: dados da nota antes do envio).
3. **Preço com duas opções por canal:**
   - **Automático:** toda alteração de preço no ERP vai para o anúncio.
   - **Manual:** botão "Enviar preço" (por produto e em lote).
   - A definir na implementação: qual preço vai (preço de venda do produto ou um
     preço próprio do canal / ajuste %). Princípio que vale para o sistema todo:
     o ERP nunca reajusta preço sozinho — "automático" aqui é só *repassar* ao
     anúncio o preço que alguém alterou no ERP.
4. **Primeiro cliente: Mercado Livre tradicional** (Mercado Envios, estoque no
   próprio vendedor). **Full fica fora** do primeiro pacote.

## Fases

| Fase | Entrega | Dias |
|---|---|---|
| 0. Base comum | Tela de conexão (no lugar da vitrine), configuração por canal (pré-venda/pedido, preço automático/manual), tokens só no servidor, renovação automática, webhooks com fila, vínculo produto ↔ anúncio por SKU, rules dev+prod | 3–4 |
| 1. Mercado Livre | Vincular anúncios, estoque ERP → ML (variações), pedido → pré-venda, NF-e Spedy → ML, etiqueta, cancelamento, preço automático/manual | 8–10 |
| 2. Shopee | O mesmo (assinatura HMAC, nota antes do envio) | 7–9 |
| 3. Homologação | Conta real, ajustes | 3–5 |
| Opcional | Criar anúncio pelo ERP (+8–10), conciliação financeira de repasses (+3–4) | |

## Pendências do dono (fora do código)

- **Mercado Livre:** criar o aplicativo em developers.mercadolivre.com.br (conta
  do Hennder), com a URL de retorno que será informada na fase 0
  (`https://api.nexarcompany.com.br/api/marketplaces/mercadolivre/retorno`).
  Guardar Client ID e Client Secret — vão para as variáveis da Hostinger, nunca
  para o código nem para o Firestore.
- **Shopee:** abrir o cadastro de Parceiro no Open Platform (tipo "ERP System");
  a aprovação depende da Shopee e pode demorar.
- Confirmar com o primeiro cliente: conta do ML, se usa variações (cor/tamanho)
  e se os SKUs dos anúncios batem com o código dos produtos no ERP.

## Fontes

- Mercado Livre: autenticação (token 6 h, refresh de uso único), notificações
  `orders_v2`, upload de notas fiscais — developers.mercadolivre.com.br
- Shopee Open Platform: app "ERP System", sandbox + Go Live (~24 h de análise),
  token 4 h, assinatura HMAC-SHA256, nota obrigatória antes do envio no Brasil.
