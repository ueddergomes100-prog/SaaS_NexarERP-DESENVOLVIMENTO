# Plano de evolução — Go-live Shopping Rural (01/09/2026)

> Derivado do pedido do usuário em 2026-08-21. Complementa `PLANO_EVOLUCAO_NEXAR.md`
> (não substitui): as regras permanentes daquele documento continuam valendo —
> qualidade acima de velocidade, uma fatia por vez, checklist de aceite
> (typecheck + lint + build + testes + validação ao vivo) antes de cada commit,
> `dev` primeiro e `production` só com pedido explícito.

## 0. Regra transversal do pedido (vale para os 12 itens)

> "Não é pra apagar regras e sim criar novos fluxos, pois cada empresa tem seu fluxo.
> Sempre criar na configuração do SaaS as opções para marcar, invés de apagar algum fluxo."

Tradução técnica, seguindo o padrão que já existe no projeto:

- Toda mudança de comportamento entra como flag em `configuracoes/{tenantId}`.
- Cada flag ganha uma constante `DEFAULT_*` num arquivo de domínio puro
  (padrão já usado em `src/utils/conferenciaDomain.ts` e `src/utils/estoqueReservaDomain.ts`),
  e o **default reproduz exatamente o comportamento de hoje**.
- Nenhum fluxo existente é removido. Todo tenant que não marcar nada continua
  funcionando igual — inclusive os que já estão em produção.
- A flag é lida onde a regra é aplicada, não espalhada: telas leem
  `configuracoes/{tenantId}` uma vez (padrão de `PedidoVendaForm.tsx:264`).

Flags novas previstas neste plano (nomes propostos):

| Flag | Item | Default (= hoje) |
|---|---|---|
| `exigirClienteCadastrado` | 1 | `false` |
| `avisarCadastrarClienteNaVenda` | 3 | `false` |
| `restringirVendasPorUsuario` | 4 | `false` |
| `venderPorEmbalagem` | 5 | `false` |
| `exigirAprovacaoDesconto` | 6 | `false` |
| `exigirLimiteCreditoParaPrazo` | 7 | `false` |
| `permitirUsarCreditoNaVenda` | 8 | `false` |
| `permitirNotaBranca` | 9 | `false` |
| `exigirSenhaVendedorNaVenda` | 10 | `false` |
| `modoCartaoSimplificado` | 12 | `false` |

---

## 1. Diagnóstico item a item (o que já existe, o que falta)

### Item 1 — Não aceitar cliente digitado sem cadastro

**Hoje:** a busca de cliente da venda (`ClientAutocomplete`) é um input de texto livre.
O que é selecionado no dropdown vira **só um nome** — `onSelect={(c) => setClienteNome(c.nome)}`
([PedidoVendaForm.tsx:1998](../src/pages/Vendas/PedidoVendaForm.tsx:1998)). Não existe
`clienteId` no estado da tela.

Ao finalizar, [PedidoVendaForm.tsx:646-660](../src/pages/Vendas/PedidoVendaForm.tsx:646)
tenta casar o texto com a lista por comparação exata em maiúsculas e, **não achando,
cadastra um cliente novo automaticamente**. Consequências reais:

- Qualquer erro de digitação cria um cliente duplicado silenciosamente.
- Esse `addDoc` usa `getCountFromServer` para o `codigo` — é exatamente o bug de
  código duplicado já corrigido em `ClienteForm.tsx` (2026-08-04) e que sobreviveu aqui.
- O PDV **não** tem esse problema: `ClientModal` só deixa escolher cliente existente
  ou "Consumidor Final" ([ClientModal.tsx:71-84](../src/pages/PDV/components/ClientModal.tsx:71)).

**Falta:** guardar `clienteId` de verdade no estado da venda e, com a flag ligada,
recusar finalizar sem cliente selecionado. Mesma lacuna existe em `OSForm.tsx` e
`OrcamentoForm.tsx` (usam o mesmo `ClientAutocomplete`).

### Item 2 — Botão de cadastrar cliente na tela de venda (popup)

**Hoje:** não existe. Cadastrar cliente exige sair da venda e ir em Clientes → Novo
(`ClienteForm.tsx`, tela cheia, abre em aba própria desde o F19).

