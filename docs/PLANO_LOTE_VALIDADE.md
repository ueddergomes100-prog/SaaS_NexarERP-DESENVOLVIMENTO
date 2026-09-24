# Plano: Lote e Validade

- **Criado em:** 2026-09-24
- **Origem:** pedido do dono depois de comparar a entrada de NF-e com o ERP antigo da Sol Life.
- **Estado:** PLANEJADO. Nada implementado ainda. As decisões da seção 1 já foram tomadas com o dono.

---

## 0. O que já existe (não refazer)

- Coleção **`estoque_lotes`**: `{ tenantId, produtoId, lote, validade (AAAA-MM-DD|null), quantidade, createdAt, updatedAt }`.
- Flag do produto **`controlarLote`** (Configurações Avançadas do cadastro do produto).
- Já usam lote: **Ajuste Manual de Estoque** (`AjusteEstoque.tsx` + `applyAjusteEstoqueManual` em `src/utils/firestoreAtomic.ts`) e a **entrega da troca** (`server/routes/trocas.routes.js`, `planoDeEntrega`).
- **Não usam lote (hoje baixam só `estoque.quantidade`):** venda (PDV, Pedido de Venda, Pré-venda faturada, Orçamento→venda, OS), devolução, produção, nota avulsa, e a **Entrada de NF-e** (guarda `lote`/`validade` só como texto no item da nota e no produto).
- A Entrada de NF-e já lê `rastro` do XML (nº do lote, fabricação, validade, quantidade) em `src/utils/nfeXmlDomain.ts` (`ItemDaNota.lotes`) e tem os campos Lote/Validade por item em `ItemDaNotaCard.tsx`.

## 1. Decisões do dono (2026-09-24)

1. **Configuração (Configurações → Avançado)** com **duas opções** para a saída de produto que controla lote:
   - **Automático:** o sistema escolhe o lote (FEFO: o que vence primeiro sai primeiro; lote sem validade por último).
   - **Informar o lote:** quem vende escolhe o lote na hora.
2. **Lote vencido: só AVISA** (não bloqueia a venda).
3. **Tela "Lotes e Validades"** já com os vencimentos em **15 / 30 / 45 dias** (e vencidos).
4. **Entrada de NF-e: SOLICITAR lote e validade** (exigir) quando o produto controla lote, criando/somando o lote na entrada.
5. Tela de Lotes e Validades = **só o que foi descrito** (saldo por lote, dias para vencer, filtros, alerta dos que vencem, relatório em PDF). Nada além disso.

Regras permanentes que valem aqui: relatório sempre em PDF na tela (memória `feedback_relatorios_sempre_pdf`), erro de tela em português dizendo o que fazer, nunca gravar `undefined`, nada de contornar cadastro incompleto do cliente na lógica (CLAUDE.md), regras/coleções novas exigem publicar rules em dev **e** produção antes do frontend (não deve haver coleção nova: `estoque_lotes` já existe).

## 2. Configuração nova (`configuracoes/{tenantId}`)

| Chave | Valores | Padrão | Efeito |
|---|---|---|---|
| `loteModoSaida` | `'automatico'` \| `'informar'` | `'automatico'` | Como o lote é escolhido na saída |
| `loteAvisarVencido` | boolean | `true` | Avisa ao vender lote vencido (a decisão é só avisar; a chave existe para desligar o aviso) |

- Onde: `src/pages/Configuracoes/Configuracoes.tsx` (seção Avançado) + expor no `AuthContext.tsx` (como `conferenciaMercadoriaAtiva`).
- Função pura em `src/utils/loteDomain.ts` (a criar), com testes: `ordenarLotesFefo`, `escolherLotesFefo(quantidade, lotes)` (devolve `[{loteId, quantidade}]`, pode dividir entre lotes, ignora saldo ≤ 0, lote vencido só entra se não houver outro? — **decidir na implementação**: automático deve pular vencido e avisar se só restar vencido), `situacaoDoLote(validade, hoje)` → `vencido | vence_15 | vence_30 | vence_45 | ok | sem_validade`, `diasParaVencer`.

## 3. Fases

### Fase 1 — Núcleo puro + configuração
1. `loteDomain.ts` + `tests/loteDomain.test.ts` (registrar nos 3 pontos de `scripts/run-finance-domain-tests.mjs`).
2. Chaves de configuração + opções na tela de Configurações + `AuthContext`.

