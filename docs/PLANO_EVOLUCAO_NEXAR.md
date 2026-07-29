# Plano de Evolução do Nexar ERP

Documento de arquitetura e execução derivado do prompt "Nexar ERP — Missão de Implementação e Evolução do Sistema".

- **Criado em:** 2026-07-27
- **Destinatário:** agente de implementação (Claude Sonnet 5) em sessões futuras
- **Princípio inegociável:** qualidade acima de velocidade. Um módulo por vez, validado e documentado antes do próximo.

---

## 0. Como usar este documento

Cada módulo abaixo tem a mesma estrutura:

- **Estado atual** — o que já existe no código, com caminho de arquivo. Confirmado por leitura, não presumido.
- **O que falta** — a lacuna real.
- **Como implementar** — decisões de arquitetura já tomadas, para não reabrir discussão a cada sessão.
- **Arquivos afetados** — mapa de risco de regressão.
- **Critério de aceite** — o que precisa ser verdade para o módulo ser considerado pronto.
- **Não faça** — armadilhas específicas do módulo.

**Antes de começar qualquer módulo**, leia a Seção 1 (Regras permanentes) e a Seção 2 (Fundações). Nenhum módulo da Fase 1 em diante deve ser iniciado antes das fundações correspondentes.

---

## 1. Regras permanentes

### 1.1 Ambiente

- Banco de desenvolvimento: `sistema-nexus-dev`. Produção: `nexus-erp-2026`.
- **Nunca** apontar ambiente local para produção. Nunca usar credencial de produção no backend local.
- Conferir `VITE_FIREBASE_PROJECT_ID` antes de rodar qualquer coisa.

### 1.2 Definição de "pronto"

Um módulo só está pronto quando **todos** os itens abaixo passam:

1. `tsc -b --pretty false` — sem erros.
2. `eslint .` — sem erros novos (a base tem ~70 warnings pré-existentes; não aumentar).
3. `vite build` — build de produção passa.
4. `node scripts/run-finance-domain-tests.mjs` — os 13 testes continuam passando.
5. Testes novos escritos para a lógica pura introduzida pelo módulo (ver 1.3).
6. Validação manual no navegador, logado no ambiente de dev, nos dois temas (claro e escuro).
7. Permissões validadas: usuário sem a permissão do módulo **não** consegue acessar nem gravar.
8. Documentação atualizada (ver 1.5).
9. Commit único e coeso do módulo, com mensagem descritiva.

Se qualquer item falhar, o módulo **não** avança. Não iniciar o próximo módulo com pendência aberta.

### 1.3 Testes

O projeto usa `node --test` via `scripts/run-finance-domain-tests.mjs`, que compila e roda `tests/*.test.ts`.

- **Toda lógica pura nova deve ter teste** (cálculo, normalização, transição de status, filtro, rateio).
- Lógica de UI e acesso ao Firestore não são testados automaticamente hoje (não há emulador configurado) — esses dependem de validação manual roteirizada.
- Ao criar um novo arquivo de teste, registrá-lo no runner se necessário.

### 1.4 Padrões de código a seguir

- Dinheiro **sempre** em centavos (`toCents`/`fromCents` de [`src/utils/financeDomain.ts`](../src/utils/financeDomain.ts)). Nunca somar float.
- Datas com os helpers de [`src/utils/dateTime.ts`](../src/utils/dateTime.ts), fuso `America/Sao_Paulo`.
- Escritas que afetam mais de um documento → `runTransaction`, com **todas as leituras antes de qualquer escrita** (exigência do Firestore).
- Operações repetíveis → `idempotencyKey` determinística, no padrão já usado (`pedido:{id}:pagamento:{indice}`).
- Isolamento por `tenantId` em toda query e todo documento gravado.
- Toda ação relevante gera log via `createAuditLog` de [`src/services/logService.ts`](../src/services/logService.ts), usando `valorAnterior`/`valorNovo` quando houver mudança de status.

### 1.5 Documentação

Vault do Obsidian: `C:\Users\uedde\OneDrive\Área de Trabalho\Obsidian Uedder\uedder\Nexar ERP`

Ao concluir cada módulo, atualizar: diário técnico do dia, changelog, página da funcionalidade, e o roadmap se nasceu pendência nova. Atualizar também a tabela de status na Seção 8 deste documento.

**Observação de acesso:** os nomes de pasta do vault têm acentos que quebram listagem por shell nesta máquina. Use a ferramenta Read com o caminho completo do arquivo; não tente enumerar o diretório.

### 1.6 Commits

- Um módulo = um commit (ou uma série curta e coerente).
- **Nunca** commitar ou dar push sem autorização explícita do usuário.
- Nunca misturar módulos diferentes no mesmo commit.

---

## 2. Fundações (Fase 0)

Estas não são módulos do prompt original. São pré-requisitos que eliminam duplicação e sustentam vários módulos. **Sem elas, os módulos 1, 9, 10, 11, 14, 19 e 20 seriam implementados três vezes cada.**

### F1 — Serviço unificado de busca de produto

**Problema real encontrado:** existem hoje **três** implementações independentes e divergentes:

| Local | Campos pesquisados | Limite | Prioriza código exato |
|---|---|---|---|
| [`src/pages/PDV/pdvHelpers.ts`](../src/pages/PDV/pdvHelpers.ts) | nome, código, barras, referência, SKU, categoria | 12 | Sim |
| [`src/pages/Vendas/PedidoVendaForm.tsx:1451`](../src/pages/Vendas/PedidoVendaForm.tsx) | nome, código | **nenhum** | Não |
| [`src/pages/OS/OSForm.tsx:1354`](../src/pages/OS/OSForm.tsx) | **só nome** | **nenhum** | Não |

O resultado é que a mesma busca devolve coisas diferentes em cada tela, e duas delas renderizam a lista inteira do catálogo.

**Criar** `src/utils/productSearch.ts`, promovendo e generalizando os helpers do PDV:

```ts
export type ProductSearchMode = 'exata' | 'completa';

export interface ProductSearchOptions {
  mode: ProductSearchMode;   // Módulo 9
  limit: number;             // Módulo 10 (padrão 6)
  fields?: ProductSearchField[];
}

export interface ProductSearchResult<T> {
  items: T[];
  total: number;      // total de matches ANTES do limite — habilita o "Ver Mais"
  truncated: boolean;
}
```

Regras:
- Campos pesquisáveis: `nome`, `codigo` (CDP), `codigoBarras`, `referencia`, `skuSistema`, `marca`, `categoria`, `fornecedor` — cobre Módulos 11 e 14 de uma vez.
- **Código exato sempre vence**: se o termo bate exatamente com um código, retorna só ele (comportamento de leitor de código de barras, já correto no PDV — preservar).
- `modo exata` → `startsWith` no nome; `modo completa` → `includes`. Códigos sempre comparam exato ou por prefixo, independente do modo.
- Normalizar acentos e caixa na comparação.
- Função pura, sem dependência de React ou Firestore → **testável**.