**Falta:** um `ClienteQuickFormModal` compartilhado que devolva o `id` do cliente
criado e já o selecione na venda. É pré-requisito do item 1 — sem ele, bloquear
nome livre trava o caixa.

### Item 3 — Popup "deseja cadastrar o cliente?" configurável

**Hoje:** não existe.

**Falta:** flag + prompt antes de finalizar quando a venda está como Consumidor
Final / sem cliente vinculado. Reaproveita o `NexusSwal` já usado no projeto.

### Item 4 — Funcionário não ver venda dos outros + 2 níveis

**Hoje:** os papéis **já existem** — `src/utils/roles.ts` define
`Master`/`Admin` (gestores) e `Funcionario`, e `hasTenantFullAccess()` já é o ponto
central de decisão. Ou seja, "administração vs funcionário" não precisa ser criado,
precisa ser **usado** para filtrar dados.

O que não existe é qualquer filtro por usuário: `PedidoVendas.tsx:109-112` escuta
`where('tenantId','==',tenantId)` e mostra tudo. Idem OS, Orçamentos, Relatórios de
Vendas, Dashboard e Caixa.

A venda **já grava** `vendedorId` e `criadoPor`, então o dado necessário existe.

**Falta:** flag + filtro na consulta + índice composto (`tenantId` + `vendedorId`) +
regra no `firestore.rules`. Atenção: fazer só na UI é cosmético (o dado continua
legível por quem souber consultar); fazer na regra obriga **toda** consulta dessas
telas a carregar o filtro, senão o Firestore recusa a query inteira. São duas fatias
separadas, nessa ordem.

### Item 5 — Cadastro de embalagem (KG × saco de 50kg)

**Hoje:** o produto tem **uma** unidade de medida (`unidadeMedidaId`,
[EstoqueForm.tsx:77](../src/pages/Estoque/EstoqueForm.tsx:77)) e a regra de
quantidade fracionada é única e global (`src/utils/saleQuantity.ts`). Não existe
nenhum conceito de embalagem, fator de conversão ou múltiplas unidades de venda.

**Falta:** o item mais pesado do pedido. Modelo proposto: estoque continua sempre na
**unidade base** (KG); o produto ganha uma lista `embalagens[]`
(`{ id, descricao, unidadeId, fatorConversao, codigoBarras?, precoVenda? }`).
Na venda escolhe-se a embalagem; a baixa é `quantidade × fatorConversao` em KG.

Dois achados que reduzem bastante o risco:

- `applyStockAdjustments` já recebe a quantidade pronta — basta passar a quantidade
  convertida, sem mexer no núcleo transacional.
- A nota fiscal **já manda campos duplos comercial/tributável**
  (`unit`/`quantity` vs `unitTax`/`quantityTax`), montados por `resolveInvoiceUnitFields`
  em `src/utils/fiscalDomain.ts` desde o F27. Embalagem encaixa nativamente:
  comercial = SACO, tributável = KG. Não precisa reabrir o payload fiscal.

Superfícies afetadas: cadastro de produto, busca de produto (código de barras por
embalagem), PDV / Pedido / OS / Orçamento, impressos, conferência de mercadoria (M12),
devolução e relatórios.

### Item 6 — Tela de liberar desconto no celular

**Hoje:** o desconto do PDV é aplicado direto, sem nenhuma aprovação
([DiscountModal.tsx:41-44](../src/pages/PDV/components/DiscountModal.tsx:41)).

**Achado relevante:** o produto **já tem** o campo `descontoMaximoPercentual`
([EstoqueForm.tsx:75](../src/pages/Estoque/EstoqueForm.tsx:75), gravado no save) —
mas ele **não é lido em lugar nenhum do sistema**. Existe cadastro e não existe regra.

**Falta:** nova coleção `solicitacoes_desconto`, rota mobile fora do sistema de abas
(mesma exceção que o PDV já é), `onSnapshot` no PDV esperando aprovação/recusa, nova
permissão `vendas.liberar_desconto` e regra no Firestore. É o único item que cria uma
superfície nova (mobile) — por isso é o candidato natural a ficar por último.