### Fase 2 — Tela "Lotes e Validades"
- Rota nova (Estoque → Lotes e Validades), permissão de leitura do estoque.
- Lista por lote: produto, código, lote, validade, **dias para vencer**, saldo, situação (selo colorido).
- **Filtros/abas:** Vencidos · Vencem em 15 dias · 30 dias · 45 dias · Todos · busca por produto/lote. Contadores no topo.
- **Relatório em PDF** na tela (Imprimir/Salvar PDF, colunas por caixa de marcar), reaproveitando `RelatorioPreview` e o padrão dos outros relatórios; Excel só em botão separado.
- Atalho para o Ajuste de Estoque do produto.
- Leitura: `estoque_lotes` (+ nomes de `estoque`). Sem escrita nesta tela.

### Fase 3 — Entrada de NF-e (solicitar lote)
- Para item **vinculado a produto com `controlarLote`** (e item novo marcado para controlar lote): **exigir lote e validade** antes de confirmar (mensagem em português). Pré-preencher com o `rastro` do XML (`item.lotes`); se o XML trouxer mais de um lote no item, dividir a quantidade entre eles.
- Gravar **na mesma transação** da entrada (`EntradaNFE.tsx`, `handleConfirmarEntrada`): criar ou somar em `estoque_lotes` (chave: `tenantId + produtoId + lote`), e registrar `loteId` no item da nota (`NotaFiscalEntradaItemRecord`).
- **Exclusão da nota** (`NotasFiscaisEntradaList.tsx`) deve reverter também o saldo do lote (bloquear se o lote já foi consumido, como já faz com o estoque).
- Produto **sem** `controlarLote`: segue como hoje (lote/validade só informativos); não ligar o controle sozinho.

### Fase 4 — Saída por lote nas vendas (a mais delicada)
- Todos os caminhos que baixam estoque precisam respeitar a configuração: `applyStockAdjustments`/`applyStockFieldDeltas` em `src/utils/firestoreAtomic.ts` são o ponto único de baixa da venda — começar por aí. Levantar os chamadores (PDV, PedidoVendaForm, Pré-venda faturada, OS, Orçamento, Devolução, Nota Avulsa, Produção) antes de codar.
- **Automático:** o sistema escolhe o(s) lote(s) por FEFO, baixa `estoque_lotes` e `estoque.quantidade` na mesma transação e grava o lote no item da venda.
- **Informar:** a tela de venda pede o lote do item (lista de lotes com saldo e validade).
- **Vencido:** só avisa (uma vez por venda, listando os produtos/lotes).
- Estorno/devolução/cancelamento devolvem ao **mesmo lote** que saiu.
- Produto sem `controlarLote`: comportamento atual, sem mudança.
- Risco: estoque atual dos produtos que passarem a controlar lote **não tem lotes** (saldo "sem lote"). Definir com o dono como implantar (ex.: criar um lote "SALDO INICIAL" por produto no momento de ligar o controle) — **perguntar antes de ligar em cliente com estoque**.

### Fase 5 — Fechamento
- Testes de domínio + servidor (se a baixa da troca/venda passar a usar FEFO no servidor) + verificação no navegador (dev) de ponta a ponta.
- Memória do projeto + este plano atualizado.

## 4. Ordem recomendada para a próxima sessão

1. (Pendência antes) **Testar no navegador** o que ficou commitado local em `3d9de10` — Trocas na Fila de Expedição + Enter na conferência — e só então enviar aos 2 git. Precisa de login no painel e, para o fluxo da troca ponta a ponta, do backend local com a credencial do **dev** (hoje não configurada; o servidor sobe sem conta de serviço).
2. Fase 1 → 2 → 3 (entregam valor sem mexer na venda). Enviar depois de testar.
3. Fase 4 sozinha, com levantamento dos chamadores primeiro e teste dedicado (é a que pode quebrar venda).

## 5. Perguntas que ainda ficam para a Fase 4

- Como criar o lote inicial dos produtos que já têm estoque quando ligarem "Controlar lote"?
- Na saída automática, lote vencido: pular e usar o próximo, ou usar mesmo assim avisando? (proposta: pular; se só houver vencido, usar e avisar.)
- Produção (matéria-prima e produto acabado): entra no controle de lote agora ou depois?