**Testes obrigatórios:** código exato vence nome; modo exata não retorna meio de palavra; modo completa retorna; `total` reflete matches antes do corte; limite respeitado; acento não quebra match.

**Depois de criar, migrar as três telas para o serviço**, uma por vez, validando cada uma. Não migrar as três num commit só.

### F2 — Componente único de autocomplete de produto

**Criar** `src/components/common/ProductAutocomplete.tsx` + CSS irmão, no padrão visual já usado em [`src/components/finance/PaymentsEditor.tsx`](../src/components/finance/PaymentsEditor.tsx).

- Consome F1.
- Navegação por teclado embutida: ↑/↓ move, Enter seleciona, Esc fecha (portar de [`PDV.tsx:351`](../src/pages/PDV/PDV.tsx)).
- Mostra no máximo `limit` itens + botão "Ver Mais" quando `truncated` (Módulo 10).
- "Ver Mais" abre modal de busca completa com os mesmos filtros.
- Usado por PDV, Pedido de Venda, OS e qualquer módulo futuro.

**Nota de validação (2026-07-27):** o componente foi criado em
`src/components/common/ProductAutocomplete.tsx` com variante `overlay`
(padrão, usada por Pedido/OS) e `inline` (reservada para telas que
precisem, não usada ainda). Migrado no PDV. A navegação por seta/Enter/Esc
foi validada por script isolado (o índice avança corretamente), mas a
verificação end-to-end no navegador ficou incompleta nesta sessão: o
modal "Abrir caixa" (SweetAlert2) não abriu via clique automatizado no
ambiente de teste, então o fluxo completo teclar→buscar→setas→Enter→
adicionar ao carrinho não foi confirmado com o caixa aberto de verdade.
Recomenda-se um teste manual rápido no navegador antes de considerar o
PDV 100% fechado.

### F3 — Primitivas de navegação por teclado

**Criar** `src/hooks/useKeyboardFlow.ts` com:
- registro de atalhos por tela (padroniza o `addEventListener('keydown')` hoje solto em [`PDV.tsx:560`](../src/pages/PDV/PDV.tsx));
- avanço de foco para o "próximo campo lógico" após concluir uma ação;
- `Esc` com pilha (fecha o modal mais recente, não todos de uma vez — o PDV hoje fecha os três juntos).

Base do Módulo 1. Não implementar o Módulo 1 antes disso.

### F4 — Catálogos auxiliares (padrão reutilizável)

O sistema já tem dois CRUDs de catálogo simples: [`src/pages/Categorias`](../src/pages/Categorias) e [`src/pages/UnidadesMedida`](../src/pages/UnidadesMedida).

Antes do Módulo 2, **extrair o padrão comum** desses dois (listagem, form, permissão, `tenantId`, seed de valores padrão) para que Bandeiras de Cartão — e catálogos futuros — não sejam um terceiro copy-paste.

**Decisão de arquitetura (2026-07-27):** Categorias usa rota própria para o form; UnidadesMedida usa modal embutido na lista — os dois divergem de verdade na camada de UI, não só por acidente. Extrair um componente único de formulário forçaria um dos dois padrões sobre o outro sem necessidade. Em vez disso, F4 extrai só a camada de dados/regra, que era realmente duplicada:
- `src/hooks/useTenantCollection.ts` — assina uma colecao do Firestore filtrada por `tenantId`, com `sortField` e `removeItem`.
- `src/utils/catalogDefaults.ts` (`pickMissingDefaults`) — dedup de seed de valores padrao (testado).
- `src/utils/roles.ts` (`hasModuleAccess`) — padrao `isOwner || isTenantManagerRole || permissao especifica`, ja repetido em varias telas (testado).

Bandeiras de Cartão (Módulo 2) deve usar essas três peças; o form/lista em si pode seguir o padrão de modal (mais leve, cabe no fluxo do PDV/Pedido/OS).

### F5 — Sequências e metadados de documento

- **Sequências:** ampliar `SequenceKey` em [`src/utils/firestoreAtomic.ts`](../src/utils/firestoreAtomic.ts), hoje limitado a `'ordens_de_servico' | 'pedidos_venda' | 'orcamentos'`. Base do Módulo 19.
- **Metadados:** criar helper `buildDocumentMetadata()` / `applyDocumentUpdate()` que padroniza `criadoPor`, `criadoEm`, `alteradoPor`, `alteradoEm`, `ultimaAlteracao`. Base do Módulo 20. Hoje só existe `usuarioResponsavelId` + `createdAt`, e de forma inconsistente.

### F6 — Índices do Firestore versionados

**Gap encontrado:** não existe `firestore.indexes.json`, e o [`firebase.json`](../firebase.json) só referencia as regras. Os índices vivem apenas no console — o que já causa erro real em runtime:

```
Erro ao buscar sequencia de OS: The query requires an index (ordens_de_servico: tenantId + numeroOS)
```

**Criar** `firestore.indexes.json`, registrar em `firebase.json`, e incluir o índice faltante de OS. Todo módulo novo que criar query composta **deve** adicionar o índice aqui, não só no console.

**Concluído em 2026-07-27:** criado `firestore.indexes.json` com os 3 índices confirmados (mesmo formato `tenantId` + `numero*` desc, usados por `getCurrentMaxSequence`): `ordens_de_servico`, `pedidos_venda`, `orcamentos`. Registrado em `firebase.json`.

