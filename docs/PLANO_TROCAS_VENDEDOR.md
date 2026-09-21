# Plano: Trocas pelo app do vendedor

- **Criado em:** 2026-09-21
- **Origem:** pedido do dono do produto (Sol Natus, produto natural). O produto chega ao cliente
  rasgado ou com bicho; o cliente descarta e a loja entrega outro igual, sem cobrar.
- **Estado:** PLANEJADO. Nada implementado ainda. Decisões da seção 1 já foram tomadas com o dono.

---

## 0. O que é uma troca (e o que NÃO é)

| | Venda | Devolução (já existe) | **Troca (este plano)** |
|---|---|---|---|
| Cobra do cliente | sim | reembolsa/credita | **não** |
| Estoque | baixa | **devolve** ao estoque | **baixa** só da reposição |
| Financeiro | sim | sim (saída/crédito) | **nenhum** |
| Comissão | sim | recalcula | **nenhuma** |
| Faturamento / ticket médio | entra | ajusta | **não entra** |

O item estragado **não volta** ao estoque (o cliente joga fora) e já saiu do estoque na venda original;
por isso a troca tem **uma única baixa**: a da mercadoria entregue de reposição.

---

## 1. Decisões já tomadas (2026-09-21)

1. **Tela e documento próprios ("Trocas")**, fora de pré-venda e pedido.
   *Por quê:* mais de 18 telas/serviços leem `pedidos_venda` e há mais de 30 pontos que comparam
   status de pedido na mão (`src/utils/preVendaDomain.ts` diz "nunca compare status na tela"). Uma
   troca de R$ 0,00 dentro de `pedidos_venda` entraria em ticket médio, ranking, contagem de vendas e
   comissão. Numa coleção própria isso é impossível por construção. Fica explícita: menu, selo
   TROCA e faixa "sem cobrança, sem comissão, sem financeiro".
2. **A loja aprova ou recusa** antes de separar. A recusa leva motivo e o vendedor vê no app.
3. **Foto do produto estragado: NÃO agora** (fica para a fase 2, opcional).
4. **Alerta anti-abuso: só avisar.** Se o cliente não comprou aquele produto nos últimos 60 dias, o aviso
   aparece para o vendedor (antes de enviar) e para a loja (na aprovação). Não bloqueia.

**Ainda em aberto (não bloqueia a fase 1):**
- **Nota fiscal da troca** — decisão do contador (ver fase 3).

---

## 2. Modelo de dados

Coleção nova **`trocas`** (uma por pedido de troca):

```
numeroTroca            string   sequência própria, 4 dígitos ("0001")
clienteId, clienteNome, clienteTelefone?
itens[]                { id (produto), nome, codigo?, quantidade,
                         unidadeMedidaSigla, unidadeMedidaFracionado, unidadeMedidaCasasDecimais,
                         fatorConversao?, motivo, motivoDescricao?,
                         custoUnitarioCentavos? (gravado na ENTREGA, para o relatório) }
observacao             string   (até 200, como no pedido)
status                 'Solicitada' | 'Aprovada' | 'Recusada' | 'Entregue' | 'Cancelada'
avisos[]               { produtoId, mensagem }   (ex.: "cliente não comprou este produto nos últimos 60 dias")
estoqueReservado       boolean  (true entre Aprovada e Entregue)
vendedorId, vendedorNome, usuarioResponsavelId
aprovadoPor/Em, recusadoPor/Em + motivoRecusa, entreguePor/Em, canceladoPor/Em + motivoCancelamento
tenantId, createdAt, criadoPor/criadoEm/alteradoPor/alteradoEm
```

**Motivos (lista inicial):** `embalagem_rasgada` · `com_bicho` · `vencido` · `produto_errado` · `outro`
(este exige descrição). Depois pode virar configuração da empresa.

**Máquina de estados** (função pura, testada):
`Solicitada → Aprovada | Recusada | Cancelada` · `Aprovada → Entregue | Cancelada`.
`Recusada`, `Entregue` e `Cancelada` são finais.

---

## 3. Onde mora cada regra (segurança primeiro)

Regra do dono: **nada pode ser alterado pelo DevTools** (`memory: feedback-nada-altera-via-devtools`).
Por isso, **toda escrita em `trocas` e todo movimento de estoque da troca passam pelo servidor**
(Admin SDK), no mesmo padrão de `server/services/cadastroIntegridade.js` e
`server/services/devolucaoNfe.js`:

- `server/services/trocas.js` — funções puras: validação, aviso de histórico, transição de estado.
- `server/routes/trocas.routes.js`, montada em `/api/trocas`:
  - `POST /previa` — devolve só os avisos (o app mostra antes de enviar). Não grava.
  - `POST /solicitar` — cria a troca (id do documento = `localId` do rascunho, idempotente como o pedido).
    Confere: cliente e produtos são da empresa e ativos, quantidade > 0, motivo válido.
  - `POST /:id/aprovar` — reserva o estoque da reposição (`quantidadeReservada`). Falha em português se faltar.
  - `POST /:id/recusar` — exige motivo.
  - `POST /:id/entregar` — **baixa o estoque** (quantidade e reserva) numa transação e grava um
    `ajustes_estoque` de saída com motivo `troca_cliente` (aparece no Relatório de Ajustes). Guarda o custo.
  - `POST /:id/cancelar` — libera a reserva se houver.