### Item 7 — Limite de crédito no cliente

**Hoje:** `ClienteForm.tsx` tem apenas `codigo, nome, telefone, email, documento,
endereco, bairro, numero`. Não há limite de crédito nem qualquer trava de venda a prazo.

**Falta:** campo `limiteCreditoCentavos` no cliente + validação no fechamento da venda
(soma dos títulos `Pagamento a Prazo` pendentes do cliente em `transacoes` + esta venda
≤ limite). **Depende do item 1**: sem `clienteId` confiável, a soma do saldo em aberto
não tem como ser correta.

### Item 8 — Gerar crédito na devolução "não está funcionando"

**Hoje:** o crédito **é gravado** — `DevolucaoVendaModal.tsx:186` cria
`creditos_cliente/devolucao_{id}` com `saldoDisponivel`. O problema é o consumo. Duas
causas prováveis, ambas confirmadas por leitura de código:

1. **O crédito é gravado sem `clienteId`** — só `clienteNome`
   ([DevolucaoVendaModal.tsx:186-199](../src/pages/Vendas/DevolucaoVendaModal.tsx:186)) —
   e Contas a Receber procura por igualdade exata de string
   (`where('clienteNome','==',t.clienteNome)`,
   [ContasReceber.tsx:316-322](../src/pages/Financeiro/ContasReceber.tsx:316)).
   Qualquer diferença de texto esconde o crédito.
2. **Só existe um caminho para gastar o crédito**: a conciliação de um título *a prazo*
   em Contas a Receber. Não há tela que liste créditos do cliente, e
   `Crédito de Devolução`, apesar de ser uma forma de pagamento válida do domínio,
   **não está na lista de formas oferecidas na venda**
   ([PaymentsEditor.tsx:327-329](../src/components/finance/PaymentsEditor.tsx:327)).
   Cliente que pagou à vista nunca consegue usar o crédito gerado.

**Falta:** gravar `clienteId`, uma tela/aba de créditos do cliente, e permitir
`Crédito de Devolução` como forma de pagamento na venda (consumindo o saldo dentro da
transação). A regra do Firestore já libera `creditos_cliente` (linhas 133 e 162).

> **Antes de codar:** confirmar ao vivo com o usuário o que exatamente ele vê
> ("não aparece" × "dá erro" × "aparece e não abate"). O diagnóstico acima é por
> leitura de código; a lição registrada no plano principal é não patchear por hipótese.

### Item 9 — Nota branca (ajusta estoque + lança financeiro)

**Hoje:** a entrada de mercadoria é **exclusivamente por XML** — `EntradaNFE.tsx` só
aceita arquivo `.xml` ([EntradaNFE.tsx:314-328](../src/pages/Fiscal/EntradaNFE.tsx:314))
e todo o resto da tela depende do objeto `ParsedXML`.

**Falta:** um modo de lançamento manual que reaproveite o *commit* já existente
(fornecedor → estoque → contas a pagar), com um toggle "já foi pago / a pagar".
Recomendação: gravar em `notas_fiscais_entrada` com `origem: 'manual'` em vez de criar
coleção nova — evita regra nova e já entra nos relatórios de entrada.

**Alerta fiscal (registrar antes de implementar):** documento sem chave/XML não pode
ser tratado como NF-e nos relatórios fiscais (Sintegra, apuração). Precisa ser
marcado e filtrável.

### Item 10 — Código do vendedor + senha na hora da venda

**Hoje:** a venda já tem um `select` de "Vendedor responsável"
([PedidoVendaForm.tsx:2013](../src/pages/Vendas/PedidoVendaForm.tsx:2013)) e já grava
`vendedorId` validando que o vendedor pertence ao tenant. Falta só a autenticação.

**Achado que resolve isso sem gambiarra:** o projeto **já usa** um app secundário do
Firebase para autenticar sem derrubar a sessão atual
([UsuarioForm.tsx:133-140](../src/pages/Usuarios/UsuarioForm.tsx:133)). Dá para validar
a senha real do vendedor com `signInWithEmailAndPassword` num app secundário e
`signOut` logo em seguida — **sem inventar PIN, sem guardar senha em Firestore**.