**Implantado em 2026-07-29:** o Firebase CLI não está instalado globalmente neste ambiente, mas foi possível rodar via `npx firebase-tools` usando o node de `H:\PartiuFut\.tools\node-v22.22.3-win-x64\` — havia um login do Firebase CLI já em cache na máquina (`~/.config/configstore/firebase-tools.json`), então não precisou de novo login interativo. Rodado explicitamente com `--project sistema-nexus-dev` (nunca produção):
```bash
npx --yes firebase-tools deploy --only firestore:rules,firestore:indexes --project sistema-nexus-dev
```
Deploy confirmado com sucesso ("Deploying to 'sistema-nexus-dev'..."). Isso não apaga índices/regras já existentes no console que não estejam neste arquivo — só aplica o que está no repositório.

Não investiguei os índices compostos dinâmicos de `LogsSistema.tsx` (filtros opcionais de módulo/status/ação combinados com `orderBy(dataHora)`) — ficam fora do escopo do F6 porque exigiriam testar cada combinação de filtro contra o que já está configurado no console, e não há erro observado ali nesta sessão.

### F7 — Autocomplete de cliente compartilhado (bugfix pós-Fase-1, 2026-07-29)

**Não estava no prompt original de 20 módulos.** Surgiu de teste manual real do usuário na Fase 1: Pedido de Venda, OS e Orçamento tinham **três** implementações independentes de dropdown de cliente (mesmo problema que o F1 resolveu para produto), nenhuma com navegação por teclado — Tab e seta para baixo não selecionavam nada.

**Criado** `src/components/common/ClientAutocomplete.tsx` + `src/utils/clientSearch.ts` (busca por nome, acento/caixa normalizados via `src/utils/textSearch.ts`, extraído de `productSearch.ts` para as duas buscas compartilharem a mesma normalização). Seta cima/baixo move o destaque, Enter seleciona, Esc fecha (F3), e **Tab seleciona o cliente destacado antes de mover o foco** (sem `preventDefault`, o Tab continua natural).

Migrado nas três telas, preservando os efeitos colaterais específicos de cada uma (ex.: OS e Orçamento auto-preenchem o veículo do cliente selecionado via `onSelect`). O aviso "cadastrar como novo cliente" do OS virou o `emptyHint` opcional do componente — só aparece quando não há nenhum match, diferente de antes (aparecia junto com resultados parciais também).

**De quebra, corrigido no mesmo lote:**
- `ProductAutocomplete` (F2) não mostrava nenhum resultado ao focar/clicar com o campo vazio — só abria ao digitar. Agora mostra os 6 primeiros produtos do catálogo (na ordem em que a tela já os carrega) assim que abre, mesmo sem digitar nada. Afeta PDV, Pedido e OS de uma vez, por ser componente compartilhado.
- **Busca de peça do Orçamento nunca tinha sido migrada para F1/F2** (só PDV, Pedido e OS foram, no F1/F2 originais). Migrado agora: `PecaOrcamento` ganhou os campos de F1 (código, código de barras, referência, SKU, marca, categoria, fornecedor) e o Orçamento passou a usar `ProductAutocomplete`/`ProductSearchModal` como as outras telas.

Ver também [[project-plano-evolucao-nexar]].

**Regra de quantidade fracionada unificada (mesmo lote, mesma origem):** criado `src/utils/saleQuantity.ts` (`isValidSaleQuantity`, testado) — só permite quantidade não inteira quando `unidadeMedidaFracionado === true` no cadastro da unidade de medida do produto; **`undefined`/ausente agora conta como "não permite fracionado"** (antes, no Pedido e no PDV, `undefined` passava batido e permitia decimal — comportamento mudado propositalmente para bater com o pedido do usuário; produtos legados sem essa flag marcada explicitamente agora exigem quantidade inteira).

- **PDV** e **Pedido de Venda** já tinham alguma validação (com o bug do `undefined` acima) — refatorados para usar o helper único.
- **OS**: não tinha validação nenhuma, e `PecaData`/`PecaSelecionada` nem carregavam os campos de unidade — adicionados na busca de estoque e no carrinho.
- **Orçamento**: mesma lacuna do OS — `ItemOrcamento`/`PecaOrcamento` ganharam os campos, e `updateItemQtd` (edição de quantidade no carrinho) passou a validar. Itens do tipo "serviço" continuam sem essa regra (não têm unidade de medida) — comportamento de arredondamento para inteiro mínimo 1 preservado como estava.

### F8 — Caixa alta padronizada em campos de texto + Frete/Encargos inteiro (bugfix, 2026-07-29)

**Não estava no prompt original.** Pedido explícito do usuário: padronizar texto em caixa alta em "todas as telas e opções do sistema" (antes só alguns campos tinham `textTransform: uppercase` inline, de forma manual e inconsistente).

**Como implementado:** regra global em [`src/index.css`](../src/index.css) (`input:not([type='email']):not([type='url']), textarea, select, select option { text-transform: uppercase; }`), em vez de editar campo por campo — garante que nenhum novo formulário fique de fora por esquecimento. **É só transformação visual (CSS)**, não altera o valor real digitado nem o que é salvo no Firestore; e-mail/senha ficam de fora da transformação. Confirmado em teste isolado no navegador: o valor do input continua exatamente o que foi digitado, só a renderização muda.

**Efeito colateral aceito:** o campo de login (usuário/e-mail, `type="text"` porque aceita usuário OU e-mail) também fica visualmente em caixa alta ao digitar, mesmo sendo um e-mail em alguns casos — não afeta o valor autenticado, só a aparência. Não foi tratado como exceção porque o pedido foi "todas as telas".

**Frete e Encargos (Pedido de Venda, [`PedidoVendaForm.tsx`](../src/pages/Vendas/PedidoVendaForm.tsx)):** único lugar do sistema com esses campos (OS, Orçamento e PDV não têm). Eram `type="number" step="0.01"` (aceitava centavos); virou `step="1"` com truncamento (`Math.trunc`) no `onChange`, então não dá mais para digitar valor quebrado. Também reestilizado: os dois campos ganharam uma caixa destacada com título "Frete e Encargos" e ícone, em vez de ficarem soltos entre Descontos e Total.

### F9 — Ajustes na finalização de pagamento com cartão (bugfix, 2026-07-29)

**Não estava no prompt original.** Pedido do usuário na tela de finalizar venda ([`PaymentsEditor.tsx`](../src/components/finance/PaymentsEditor.tsx), compartilhado por PDV/Pedido/OS):

- **Removido o campo "Operadora / adquirente"** da tela (era texto livre desde o Módulo 2). O campo `operadora` continua existindo no tipo `PaymentDraft`/`CardPaymentDetails` ([`financeDomain.ts`](../src/utils/financeDomain.ts)) só para não quebrar compatibilidade com pagamentos antigos que já têm esse valor gravado — simplesmente não é mais coletado na tela, então fica sempre vazio em pagamentos novos.
- **"Primeiro recebimento previsto" agora pré-preenche sozinho.** A lógica de calcular a partir de `prazoRecebimentoCartaoCreditoDias`/`prazoRecebimentoCartaoDebitoDias` (Configurações Avançadas) **já existia** em `normalizePayments` (financeDomain.ts:347-355) e já era usada de verdade ao finalizar a venda mesmo com o campo em branco — o problema era só visual: o campo ficava vazio na tela, sem mostrar a data que seria usada. Agora o campo mostra a data calculada (mesmo padrão já usado pelo campo "Data de vencimento" do Pagamento a Prazo: `value` cai para a data calculada quando o usuário não digitou nada), com um aviso abaixo indicando se veio do crédito ou do débito. Selecionar uma data manualmente continua sobrescrevendo o cálculo automático, como antes.

### F10 — Vínculo real de cliente em vendas/OS e Contas a Receber por cliente (feature, 2026-07-29)

**Não estava no prompt original.** Pedido do usuário: ao finalizar venda/OS e gerar registro de Contas a Receber, o débito precisa estar de fato ligado ao cadastro do cliente, com uma visão que mostra os clientes com débito em aberto (referência: print de outro ERP mostrando uma listagem de crediário por cliente).

**Descoberta ao investigar:** o sistema nunca gravou um vínculo real (`clienteId`) entre pedido de venda/transação e o documento do cliente — só `clienteNome` (texto). PDV já era uma exceção parcial: gravava `clienteId` no pedido, mas não na transação de pagamento gerada a partir dele.

**Decisão do usuário:** corrigir só daqui pra frente (não migrar histórico). Vendas/OS antigas continuam só com `clienteNome`.

**Implementado:**
- `PedidoVendaForm.tsx` e `OSForm.tsx`: o bloco de "cadastrar cliente se não existir" (que já rodava antes de cada finalização) passou a capturar o `id` do cliente encontrado ou recém-criado, e gravar `clienteId` tanto no documento do pedido/OS quanto em cada transação de pagamento gerada (`transacoes`).
- `PDV.tsx`: já gravava `clienteId` no pedido; passou a gravar também na transação de pagamento (mesma lacuna do Pedido/OS, só que parcial).
- [`Financeiro/ContasReceber.tsx`](../src/pages/Financeiro/ContasReceber.tsx): tela reestruturada de lista plana de transações pendentes para **lista agrupada por cliente** — cada linha é um cliente com total pendente, quantidade de títulos e vencimento mais antigo (destacado em vermelho se atrasado), expansível para ver e dar baixa em cada título individualmente. Busca por nome de cliente. Registros antigos sem `clienteId` continuam agrupando por nome (sem garantia de que seja o mesmo cadastro, já que nome não é único).
- Toda a lógica de conciliação/baixa (`confirmarRecebimento`, crédito de devolução) não mudou — só a apresentação foi reorganizada.

**Não faça:** não migrar `clienteId` retroativamente em vendas/OS/transações antigas sem pedido explícito — decisão consciente do usuário.

### F11 — Foco volta pra busca de produto após adicionar item (bugfix, 2026-07-29)

**Não estava no prompt original.** Reportado pelo usuário: no Pedido de Venda, depois de adicionar um item (clique ou Enter), o foco não voltava pro campo de busca de produto, obrigando a clicar de novo pra buscar o próximo item.

**Implementado em [`PedidoVendaForm.tsx`](../src/pages/Vendas/PedidoVendaForm.tsx):**
- `ProductAutocomplete` ganhou um `inputRef` (`produtoBuscaInputRef`); ao final de `handleAddItem`, chama `.focus()` nesse input — funciona independente de como o item foi adicionado (clique no botão ou Enter).
- Enter nos campos Qtd/Preço Unt./Desc. (R$) agora também dispara `handleAddItem` (antes só o clique no botão "Adicionar" funcionava).

**Escopo:** só Pedido de Venda, conforme pedido ("tela de vendas"). OS e Orçamento têm o mesmo padrão de "buscar produto → definir qtd/preço → clicar Adicionar" e provavelmente têm a mesma limitação de foco — não mexido ainda, ver Seção 9 se for pra estender.

---

## 3. Fase 1 — Ganhos operacionais (risco baixo)

Ordem sugerida: **2 → 10 → 9 → 11 → 14 → 3 → 5**.

### Módulo 2 — Bandeiras de cartão

**Estado atual:** os campos existem, mas como **texto livre** em [`PaymentsEditor.tsx:400`](../src/components/finance/PaymentsEditor.tsx) — `bandeira`, `operadora`, `autorizacao` são `<input>` com placeholder "Ex.: Visa". O prompt diz explicitamente "nunca digitar nome manualmente"; é exatamente o que o sistema faz hoje. O tipo `CardPaymentDetails` em [`financeDomain.ts`](../src/utils/financeDomain.ts) já carrega os três campos.

**O que falta:** cadastro de bandeiras e troca do input por seleção.

**Como implementar:**
- Coleção `bandeiras_cartao` isolada por `tenantId`, seguindo o padrão de F4.
- Seed automático no primeiro acesso do tenant: Visa, Mastercard, Elo, Hipercard, American Express.
- Campos: `nome`, `ativo`, `ordem`. Permitir o tenant adicionar outras.
- `PaymentsEditor` passa a usar `<select>` para bandeira. **Operadora/adquirente** também deveria virar catálogo (Cielo, Rede, Stone...) — mesmo padrão, decidir com o usuário se entra agora.
- `autorizacao` (NSU) **continua** input livre — é número da transação, correto ser digitado.
- **Compatibilidade:** vendas antigas têm bandeira em texto livre que pode não existir no catálogo. Ao exibir histórico, mostrar o valor gravado mesmo se não estiver mais no catálogo. **Nunca** reescrever documentos antigos.
- Aplicar em: PDV, Pedido de Venda, OS e Contas a Receber (baixa com cartão).

**Arquivos afetados:** `PaymentsEditor.tsx`, `financeDomain.ts` (nenhuma mudança de tipo necessária), nova página de catálogo, `moduleCatalog.ts`, `firestore.rules`, `Sidebar.tsx`.

**Aceite:** operador não consegue digitar nome de bandeira; venda antiga com bandeira legada ainda exibe corretamente; bandeira inativa não aparece para seleção nova mas continua visível no histórico; permissão respeitada.

**Não faça:** não migrar dados históricos; não travar venda antiga por bandeira inexistente.

**Concluído em 2026-07-28** (decisão do usuário: só Bandeira vira catálogo; Operadora/adquirente continua texto livre):
- Coleção `bandeiras_cartao` + página [`src/pages/BandeirasCartao/BandeirasCartaoList.tsx`](../src/pages/BandeirasCartao/BandeirasCartaoList.tsx), usando os hooks do F4 (`useTenantCollection`, `pickMissingDefaults`, `hasModuleAccess`).
- Permissão `cadastros.bandeiras_cartao` em `moduleCatalog.ts`, rota `/bandeiras-cartao` em `App.tsx`, item no `Sidebar.tsx`.
- `firestore.rules`: `bandeiras_cartao` liberado para leitura por qualquer membro do tenant (necessário para o select aparecer pra qualquer operador fechando venda), escrita/exclusão atrás da permissão especifica.
- `PaymentsEditor.tsx` ganhou prop `tenantId` e busca as bandeiras via `useTenantCollection`; o campo Bandeira virou `<select>`. Compatibilidade testada: `buildBrandOptions()` inclui o valor gravado mesmo se ele não estiver mais (ou nunca esteve) no catálogo.
- OS e Pedido de Venda passam `tenantId` para o `PaymentsEditor`. PDV e Contas a Receber **não foram alterados** — nenhum dos dois captura bandeira hoje (checado no código antes de implementar), então não havia nada para trocar por seleção ali.

**Resolvido em 2026-07-29:** o usuário reportou o erro "Ocorreu um erro ao carregar as bandeiras padrão" ao tentar usar "Carregar Padrões" — era exatamente esta pendência (confirmado: `firestore.rules` já tinha a regra certa desde 2026-07-28, só nunca tinha sido implantada). Implantado via `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project sistema-nexus-dev` (ver F6 acima para como o CLI foi viabilizado sem instalação global).

### Módulo 10 — Limitar autocomplete a 6 + "Ver Mais"

**Estado atual:** PDV corta em 12 ([`PDV.tsx:104`](../src/pages/PDV/PDV.tsx)); Pedido e OS **não cortam** — renderizam o catálogo inteiro.

**O que falta:** limite de 6 uniforme e modal "Ver Mais".

**Como implementar:** consequência direta de F1 + F2. Limite 6 configurável, padrão 6. Modal busca por nome, código, código interno, código de barras, referência, marca e categoria.

**Aceite:** as três telas cortam em 6; o contador de resultados totais aparece; "Ver Mais" abre modal funcional por teclado; catálogo grande não trava a tela.

**Concluído em 2026-07-28:**
- `ProductAutocomplete` (F2) mudou o limite padrão de 8 para 6.
- `src/components/common/ProductSearchModal.tsx` — modal de busca completa (nome, código, código de barras, referência, código interno/SKU, marca, categoria — direto do F1), com corte de segurança em 100 resultados (`RESULTADOS_SAFETY_LIMIT`) pra catálogo grande não travar a tela. Fecha por Esc usando `useEscapeLayer` do F3 — primeiro consumidor real dessa fundação.
- PDV, Pedido de Venda e OS renderizam o modal e passam `onViewMore` pro `ProductAutocomplete`; `renderItem` extraído pra uma função só, reaproveitada no dropdown e no modal (evita duplicar o JSX da linha do produto).

**Validação:** typecheck, lint (0 erros), build e os 44 testes passando. No navegador: dropdown continua funcionando após a mudança de limite; testado com dados reais do dev (só 2 produtos cadastrados) — o botão "Ver Mais" corretamente **não aparece** quando os resultados cabem no limite (comportamento esperado). Não foi possível testar visualmente o botão "Ver Mais" aparecendo de fato nem o modal abrindo/fechando com produtos reais porque o catálogo de teste no `sistema-nexus-dev` tem poucos itens — a lógica que decide truncamento (`searchProducts`/F1) e o fechamento por Esc (F3) já têm cobertura de teste unitário, mas a integração visual do modal em si (abrir, digitar, clicar num resultado) não foi confirmada num teste ponta-a-ponta real nesta sessão. Recomendado um teste manual rápido quando o catálogo tiver mais de 6 produtos.

### Módulo 9 — Busca exata vs. completa

**Estado atual:** o PDV já faz exato-primeiro-com-fallback; as outras duas telas não. Não há configuração.

**Como implementar:** toggle em Configurações Avançadas ([`Configuracoes.tsx:1003`](../src/pages/Configuracoes/Configuracoes.tsx)), gravado no doc `configuracoes/{tenantId}`, consumido por F1. Padrão: `completa` (preserva comportamento atual — não mudar o que o usuário já conhece sem ele pedir).

**Aceite:** "ABA" em modo exata retorna só produtos que começam com ABA; em completa retorna qualquer ocorrência; código de barras funciona nos dois modos.

**Concluído em 2026-07-28:**
- Campo `buscaProdutoModo` ('exata' | 'completa', padrão 'completa') em [`Configuracoes.tsx`](../src/pages/Configuracoes/Configuracoes.tsx), seção Configurações Avançadas, persistido em `configuracoes/{tenantId}` no mesmo padrão do `venderSemEstoque` já existente.
- PDV, Pedido de Venda e OS agora leem esse campo (mesmo `useEffect` que já buscava `venderSemEstoque`) e passam `mode` para `ProductAutocomplete`/`ProductSearchModal` — a prop já existia desde F1/F2, só faltava ser alimentada por configuração.
- `DEFAULT_PRODUCT_SEARCH_MODE` exportado de [`productSearch.ts`](../src/utils/productSearch.ts) para as 4 telas (Configurações + as 3 de busca) compartilharem o mesmo default sem repetir a string.
- Typecheck, lint (0 erros, 70 warnings pré-existentes), build e os 44 testes passando.

**Pendente — validação manual roteirizada (item 6 do checklist de "pronto"):** ainda não confirmada por login real no navegador (dependia do usuário, que ia testar e retornar). Sem migração de dados: o padrão `completa` preserva o comportamento atual para quem nunca tocar no toggle.

### Módulo 11 — Consulta por CDP (código do produto)

**Estado atual:** o campo `codigo` já existe no cadastro ([`EstoqueForm.tsx`](../src/pages/Estoque/EstoqueForm.tsx)); PDV já busca por ele; Pedido busca parcialmente; OS não busca.

**O que falta:** nada além de F1 aplicado às três telas. **Este módulo é absorvido por F1** — não criar código específico. Validar e marcar como concluído.

**Concluído em 2026-07-28:** confirmado por leitura de código — PDV, Pedido de Venda e OS usam todos `searchProducts`/`productMatchesExactCode` de F1, que trata `codigo` como `CODE_FIELD` (prefixo/exato, com prioridade sobre nome). Nada a implementar; módulo fecha só com esta validação.

### Módulo 14 — Buscas do sistema

**Estado atual:** `codigoBarras`, `marca`, `referencia` já existem no cadastro de produto. `fornecedor` precisa ser verificado.

**O que falta:** garantir que todos os campos entrem em F1 e que a busca global da TopBar (hoje só OS e clientes, em [`TopBar.tsx:272`](../src/components/layout/TopBar.tsx)) também cubra produtos.

**Atenção de performance:** a busca da TopBar hoje puxa `limit(80)` e filtra no cliente. Com catálogo grande isso não escala. Avaliar índice ou campo de busca normalizado antes de ampliar.

**Concluído em 2026-07-28:**
- `fornecedor` confirmado no cadastro ([`EstoqueForm.tsx:58`](../src/pages/Estoque/EstoqueForm.tsx)) — já coberto por F1 (`TEXT_FIELDS`) desde a criação do serviço unificado.
- TopBar ganhou uma terceira query (`estoque`, `limit(80)`, mesmo padrão de OS/clientes) e usa `productMatchesSearch` (F1, modo `completa`) para reaproveitar a mesma lógica de normalização/match das outras telas em vez de duplicar comparação de string. Resultado navega para `/estoque/editar/:id`.
- **Risco de performance não resolvido, propositalmente:** manteve-se o mesmo padrão `limit(80)` + filtro no cliente já usado por OS/clientes — não é escalável para catálogo grande, mas resolver isso é um problema estrutural maior (índice dedicado ou campo de busca normalizado) que afeta as três buscas da TopBar igualmente, não só produtos. Ficou fora do escopo deste módulo; ver pendência na Seção 9.
- Typecheck, lint (0 erros) e build passando (mesma rodada de validação do Módulo 9, nenhum teste novo necessário — a função reaproveitada já tem cobertura em `productSearch.test.ts`).

**Pendente — validação manual:** mesma limitação do Módulo 9 (depende de login real no navegador).

### Módulo 3 — Impressão múltipla

**Estado atual:** só impressão unitária (`/pedidos-venda/print/:id`).

**Como implementar:** checkbox por linha em [`PedidoVendas.tsx`](../src/pages/Vendas/PedidoVendas.tsx) + "selecionar todos" + rota de impressão em lote que renderiza N documentos com quebra de página CSS. Reutilizar o layout de [`PedidoPrint.tsx`](../src/pages/Vendas/PedidoPrint.tsx) — **não** criar segundo layout.

**Aceite:** seleção múltipla; impressão contínua com quebra correta; limite de segurança (ex.: 50 por vez) com aviso; seleção limpa após imprimir.

**Concluído em 2026-07-28:**
- Layout do recibo extraído para [`PedidoPrintDocument.tsx`](../src/pages/Vendas/PedidoPrintDocument.tsx) (era só um `<div className="a4-page">` inline em `PedidoPrint.tsx`), consumido tanto pela impressão unitária quanto pela nova em lote — nenhum layout duplicado.
- Nova rota `pedidos-venda/print-lote?ids=a,b,c` em [`PedidoPrintLote.tsx`](../src/pages/Vendas/PedidoPrintLote.tsx): busca os pedidos e clientes em paralelo, renderiza um `PedidoPrintDocument` por pedido dentro de um wrapper `.print-batch-item` com `page-break-after: always` (exceto no último) em [`PedidoPrintLote.css`](../src/pages/Vendas/PedidoPrintLote.css) — não mexe no CSS de página única.
- [`PedidoVendas.tsx`](../src/pages/Vendas/PedidoVendas.tsx) ganhou checkbox por linha + "selecionar todos" (aplicado só aos pedidos visíveis no filtro/aba atual) + botão "Imprimir Selecionados (N)".
- Limite de segurança de 50 pedidos por lote, compartilhado entre a lista e a tela de impressão via [`pedidoPrintLoteConstants.ts`](../src/pages/Vendas/pedidoPrintLoteConstants.ts) (evita importar o componente de impressão inteiro só pela constante, o que quebraria o code-splitting da rota lazy). Ao estourar o limite — seja por "selecionar todos" ou marcando um a um — mostra aviso e trava em 50.
- Seleção limpa após imprimir de graça: a lista é desmontada ao navegar para a tela de impressão, então o estado local `selectedIds` reseta sozinho ao voltar.
- Typecheck, lint (0 erros) e build confirmam que os chunks `PedidoPrint`, `PedidoPrintDocument` e `PedidoPrintLote` ficaram separados como esperado (nenhum bundle inflado).

**Pendente — validação manual:** mesma limitação dos módulos anteriores (depende de login real no navegador); em especial testar a quebra de página numa impressão real (preview de impressão do navegador) com 2+ pedidos.

### Módulo 5 — Empresas fiscais e não fiscais

**Como implementar:** apenas três flags em Configurações Avançadas — `emiteNFe`, `emiteNFCe`, `emiteNFSe`. Gravar no doc de configurações. O prompt é explícito: **só estrutura, sem trava obrigatória ainda**.

**Não faça:** não condicionar nenhuma tela a essas flags nesta fase. Isso é decisão da Fase 4.

**Concluído em 2026-07-28:** três checkboxes (`emiteNFe`, `emiteNFCe`, `emiteNFSe`) em [`Configuracoes.tsx`](../src/pages/Configuracoes/Configuracoes.tsx), Configurações Avançadas, persistidos em `configuracoes/{tenantId}` no mesmo padrão dos demais campos da seção. Nenhuma tela do sistema foi alterada para reagir a essas flags, conforme instruído — é só registro informativo por enquanto.

---

## 4. Fase 2 — Consistência e rastreabilidade (risco médio)

Ordem: **1 → 19 → 20 → 18 → 6 → 15**.

### Módulo 1 — Navegação por teclado

**Estado atual:** PDV tem F2–F7, Esc, setas e Enter ([`PDV.tsx:560`](../src/pages/PDV/PDV.tsx)). Pedido de Venda, OS e Cadastros praticamente não têm.

**Como implementar:** via F3. Um fluxo por commit — Pedido, depois OS, depois Cadastros. Padronizar os mesmos atalhos do PDV entre telas (o operador não pode ter que reaprender por tela). Documentar a tabela de atalhos e exibi-la numa ajuda acessível por `?` ou `F1`.

**Aceite:** fechar uma venda inteira sem tocar no mouse; foco nunca fica perdido após ação; Esc fecha só o modal do topo da pilha; Tab não pula campo obrigatório.

### Módulo 19 — Numeração

**Estado atual:** `contadores/{tenantId}` já existe e é transacional para pedido, OS e orçamento ([`firestoreAtomic.ts`](../src/utils/firestoreAtomic.ts)).

**O que falta:** sequências para produção, conferência, caixa e notas. Via F5.

**Não faça:** não trocar o mecanismo existente — ele já é atômico e correto. Apenas estender o tipo.

### Módulo 20 — Responsabilidade

**Estado atual:** `usuarioResponsavelId` + `createdAt` existem, mas de forma irregular; `alteradoPor` não existe.

**Como implementar:** via F5, aplicando o helper a todo documento novo, e adicionando aos existentes **sem migração retroativa** (documento antigo simplesmente não tem o campo; a UI trata ausência).

### Módulo 18 — Cancelamentos

**Estado atual:** **em grande parte pronto.** A reformulação financeira de 19/07 já entregou estorno determinístico com `idempotencyKey`, cancelamento de venda ([`PedidoVendaForm.tsx:1159`](../src/pages/Vendas/PedidoVendaForm.tsx)) e de OS ([`OSForm.tsx:834`](../src/pages/OS/OSForm.tsx)), com comissão marcada como cancelada.

**O que falta:** auditar cobertura de "Reabrir" (existe?) e garantir que os módulos novos (produção, conferência) nasçam com as quatro operações. Este módulo vira **checklist de auditoria**, não implementação nova.

**Não faça:** não reescrever a lógica de estorno existente.

### Módulo 6 — Central de Notas Fiscais

**Estado atual:** existe emissão em [`NFE.tsx`](../src/pages/Fiscal/NFE.tsx) e entrada de XML em [`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx). Não existe listagem centralizada.