- `firestore.rules`: `trocas` **só leitura** para a empresa; **escrita negada** para o cliente.
  Sem isso o vendedor precisaria de permissão de escrever estoque e sequência (o que a pré-venda exigiu e
  virou bug em produção). Vantagem: o vendedor **nunca escreve em estoque**.
- Permissões novas (`permissionCatalog.ts`): `vendas.troca_solicitar` (vendedor/app) e
  `vendas.troca_gerenciar` (loja: aprovar, recusar, entregar, cancelar, relatório).

---

## 4. Telas

### 4.1 App do vendedor (`/vendedor`)
- **Quadradinho "Trocas"** na Home, visível para quem tem `vendas.troca_solicitar`.
- **`VendedorNovaTroca.tsx`**: cliente (com o pop-up **Confirmar cliente** já existente), itens
  (reaproveita `VendedorItemPicker`, **sem preço**), **motivo por item**, observação. Salva como **rascunho**
  no aparelho e envia em "Enviar dados" (o store de rascunhos ganha o tipo `troca`).
- **`VendedorTrocas.tsx`**: lista das trocas enviadas com o status (Solicitada, Aprovada, Recusada com o
  motivo, Entregue).
- Antes de enviar, chama `/previa` e mostra os avisos ("este cliente não comprou X nos últimos 60 dias").

### 4.2 Retaguarda
- **Menu Comercial → "Trocas"** (permissão `vendas.troca_gerenciar`) com **contador de pendentes**.
- **Lista** por abas: Solicitadas · Aprovadas · Entregues · Recusadas · Canceladas; selo **TROCA**; ícone de aviso.
- **Detalhe**: faixa fixa **"TROCA — sem cobrança, sem comissão, sem financeiro"**; itens com motivo; avisos;
  botões conforme o estado (Aprovar / Recusar com motivo / Imprimir minuta / Confirmar entrega / Cancelar).
- **Minuta de troca**: reaproveita `MinutaPrintDocument` com o título **"MINUTA DE TROCA — SEM COBRANÇA"**.
- **Relatório de Trocas** (fase 2): por produto, motivo, cliente, vendedor e período, com custo total.

---

## 5. Fases

**Fase 1 — núcleo (o que o Sol Natus precisa para começar)**
1. `trocas.js` (regras puras) + testes; rotas + teste de ponta a ponta no dev (mesma técnica da devolução: token,
   dados descartáveis, limpeza).
2. Regras do Firestore (coleção nova, leitura) e permissões novas.
3. App: Home, Nova Troca (com rascunho/envio), Minhas Trocas.
4. Retaguarda: lista, detalhe, aprovar/recusar, minuta, entrega (baixa), cancelar.

**Fase 2** — Relatório de Trocas, foto opcional do produto (Storage), badge de pendentes no menu, motivos configuráveis.

**Fase 3** — Nota fiscal da reposição, **só se o contador exigir**. Opções a levar para ele:
(a) nenhuma nota; (b) NF-e de remessa em substituição/sem cobrança (CFOP a definir por ele), montada no servidor
como a NF-e de devolução; (c) o cliente emite devolução e a loja reverte. Sol Natus é Lucro Real: **não emitir nada
fiscal sem a resposta do contador.**

---

## 6. Riscos e cuidados

- **Ordem de publicação:** regras do Firestore e permissões em **dev e produção antes** do site/servidor
  (`memory: feedback-regras-firestore-dois-projetos`). Vale rodar o comando de regras em produção depois do deploy
  automático do servidor.
- **Baixa de estoque no servidor:** replicar a semântica de `applyStockAdjustments`
  (`src/utils/firestoreAtomic.ts`): quantidade × `fatorConversao` (embalagem), `permitirEstoqueNegativo`,
  produto inativo (não pode ser trocado). Conferir composição/insumos antes de codar.
- **Nunca** gravar `undefined` no Firestore; **todo erro em português** dizendo o que fazer (CLAUDE.md).
- **Auditoria:** registrar cada transição (aprovou, recusou, entregou, cancelou) no log do sistema.

---

## 7. Critério de aceite da fase 1

- Vendedor cria a troca no celular, ela sai do rascunho e chega na retaguarda como **Solicitada**, com selo TROCA.
- Loja aprova → reserva aparece em `quantidadeReservada`; recusa → vendedor vê o motivo no app.
- Entrega confirmada → estoque baixa **uma vez**, aparece no Relatório de Ajustes como "Troca de cliente";
  **nenhum** registro em `transacoes`, `creditos_cliente`, comissão nem `pedidos_venda`.
- Cancelar em Aprovada libera a reserva; reenviar o mesmo rascunho não duplica a troca.
- Tentativa de escrever em `trocas` ou mudar o status pelo DevTools é **negada**.
- `npm run typecheck`, testes do front e do servidor passando; fluxo testado no navegador do dev.

## 8. Não faça

- Não crie a troca dentro de `pedidos_venda` (decisão 1).
- Não deixe o app do vendedor escrever em `estoque`, `trocas` ou sequências; tudo pelo servidor.
- Não gere `transacoes`, crédito de cliente, comissão nem nota fiscal na fase 1.
- Não devolva a mercadoria estragada ao estoque (ela já foi baixada na venda original).