**Falta:** campo `codigoVendedor` no usuário (para digitar um código curto em vez de
escolher na lista), flag, e o modal de autenticação. **Bloqueado até o usuário explicar
o fluxo da loja** (quem digita, em que momento, o que acontece se errar).

### Item 11 — Buscar por código

**Hoje, produto: já funciona.** `src/utils/productSearch.ts:32` busca por
`codigo`, `codigoBarras`, `referencia` e `skuSistema`, com prioridade para match exato
(leitor de código de barras). A lista de Estoque também já filtra por código
([EstoqueList.tsx:111-117](../src/pages/Estoque/EstoqueList.tsx:111)).

**Hoje, cliente: não funciona.** `src/utils/clientSearch.ts:16` filtra **só por nome** —
o comentário do arquivo inclusive diz "clientes não têm código", o que deixou de ser
verdade quando `ClienteForm` ganhou o campo `codigo`. A lista de Clientes busca por
nome/documento/telefone, mas não por código
([ClientesList.tsx:96-102](../src/pages/Clientes/ClientesList.tsx:96)).

**Falta:** só o lado do cliente. É o item mais barato do pedido inteiro.

### Item 12 — Cartão simplificado (venda sem validar cartão)

**Hoje** a venda no cartão exige: banco de destino obrigatório
(`paymentRequiresBankAccount`, `financeDomain.ts:411`), e oferece bandeira, NSU,
parcelas e data prevista de recebimento
([PaymentsEditor.tsx:476-527](../src/components/finance/PaymentsEditor.tsx:476)).
O cartão vira recebível pendente, com taxa por bandeira (F14), parcelas explodidas em
títulos (F15) e conciliação na tela Banco (F16/F18).

**Falta:** flag que faça o cartão virar um recebimento simples e confirmado, sem banco,
sem bandeira e sem explosão de parcelas.

**Risco alto e explícito:** Dashboard, Faturamento e Banco filtram e somam por forma de
pagamento e por status pendente. Mudar cartão de "pendente" para "confirmado" pode
duplicar receita se não for revisado nas três telas. Esta fatia exige teste de números,
não só de tela. **Bloqueado até o usuário explicar a situação real** (o que a loja usa
hoje: maquininha própria? conciliação depois?).

---

## 2. O que dá para entregar até 01/09 — recomendação

São 12 itens, dois deles (5 e 6) do tamanho de um módulo inteiro, em 11 dias corridos.
Entregar tudo com o padrão de qualidade do projeto (validação ao vivo antes de cada
commit) **não é realista**. A recomendação é cortar por "o que impede a loja de operar
no dia 01" e não por "o que foi pedido primeiro".

**Onda 0 — hoje, antes de qualquer código (~1h)**
- Reproduzir ao vivo o item 8 com dado real (navegador interno, usuário logado).
- Colher as duas explicações que ficaram pendentes: fluxo da loja (item 10) e situação
  do cartão (item 12).

**Onda 1 — Cliente (itens 1, 2, 3, 7, 11)** — 4 fatias
Fazem sentido juntos porque todos giram em torno de ter um `clienteId` de verdade na
venda; separá-los significaria reabrir `PedidoVendaForm.tsx` quatro vezes.
1. `clienteId` real no estado da venda + busca de cliente por código/CPF/telefone.
2. Popup de cadastro de cliente na venda (componente compartilhado com OS/Orçamento).
3. Flags `exigirClienteCadastrado` + `avisarCadastrarClienteNaVenda`.
4. Limite de crédito + trava da venda a prazo.

**Onda 2 — Financeiro da venda (itens 8, 12)** — 2 fatias
5. Crédito de devolução: `clienteId`, tela de créditos, uso como forma de pagamento.
6. Modo cartão simplificado (com conferência de números em Dashboard/Faturamento/Banco).

**Onda 3 — Acesso (itens 4, 10)** — 3 fatias
7. Restrição de visibilidade na UI (funcionário × administração).
8. Mesma restrição no `firestore.rules` + índice composto.
9. Código do vendedor + senha na venda.