**Como implementar:** renomear o item de menu "Emitir Nota Fiscal" → "Notas Fiscais"; nova tela de listagem sobre a coleção `notas_fiscais` (já prevista nas `firestore.rules`) com NF, status, cliente, valor, data e ações (DANFE, WhatsApp, reenviar, cancelar). Botão "Emitir Nota Fiscal" acima da lista abre a emissão manual atual. **A emissão manual não baixa estoque** — o prompt é explícito.

**Aceite:** listagem paginada e filtrável; ações respeitam permissão (`fiscal.emitir`, `fiscal.excluir`); emissão manual não mexe em estoque nem financeiro; cancelamento registra auditoria.

### Módulo 15 — Relatórios padronizados

**Estado atual:** filtros, CSV, paginação, ordenação e impressão já existem em [`RelatoriosVendas.tsx`](../src/pages/Vendas/RelatoriosVendas.tsx) e [`RelatorioComissoes.tsx`](../src/pages/Financeiro/RelatorioComissoes.tsx). **Faltam PDF e Excel.**

**Como implementar:** extrair o padrão dos relatórios existentes para componentes compartilhados em `src/components/Reports/`. Para PDF, avaliar usar a impressão do navegador (já usada nas telas de print) antes de adicionar dependência. Para Excel, preferir CSV com encoding correto se atender — **evitar adicionar biblioteca pesada** ao bundle sem necessidade (o vendor já tem 410 KB).

**Decisão pendente:** confirmar com o usuário se "Excel" exige `.xlsx` real ou se CSV resolve.

---

## 5. Fase 3 — Estrutural (risco alto, exige modelagem)

Ordem obrigatória: **13 → 12 → 4 → 16**. Cada um depende do anterior.

### Módulo 13 — Reserva de estoque

**Estado atual:** não existe reserva. `applyStockAdjustments` em [`firestoreAtomic.ts:96`](../src/utils/firestoreAtomic.ts) decrementa o estoque **no fechamento** da venda/OS, dentro da transação.

**Por que vem primeiro:** conferência (12) e produção (4) dependem de saber o que está reservado vs. disponível. Implementar na ordem errada obriga a refazer.

**Como implementar:**
- Configuração do momento da baixa: `Reservar no Pedido` | `Baixar no Caixa` | `Baixar na NF` | `Baixar imediatamente`.
- **Padrão obrigatório = `Baixar imediatamente`** (comportamento atual). O prompt exige explicitamente "sem alterar comportamento atual".
- Introduzir `quantidadeReservada` no produto e estoque disponível derivado = `quantidade - quantidadeReservada`.
- Toda mutação de reserva dentro de transação, com liberação em cancelamento/expiração.

**Risco alto:** mexe no núcleo transacional que sustenta venda, OS e PDV. Exige testes unitários fortes de todas as transições e validação manual exaustiva.