**Onda 4 — Estoque e entrada (itens 5, 9)** — 4 fatias
10. Embalagens: cadastro no produto (fator de conversão, código de barras próprio).
11. Embalagens: venda e baixa proporcional (PDV, Pedido, OS, Orçamento).
12. Embalagens: impressos, conferência (M12) e nota fiscal (encaixe no F27).
13. Nota branca (entrada manual + financeiro pago/a pagar).

**Onda 5 — plano futuro (item 6)**
14. Liberação de desconto pelo celular.

### Decisões do usuário em 2026-08-21

- **Item 6 (desconto no celular): fora do escopo de 01/09** — decisão explícita do
  usuário, "pode deixar como plano futuro". Não é para começar sem novo pedido.
  Continua registrado aqui com o diagnóstico pronto (inclusive o achado de que
  `descontoMaximoPercentual` já existe no cadastro do produto e nunca é lido).
- **Item 5 (embalagem): CONCLUÍDO em 2026-08-23**, 5 fatias, todas validadas ao
  vivo e publicadas em `dev` (`9d374e8`, `4cb30dc`, `4790524`, `3be30e4`,
  `9475202`). Plano da feature em
  `C:\Users\uedde\.claude\plans\tender-tinkering-sedgewick.md`.
  - Fatia 1: `src/utils/embalagemDomain.ts` (puro, testado) + aba "Embalagens" no
    cadastro do produto + flag `venderPorEmbalagem`.
  - Fatia 2: seletor de unidade no Pedido de Venda, com preço próprio por
    embalagem e baixa de estoque convertida.
  - Fatia 3: mesma coisa no PDV — a linha do carrinho passou a ser
    `productId::embalagemId`, para o mesmo produto em quilo e em saco ocupar
    duas linhas com preços diferentes.
  - Fatia 4: código de barras próprio da embalagem (bipar o saco lança 1 SC).
  - Fatia 5: conferência de mercadoria passa a bipar o EAN do saco.
  - **Fora do escopo desta leva, decidido com o usuário:** Orçamento e OS
    continuam vendendo só na unidade base (item sem `fatorConversao` cai em
    fator 1, sem risco). E `uTrib` continua igual a `uCom` na nota — declarar
    `uTrib = KG` numa venda em saco é mais correto perante a SEFAZ, mas muda o
    comportamento fiscal de todos os tenants e merece decisão à parte.
  - **Pré-requisito operacional para o cliente:** cadastrar a unidade **"SC"** em
    Cadastros → Unidades de Medida. Hoje o tenant de dev só tem KG, UN, MT e LTS.

**Linha de corte enquanto a decisão do item 5 não vem:** ondas 1 a 3 (cliente,
financeiro da venda, acesso). Nenhuma delas depende de embalagem nem de desconto
remoto, então dá para começar sem risco de retrabalho, seja qual for a decisão de
amanhã.

---

## 3. Impactos de infraestrutura (não esquecer)

- **`firestore.rules`:** itens 4 (restrição por vendedor), 6 (`solicitacoes_desconto`)
  e 9 (se virar coleção própria — recomendado que não vire) exigem deploy de regra.
  Sempre com `--project` explícito, e nos **dois** projetos quando for para produção.
- **Índices:** item 4 exige índice composto `tenantId` + `vendedorId` em `pedidos_venda`
  (e nas demais coleções que receberem o mesmo filtro).
- **Permissões novas** (`src/utils/permissionCatalog.ts` + `firestore.rules`):
  `vendas.ver_todas` (item 4), `vendas.liberar_desconto` (item 6),
  e possivelmente `fiscal.entrada_manual` (item 9).
- **Backend local** (`server/`, porta 3001) precisa estar de pé para qualquer teste que
  toque tela fiscal — vale para o item 9.
- **Cliente sem estado/país** continua em aberto (item 15 da Seção 9 do plano
  principal). Se o Shopping Rural emitir nota, isso vira bloqueio real, porque hoje
  todo cliente sem UF cai em São Paulo por fallback silencioso.
- **Notas Recebidas automática via Spedy** (item 11 da Seção 9) continua sem decisão,
  travada em certificado digital A1. Se a loja for receber muita nota de fornecedor,
  isso conversa diretamente com o item 9 deste plano.