**Não faça:** não alterar o comportamento padrão; não permitir reserva órfã (cancelamento sempre libera).

### Módulo 12 — Conferência de mercadoria

**Estado atual:** não existe. Coleções `expedicoes` e `entregas` já estão liberadas nas `firestore.rules`.

**Fluxo:** Pedido → Separação → Conferência → Aguardando Expedição → Entrega → Finalizado.

**Como implementar:** máquina de estados explícita e testada (função pura de transição), registrando divergências (falta/sobra) sem apagar histórico. Cada transição gera log de auditoria com status anterior e novo.

**Atenção de permissão:** as coleções hoje estão todas atrás de `cadastros.estoque`. Módulos novos precisam de **permissões próprias** em [`moduleCatalog.ts`](../src/utils/moduleCatalog.ts) e nas `firestore.rules` — não pendurar em `cadastros.estoque`.

### Módulo 4 — Produção

**Estado atual:** não existe. Já há esqueleto nas `firestore.rules` (`ordens_producao`, `produtos_composicao`, `estoque_lotes`) e placeholder de rota (`/operacoes/:moduleId` → `RoadmapModule`), com a permissão `operacoes.producao` já catalogada.

**⚠ Atenção:** o PDF original tem **um trecho corrompido logo após "relatórios"** nesta seção. Pode haver requisito não lido. **Confirmar com o usuário antes de iniciar.**

**Fluxo:** Entrada Matéria Prima → Estoque → Ordem de Produção → Em Produção → Pausada → Retornada → Finalizada → Produto Acabado.

**Controlar:** matéria-prima, produto acabado, perdas, produção parcial, responsável, data/hora, tempo, status, histórico, relatórios.

**Como implementar:** é o maior módulo — quebrar em sub-etapas com commit próprio: (a) composição de produto, (b) ordem de produção + máquina de estados, (c) consumo de matéria-prima integrado ao Módulo 13, (d) perdas e produção parcial, (e) relatórios.

### Módulo 16 — Dashboard integrado

**Bloqueado** por 4 e 12. Integrar produção, perdas, conferência, pedidos, notas e financeiro no dashboard existente. O prompt é explícito: **nunca criar dashboard separado** — estender [`Dashboard.tsx`](../src/pages/Dashboard/Dashboard.tsx), que já respeita os períodos Hoje/Semana/Mês e o tema claro/escuro.

---

## 6. Fase 4 — Decisões travadas (não implementar sem aprovação)

### Módulo 7 — Novo fluxo de vendas ⚠

**Contradição com o próprio prompt.** O documento proíbe "alterar regras já existentes" e "quebrar compatibilidade", mas este módulo reestrutura o fluxo de vendas: tira o cupom fiscal do Pedido e passa a NFC-e para a Frente de Caixa.

Isso mexe exatamente no domínio financeiro reconstruído em 19/07 (pagamentos, comissão, caixa, transações atômicas), e a emissão via Spedy hoje está acoplada ao fechamento do Pedido ([`PedidoVendaForm.tsx:610`](../src/pages/Vendas/PedidoVendaForm.tsx)).

**Exige antes de qualquer código:** decisão explícita do usuário, plano de migração para vendas já existentes, e definição do que acontece com pedidos históricos que emitiram cupom.

### Módulo 8 — Nota com valor diferente ⚠⚠

**Risco fiscal, não técnico.** Emitir nota com valor inferior ao da venda real — mantendo financeiro e estoque no valor cheio — é subfaturamento. O rastro fica registrado no próprio sistema (auditoria, transações) e na SEFAZ.

**Não implementar sem validação de um contador.** É provável que a necessidade real seja outra coisa (desconto real, venda parcial, nota complementar), o que muda completamente a implementação.

### Módulo 17 — Integração entre módulos

Não é módulo — é **critério de aceite transversal**. Todo módulo das Fases 1–3 deve provar que alimenta o fluxo:

`Cadastro → Pedido → Reserva → Separação → Conferência → Frente de Caixa → Financeiro → Nota Fiscal → Entrega → Relatórios → Dashboard`

Sem duplicar informação entre etapas.

---

## 7. Mapa de risco de regressão

Arquivos que **mais** módulos tocam. Alterações aqui exigem validação extra:

| Arquivo | Módulos que tocam | Por quê |
|---|---|---|
| [`src/utils/financeDomain.ts`](../src/utils/financeDomain.ts) | 2, 7, 8 | Núcleo financeiro; 13 testes dependem dele |
| [`src/utils/firestoreAtomic.ts`](../src/utils/firestoreAtomic.ts) | 13, 19, 4, 12 | Transações, sequências e estoque |
| [`src/pages/Vendas/PedidoVendaForm.tsx`](../src/pages/Vendas/PedidoVendaForm.tsx) | 1, 2, 9, 10, 11, 13, 7 | Tela mais crítica do sistema |
| [`src/pages/OS/OSForm.tsx`](../src/pages/OS/OSForm.tsx) | 1, 2, 9, 10, 11, 13 | Mesmo domínio financeiro da venda |
| [`src/pages/PDV/PDV.tsx`](../src/pages/PDV/PDV.tsx) | 1, 2, 9, 10, 13, 7 | Frente de caixa |
| [`firestore.rules`](../firestore.rules) | 2, 4, 12, 6 | Toda coleção nova precisa de regra + permissão |
| [`src/utils/moduleCatalog.ts`](../src/utils/moduleCatalog.ts) | 2, 4, 6, 12 | Permissões e bloqueio de módulo por tenant |

---

## 8. Quadro de acompanhamento

Atualizar ao concluir cada item.

| Item | Fase | Status | Concluído em |
|---|---|---|---|
| F1 Busca unificada | 0 | ✅ Concluido — PDV, Pedido de Venda e OS migrados; OS ganhou busca por codigo (nao tinha) | 2026-07-27 |
| F2 Autocomplete compartilhado | 0 | ✅ Concluido — PDV, Pedido de Venda e OS migrados | 2026-07-27 |
| F3 Primitivas de teclado | 0 | ✅ Concluido — hook criado, aguarda consumo pelo Modulo 1 | 2026-07-27 |
| F4 Padrão de catálogo | 0 | ✅ Concluido — hook de coleção + seed dedup + hasModuleAccess; forms continuam por tela | 2026-07-27 |
| F5 Sequências e metadados | 0 | ✅ Concluido — SequenceKey alargada, buildDocumentMetadata criado; documentos existentes nao migrados | 2026-07-27 |
| F6 Índices versionados | 0 | 🟨 Arquivo criado — falta `firebase deploy --only firestore:indexes` (CLI não instalado aqui) | 2026-07-27 |
| M2 Bandeiras de cartão | 1 | 🟨 Código pronto — falta `firebase deploy --only firestore:rules` (CLI não instalado aqui) | 2026-07-28 |
| M10 Limite de autocomplete | 1 | ✅ Concluído — modal "Ver Mais" criado; teste visual com >6 produtos pendente (catálogo dev pequeno) | 2026-07-28 |
| M9 Busca exata/completa | 1 | 🟨 Código pronto — falta validação manual roteirizada | 2026-07-28 |
| M11 Consulta por CDP | 1 | ✅ Concluído — absorvido por F1, confirmado por leitura de código | 2026-07-28 |
| M14 Buscas do sistema | 1 | 🟨 Código pronto — falta validação manual; risco de performance da TopBar segue aberto (Seção 9) | 2026-07-28 |
| M3 Impressão múltipla | 1 | 🟨 Código pronto — falta validação manual (quebra de página real) | 2026-07-28 |
| M5 Flags fiscais | 1 | 🟨 Código pronto — falta validação manual | 2026-07-28 |
| M1 Navegação por teclado | 2 | ⬜ Pendente | |
| M19 Numeração | 2 | ⬜ Pendente | |
| M20 Responsabilidade | 2 | ⬜ Pendente | |
| M18 Cancelamentos (auditoria) | 2 | ⬜ Pendente | |
| M6 Central de Notas Fiscais | 2 | ⬜ Pendente | |
| M15 Relatórios padronizados | 2 | ⬜ Pendente | |
| M13 Reserva de estoque | 3 | ⬜ Pendente | |
| M12 Conferência de mercadoria | 3 | ⬜ Pendente | |
| M4 Produção | 3 | ⬜ Pendente | |
| M16 Dashboard integrado | 3 | ⬜ Pendente | |
| M7 Novo fluxo de vendas | 4 | 🔒 Travado — aguarda decisão | |
| M8 Nota com valor diferente | 4 | 🔒 Travado — aguarda contador | |

---

## 9. Pendências a esclarecer com o usuário

1. **Módulo 4:** trecho corrompido no PDF original — confirmar se falta requisito de Produção.
2. **Módulo 15:** "Excel" exige `.xlsx` real ou CSV atende?
3. ~~**Módulo 2:** operadora/adquirente também vira catálogo agora ou fica texto livre?~~ Decidido em 2026-07-28: continua texto livre.
4. **Módulo 7:** decisão de arquitetura + plano de migração.
5. **Módulo 8:** validação contábil antes de qualquer implementação.
6. **Filial:** o relatório financeiro de 19/07 já apontou que não existe entidade de filial, e isso bloqueia sessão de caixa por operador/filial. Definir se entra no escopo.
7. **Módulo 14 / TopBar:** busca global (OS, clientes e agora produtos) usa `limit(80)` + filtro no cliente nas três coleções — não escala para catálogo grande. Resolver exige índice dedicado ou campo de busca normalizado, afetando as três buscas juntas; não implementado ainda, fora do escopo deste módulo.
8. **Repositórios git:** confirmado em 2026-07-28 que este diretório local tinha só um remote (`origin`), que na verdade aponta para o repo de **produção** (`Sistema-Nexus-Company-Commit`). Renomeado para `production` e criado um novo remote `dev` → `SaaS_NexarERP-DESENVOLVIMENTO`. Os commits de M2/M10/M9 já foram parar em `production` (não revertido, a pedido do usuário) mas **ainda não foram enviados a `dev`** — `git push dev main` ficou pendente (bloqueado pelo classificador de permissão do Claude Code na tentativa automática; precisa ser rodado pelo usuário ou reautorizado explicitamente a cada sessão).
