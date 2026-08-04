# Plano de Evolução do Hennder ERP

Documento de arquitetura e execução derivado do prompt "Hennder ERP — Missão de Implementação e Evolução do Sistema".

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

### F12 — Mesma correção de foco estendida ao Orçamento (bugfix, 2026-07-29)

**Reportado pelo usuário:** confirmação de que o comportamento de F11 ("tela de vendas") ainda não se aplicava em todo lugar. Ao investigar, o Pedido de Venda já estava correto (F11); quem ainda tinha a lacuna era o Orçamento.

**Implementado em [`OrcamentoForm.tsx`](../src/pages/Orcamentos/OrcamentoForm.tsx):**
- Novos refs `servicoNomeInputRef` e `pecaNomeInputRef` (este último passado como `inputRef` do `ProductAutocomplete` da peça).
- Enter nos campos Nome do Serviço/Preço e Preço da Peça agora dispara `handleAddItem` (antes só o clique no botão "Adicionar" funcionava).
- Ao final de `handleAddItem`, foco volta pro campo de nome (serviço ou peça, conforme o tipo adicionado).

**Escopo:** só Orçamento. OS continua com a mesma lacuna, ainda não estendida — mesma pendência da Seção 9.

### F13 — Mesma correção de foco estendida à OS (bugfix, 2026-07-29)

**Descoberto ao planejar a fatia OS do Módulo 1** (não foi reportado separadamente pelo usuário): lendo `OSForm.tsx` inteiro, os campos de Serviço e Peça tinham a mesma lacuna de F11/F12 — só adicionavam por clique no botão "+", Enter não fazia nada.

**Implementado em [`OSForm.tsx`](../src/pages/OS/OSForm.tsx):**
- Novos refs `servicoNomeInputRef` e `pecaNomeInputRef` (este último via `inputRef` do `ProductAutocomplete` da peça).
- Enter em Nome do Serviço, Preço do Serviço e Preço da Peça agora dispara `handleAddServico`/`handleAddPeca`.
- Ao final de cada handler, foco volta pro campo de nome correspondente.

**Escopo:** só OS. Fecha a pendência da Seção 9 sobre estender F11 a OS/Orçamento — agora as três telas (Pedido, Orçamento, OS) têm o mesmo comportamento de Enter-para-adicionar + retorno de foco.

### F14 — Taxa de cartão por bandeira + relatório de taxas pagas (feature, 2026-07-29)

**Não estava no prompt original de 20 módulos.** Pedido direto do usuário: a taxa de cartão (débito à vista + 12 parcelas de crédito) e os prazos de recebimento eram uma configuração única e global por tenant, em Configurações → "Cartões e Recebimento". Na prática cada bandeira/administradora cobra taxa e prazo diferentes — o pedido foi mover essa configuração pra dentro do cadastro de cada bandeira, remover a tela global, e criar um relatório de quanto a empresa paga de taxa às administradoras.

**Decisões confirmadas com o usuário:** prazos de recebimento também viram por bandeira (não só a taxa %); a edição fica num ícone novo por linha em Bandeiras de Cartão (painel separado do lápis de Nome/Ordem/Ativa); bandeiras já cadastradas herdam o valor global atual como ponto de partida.

**Implementado:**
- [`financeDomain.ts`](../src/utils/financeDomain.ts): novo tipo `CardFeeSchedule` + `buildCardFeeSchedulesByBrand` (função pura, testada) + `PaymentValidationOptions.cardFeeSchedulesByBrand`. Em `normalizePayments`, quando a bandeira do pagamento tem schedule próprio no mapa, ele vence os campos globais (`creditFeePercentByInstallment`/`debitFeePercent`/`creditSettlementDays`/`debitSettlementDays`) — **sem o mapa, comportamento idêntico ao anterior**, os 55 testes existentes continuaram passando sem alteração; 3 testes novos cobrem o override por bandeira e o fallback.
- [`BandeirasCartaoList.tsx`](../src/pages/BandeirasCartao/BandeirasCartaoList.tsx): novo ícone (%) por linha abre um modal só de taxas (mesma grade de Configurações + os 2 prazos). Ao abrir uma bandeira sem taxa própria ainda, os campos vêm pré-preenchidos com o valor de `configuracoes/{tenantId}` — migração "lazy", sem script em lote.
- PDV, Pedido de Venda e OS passam a assinar `bandeiras_cartao` e montar `cardFeeSchedulesByBrand` antes de chamar `normalizePayments`; os campos globais de Configurações continuam sendo buscados e servem de fallback pra bandeiras sem taxa própria (é o mecanismo de herança, sem migração em lote). `PaymentsEditor.tsx` também passou a prever a data de recebimento pela bandeira selecionada em vez do prazo fixo global.
- [`Configuracoes.tsx`](../src/pages/Configuracoes/Configuracoes.tsx): removida a grade de taxas + os 2 campos de prazo da UI. Mantido "Máximo de parcelas no crédito" (é política, não taxa) e mantidos os campos no documento Firestore (fallback interno, sem tela própria).
- Novo relatório "Taxas Pagas às Administradoras" em Relatórios Diversos (substituiu o tile placeholder): [`PrintRelatorioTaxasCartao.tsx`](../src/pages/RelatoriosDiversos/PrintRelatorioTaxasCartao.tsx) lê `transacoes` por tenant, filtra as que têm pagamento em cartão dentro do período, e agrupa por bandeira (bruto, taxa paga, líquido, taxa média) — usa `cartao.taxaPercentual`/`valorTaxaCentavos` já gravado em cada transação no momento da venda, sem precisar recalcular nem migrar histórico.

**Não faça:** não migrar dados históricos de `transacoes` (a taxa aplicada em vendas passadas fica congelada como estava, é o valor real cobrado na época); não remover os campos legados do documento `configuracoes` (ficam como fallback).

**Pendente — validação manual:** mesma limitação de login real no navegador de todos os módulos anteriores. Falta: cadastrar taxa numa bandeira e confirmar que uma venda de teste com essa bandeira usa o valor certo; confirmar que bandeira sem taxa própria ainda usa o valor herdado; abrir o relatório novo e conferir os totais.

### F15 — Parcelas de cartão viram títulos separados em Contas a Receber (feature, 2026-07-29)

**Não estava no prompt original.** Pedido direto do usuário: uma venda com cartão de crédito parcelado (ex.: 6x) gravava um único documento em `transacoes` com o valor cheio — Contas a Receber mostrava 1 linha, não 6. Pediu também que o espaçamento entre parcelas passasse a ser 30 dias úteis (não 1 mês corrido), usando o mesmo campo "Primeiro recebimento do crédito" por bandeira (F14) — confirmado que esse campo passa a ser contado em dias úteis, e que substitui a regra antiga, não é uma regra fixa separada.

**Descoberta ao investigar:** o resto do sistema já tolera múltiplos documentos de `transacoes` por venda (cancelamento já itera sobre todos os documentos de um `pedidoId`; edição de OS já reconcilia um número variável de `pagamentos` entre salvamentos) — então "explodir" o pagamento parcelado em N documentos, um por parcela, **não exigiu nenhuma mudança em `ContasReceber.tsx`**: a tela já lista genericamente qualquer `transacoes` pendente agrupado por cliente.

**Implementado:**
- [`dateTime.ts`](../src/utils/dateTime.ts): nova `addBusinessDaysToDateInput` (pula sábado/domingo; sem calendário de feriados, que não existe no sistema).
- [`financeDomain.ts`](../src/utils/financeDomain.ts): `buildCardDetails` ganhou `installmentIntervalDays` opcional — quando informado, cada parcela usa dias úteis em vez de `addMonthsToDateInput`; **sem essa opção, cai no comportamento antigo exatamente como estava** (retrocompatível, nenhum teste existente mudou). `normalizePayments` passa a calcular o primeiro recebimento do crédito em dias úteis (débito continua em dias corridos, não foi pedido). Nova função pura `explodeInstallmentPaymentRecords`, que separa um pagamento de crédito parcelado em N `PaymentRecord`s independentes (um por parcela, com `cartao.parcelas: 1` em cada um — mantém `applyPaymentReceipt`/recebimento parcial funcionando sem mudança), preservando `numero`/`totalParcelas` pra exibição.
- PDV, Pedido de Venda e OS chamam `explodeInstallmentPaymentRecords` logo após `normalizePayments`, antes de `summarizePayments` — todo o resto (campo `pagamentos`, gravação em `transacoes`) já era genérico sobre o array. Pequeno ajuste cosmético: a descrição gravada em `transacoes` ganha "(Parcela 3/6)" quando aplicável.

**Não faça:** não mexer no prazo do débito; não adicionar calendário de feriados (fora de escopo); não migrar vendas já finalizadas antes dessa mudança.

**Pendente — validação manual:** mesma limitação de login. Falta finalizar uma venda de teste parcelada numa bandeira com taxa configurada e conferir em Contas a Receber que aparecem as N linhas com valores e vencimentos corretos.

### F16 — Tela "Banco" para conciliação de cartão + Contas a Receber só a Prazo (feature, 2026-07-30)

**Não estava no prompt original.** Pedido direto do usuário: cartão de crédito/débito pendente caía em Contas a Receber junto com Pagamento a Prazo, e "dar baixa" lá deixava escolher qualquer forma de recebimento — não faz sentido pra cartão, que é garantido pela operadora e só precisa de conciliação bancária (confirmar que caiu, líquido da taxa da bandeira já configurada por bandeira desde o F14).

**Decisões confirmadas com o usuário:** uma tela só, "Banco", cobre cartão pendente + saldo digital confirmado (não duas telas); Pix/Transferência continuam confirmados automaticamente na venda como sempre foram, só cartão fica pendente aguardando conciliação manual; Fluxo de Caixa continua só sobre dinheiro físico pro saldo, mas ganha uma lista informativa (sem soma) das vendas de PDV em meios digitais.

**Implementado:**
- [`ContasReceber.tsx`](../src/pages/Financeiro/ContasReceber.tsx): `contasPendentes` exclui Cartão de Crédito/Débito — fica só com Boleto/Pagamento a Prazo/Outros, os títulos que realmente dependem de cobrança.
- Nova tela [`Banco.tsx`](../src/pages/Financeiro/Banco.tsx) (`/financeiro/banco`): seção "Cartão pendente de conciliação" (lista plana, não agrupada por cliente — quem olha é o financeiro conferindo o banco) com botão simples "Confirmar no banco" (sem diálogo de escolha de forma, já que não tem escolha); seção "Extrato digital confirmado" com saldo do período, reaproveitando o mesmo filtro que já existia como KPI dentro de `Caixa.tsx`. A ação de confirmar reaproveita `applyPaymentReceipt`/`summarizePayments`/`settledFinancialNatureForPayment` (já existentes, testados) pra manter os `pagamentos` da venda/OS sincronizados — mesma estrutura de `ContasReceber.confirmarRecebimento`, mantida separada (não extraída em abstração compartilhada) pra não arriscar mexer numa tela que já funciona.
- [`Caixa.tsx`](../src/pages/Financeiro/Caixa.tsx): removido o card KPI "Saldo digital líquido do período" (esse papel virou a tela Banco de verdade); nova seção "Vendas do PDV (meios digitais)" usando o campo `sourceOrigin: 'pdv'` que o PDV já gravava nas transações — só registro/visão geral do dia, **sem nenhum total somado**.
- Nova permissão `financeiro.banco` em [`moduleCatalog.ts`](../src/utils/moduleCatalog.ts) e na regra de escrita de `transacoes` em `firestore.rules` (ao lado de `financeiro.caixa`/`.receber`/`.pagar`); item novo no Sidebar.

**Não faça:** Dashboard, Faturamento e TopBar continuam lendo `transacoes` sem distinguir cartão-pendente de prazo-pendente — não reclassificado nessa entrega (fora de escopo, risco desproporcional ao pedido); Contas a Pagar (saídas) não mudou.

**Implantado em 2026-07-30:** regra nova do Firestore (`financeiro.banco`) publicada em `sistema-nexus-dev` (`firebase deploy --only firestore:rules --project sistema-nexus-dev`, deploy confirmado com sucesso).

**Pendente — só validação manual:** mesma limitação de login. Falta abrir o Banco e conciliar um cartão de teste, conferir que some de Contas a Receber e apareça no extrato digital.

### F17 — Exclusão de venda/OS apaga todas as parcelas em `transacoes` (bugfix, 2026-07-30)

**Reportado pelo usuário:** excluiu uma venda e as parcelas de cartão continuaram aparecendo na tela Banco.

**Causa raiz:** `PedidoVendas.tsx` (`handleDelete`) e `OSList.tsx` (`handleDeleteOS`) só tentavam apagar **um** documento de `transacoes` com `id` igual ao `id` do pedido/OS — funcionava antes do F15, quando pagamento em cartão era sempre um documento só. Depois do F15, parcelas viram documentos com id `{id}_pag_2`, `{id}_pag_3` etc., que ficavam órfãos após a exclusão (nunca eram apagados), continuando visíveis em Contas a Receber e na nova tela Banco.

**Implementado em [`PedidoVendas.tsx`](../src/pages/Vendas/PedidoVendas.tsx) e [`OSList.tsx`](../src/pages/OS/OSList.tsx):** troca a exclusão por id fixo por uma busca `where('pedidoId'/'osId', '==', id)` — mesmo padrão já usado no cancelamento de venda/OS (`handleCancelarVenda`) — e apaga todos os documentos encontrados.

**Não faça:** o fluxo de "cancelar" (diferente de "excluir") continua sem tocar — ele já fazia estorno/status corretamente, nunca teve esse bug; só a exclusão definitiva (hard delete) tinha o problema.

**Pendente — validação manual:** mesma limitação de login. Falta excluir uma venda de teste parcelada e confirmar que nenhuma parcela sobra em Contas a Receber/Banco.

### F18 — Módulo Bancos: cadastro de contas bancárias, saldo e integração com a venda (feature, 2026-07-30)

**Não estava no prompt original.** Pedido direto do usuário: poder cadastrar os bancos reais que a empresa usa (ex: Itaú, Nubank, conta 2 da matriz), cada um com seu próprio saldo e conferência, integrado com PDV/Pedido de Venda/OS/Contas a Receber/Contas a Pagar — evolução do F16, que tratava "banco" como uma única conta digital implícita.

**Decisões confirmadas com o usuário antes de codar:** (1) o banco de destino é escolhido **na hora da venda** (PDV/Pedido/OS), junto com Pix/Transferência/Cartão — não só na conciliação; (2) o saldo é **automático + lançamento manual** (ajuste, tarifa, transferência entre bancos); (3) Contas a Pagar **também** escolhe banco e debita o saldo — saídas afetam o saldo bancário, não só entradas. Trabalho grande demais pra um commit só (toca ~12 arquivos); fatiado em 5 fases sequenciais, cada uma com checklist completo (1.2) antes de avançar.

**Modelo de dados novo:**
- Coleção `bancos` (catálogo por tenant): `nome`, `banco` (instituição, texto livre), `agencia`, `conta`, `tipoConta`, `saldoInicialCentavos` (só na criação), `saldoCentavos` (corrente, só mutado via `runTransaction`), `ativo`, `ordem`.
- Coleção `lancamentos_bancarios` (ledger de auditoria só pra movimentações manuais — as automáticas já têm o doc de `transacoes` como rastro): `bancoId`, `tipo` (`ajuste`/`tarifa`/`transferencia_entrada`/`transferencia_saida`/`saldo_inicial`), `direcao`, `valorCentavos`, `descricao`, `data`, `transferenciaParId` (linka o par de uma transferência).
- [`financeDomain.ts`](../src/utils/financeDomain.ts): `bancoId`/`bancoNome` novos em `PaymentDraft`/`PaymentRecord`; `paymentRequiresBankAccount(method)` (Pix/Transferência/Cartão exigem banco; Dinheiro e Boleto/Pagamento a Prazo/Outros não, porque o destino é incerto até a baixa); `validateBankTransfer` pra transferência manual entre bancos. 6 testes novos (66 no total).

**Implementado por fase:**
- **Fase A:** nova tela [`BancosList.tsx`](../src/pages/Bancos/BancosList.tsx) (`/bancos`, permissão `cadastros.bancos`) — CRUD do banco + ação "Lançamentos" por linha (histórico + novo lançamento manual + transferência entre bancos, tudo via `runTransaction`).
- **Fase B:** [`PaymentsEditor.tsx`](../src/components/finance/PaymentsEditor.tsx) (Pedido/Orçamento/OS) e o modal próprio do PDV ([`PaymentModal.tsx`](../src/pages/PDV/components/PaymentModal.tsx)) ganham o seletor "Banco de destino" pra Pix/Transferência/Cartão. `normalizePayments` valida e propaga `bancoId`/`bancoNome`. PDV/Pedido/OS creditam o saldo do banco atomicamente dentro do mesmo `runTransaction` da venda quando o pagamento já liquida na hora (Pix/Transferência); cartão fica pendente. Em OS (única tela com edição/reabertura), o crédito só acontece na primeira finalização (`!wasAlreadyFinalized`), pra não duplicar saldo reeditando uma OS já finalizada.
- **Fase C:** [`Banco.tsx`](../src/pages/Financeiro/Banco.tsx) credita o `bancoId` gravado na venda ao confirmar cartão (com fallback pra escolher o banco na hora, se for uma venda antiga sem `bancoId`); o KPI único "saldo digital do período" virou uma lista com o saldo de cada banco. [`ContasReceber.tsx`](../src/pages/Financeiro/ContasReceber.tsx): baixa de Boleto/Pagamento a Prazo/Outros (que não escolhem banco na venda) passa a pedir o banco no momento da confirmação.
- **Fase D:** [`ContasPagar.tsx`](../src/pages/Financeiro/ContasPagar.tsx): `handleConciliar` pede o banco de origem (exceto Dinheiro) e debita o saldo atomicamente; grava `valorCentavos` na baixa (pré-requisito — não dá pra debitar saldo em centavos com float).

**Não faça:** criação de despesa em Contas a Pagar continua no modelo legado em float (sem `valorCentavos` na criação, só na baixa) — não migrado; Dashboard/Faturamento/TopBar continuam sem distinguir por banco.

**Pendente — só validação manual:** mesma limitação de login de sempre. Falta: cadastrar 2 bancos, fazer uma venda Pix escolhendo um banco e confirmar que o saldo sobe na hora, fazer uma venda cartão e confirmar que só credita após conciliar em Banco.tsx, dar baixa em Contas a Receber/Pagar escolhendo banco, fazer uma transferência manual entre bancos, e confirmar que um usuário sem `cadastros.bancos` não acessa a tela.

**Implantado em 2026-07-30:** regra nova do Firestore (`bancos`/`lancamentos_bancarios`) publicada em `sistema-nexus-dev` (`firebase deploy --only firestore:rules --project sistema-nexus-dev`, deploy confirmado com sucesso).

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

**Reordenado em 2026-08-02 a pedido explícito do usuário:** a fatia de Entrada de XML do Módulo 6 (não a listagem central de notas) furou a fila pra ser feita agora, seguida do Módulo 4 (Produção) — ambos antes de 18/6(listagem)/15, que ficam pra depois. Ver "Módulo 6 — fatia Entrada de XML" logo abaixo do Módulo 18/6/15 nesta seção para o que já foi feito.

### Módulo 1 — Navegação por teclado

**Estado atual:** PDV tem F2–F7, Esc, setas e Enter ([`PDV.tsx:560`](../src/pages/PDV/PDV.tsx)). Pedido de Venda, OS e Cadastros praticamente não têm.

**Como implementar:** via F3. Um fluxo por commit — Pedido, depois OS, depois Cadastros. Padronizar os mesmos atalhos do PDV entre telas (o operador não pode ter que reaprender por tela). Documentar a tabela de atalhos e exibi-la numa ajuda acessível por `?` ou `F1`.

**Aceite:** fechar uma venda inteira sem tocar no mouse; foco nunca fica perdido após ação; Esc fecha só o modal do topo da pilha; Tab não pula campo obrigatório.

**Fatia 1/N concluída em 2026-07-29 — só Pedido de Venda:**
- [`PedidoVendaForm.tsx`](../src/pages/Vendas/PedidoVendaForm.tsx) ganhou `useKeyboardShortcuts` (de [`useKeyboardFlow.ts`](../src/hooks/useKeyboardFlow.ts), F3) — primeira tela a consumir o hook de verdade. F2 foca Cliente, F3 foca Buscar Produto, F4 foca Desc. (R$) do item sendo adicionado, F5 abre "Alterar quantidade" do item selecionado no carrinho, F6/F7 focam a seção de Pagamento. Esc não precisou de binding novo — `ProductSearchModal`/`ClientAutocomplete` já registravam no `globalEscapeStack` compartilhado.
- Decisão de mapeamento (confirmada com o usuário): como Pedido de Venda não tem modal de desconto nem de pagamento (diferente do PDV), F4/F6/F7 só **movem o foco** pro campo mais parecido, sem abrir/fechar nada — "mesma tecla, mesmo significado", não "mesma UI".
- Novo: seleção de linha na tabela "Itens da Venda" (clique destaca a linha) + `askSelectedItemQuantity`, mesmo padrão de `PDV.tsx:327-342` — permite editar quantidade de um item já adicionado sem excluir e readicionar (reaproveita `isValidSaleQuantity` e a mesma checagem de estoque de `handleAddItem`).
- Dica visual dos atalhos (`<kbd>`) na seção "Adicionar Produto", classe `.shortcuts-hint` nova em `OS.css` (compartilhada por Pedido/OS, não duplicada).
- **Escopo explicitamente não incluído nesta fatia:** PDV.tsx (mantém seu próprio bug conhecido de Esc fechando os três modais juntos — não é o padrão correto, mas está fora do escopo aqui), OSForm.tsx e Cadastros (Categorias/Unidades/Bandeiras) — ficam para sessões seguintes.
- Typecheck, lint (0 erros, mesmos ~70 warnings pré-existentes) e build passando. Suíte de testes (`run-finance-domain-tests.mjs`, 55 testes) passando — nenhum teste novo necessário, o recálculo de subtotal na edição de quantidade reaproveita a mesma fórmula já usada (e não testada isoladamente) em `handleAddItem`.

**Pendente — validação manual:** mesma limitação de login real no navegador de todos os módulos anteriores; falta testar F2-F7/Esc e o fluxo completo de fechar uma venda sem tocar no mouse.

**Fatia 2/N concluída em 2026-07-29 — OS (`OSForm.tsx`):**
- Descoberta ao ler o arquivo inteiro: OS tinha a mesma lacuna de F11/F12 — Serviço e Peça só adicionavam por clique no botão "+". Corrigido separadamente como **F13** (commit próprio, antes deste, por ser bugfix e não Módulo 1): Enter em nome/preço do Serviço e preço da Peça chama `handleAddServico`/`handleAddPeca`; foco volta pro campo de nome (`servicoNomeInputRef`/`pecaNomeInputRef`) depois de adicionar.
- Atalhos (`useKeyboardShortcuts`): F2 foca Cliente, F3 foca Peça (mais parecido com "produto" do PDV), **F8 foca Serviço** — tecla nova, sem equivalente no PDV/Pedido, porque OS tem dois fluxos de busca (Serviço e Peça) onde as outras telas só têm um. F5 foca a quantidade da última peça adicionada (sem popup — diferente do Pedido, OS já tinha `updateQuantidadePeca` com edição inline por linha, então só precisou de um ref pra última linha). F6/F7: se o status já é "Finalizada" (pagamento visível), foca o wrapper do `PaymentsEditor`; senão foca o `<select>` de Status — nunca muda o status sozinho, só ajuda a chegar no campo certo.
- **F4 (desconto) não implementado nesta tela** — OS não tem campo de desconto em lugar nenhum (nem por item, nem por OS inteira), então não existe pra onde mapear a tecla. Documentado como "sem equivalente" em vez de forçar um mapeamento artificial.
- Esc: `isServicoDropdownOpen` e `isVeiculoDropdownOpen` ganharam `useEscapeLayer` — antes nenhum dos dois respondia a Esc (só clique-fora ou clicar numa opção). Agora fecham corretamente, respeitando a pilha compartilhada com `ProductSearchModal`/`ClientAutocomplete`.
- Dica visual dos atalhos reaproveitando a classe `.shortcuts-hint` (criada na fatia 1), perto do cabeçalho "Inclusão de Peças (Estoque)".
- **Escopo não incluído:** PDV.tsx (mesma decisão da fatia 1) e Cadastros — ficam para depois do Módulo 1 completo.
- Typecheck, lint (0 erros) e build passando. Suíte de testes (55) passando — sem lógica financeira nova.

**Pendente — validação manual:** mesma limitação de login. Falta testar Enter em Serviço/Peça, F2/F3/F8/F5/F6-F7, e que Esc fecha só um painel por vez.

**Fatia 3/3 concluída em 2026-07-31 — Cadastros (Categorias, Unidades de Medida, Bandeiras de Cartão e Bancos), fechando o Módulo 1:**
- Telas de catálogo simples (lista + busca + modal/rota de criação) não têm os mesmos conceitos de Cliente/Produto/Desconto/Pagamento do PDV/Pedido/OS, então o mapeamento é mais enxuto: **F2 foca a busca**, **F6 abre "Novo(a) [item]"** (ou navega pra rota de criação, no caso de Categorias, que usa página separada em vez de modal), **Esc fecha o modal aberto** via `useEscapeLayer` — nas telas com dois modais (Bandeiras: cadastro + taxas; Bancos: cadastro + lançamentos), cada um registra sua própria camada, mas só um fica aberto por vez na prática.
- Bônus descoberto ao mexer em `CategoriasList.tsx`: a busca era só visual — o `<input>` nunca teve `value`/`onChange`, não filtrava nada. Como o atalho F2 focar um campo que não filtra seria um atalho inútil, a busca foi conectada (filtro por nome), mesmo padrão já usado nas outras 3 telas.
- Classe `.shortcuts-hint` (criada na fatia 1, em `OS.css`) reaproveitada nas 4 telas — import cross-diretório deliberado, mesmo padrão já usado por Pedido/OS, evita duplicar a definição CSS.
- Com esta fatia, **Módulo 1 (Navegação por teclado) está com todo o código pronto** — PDV (já tinha), Pedido de Venda, OS e Cadastros.
- Typecheck, lint (0 erros, 68 warnings pré-existentes) e build passando. Suíte de testes (66) passando — sem lógica financeira nova.

**Pendente — validação manual:** mesma limitação de login. Falta testar F2/F6/Esc nas 4 telas e confirmar que a busca de Categorias agora filtra de verdade.

### Módulo 19 — Numeração

**Estado atual:** `contadores/{tenantId}` já existe e é transacional para pedido, OS e orçamento ([`firestoreAtomic.ts`](../src/utils/firestoreAtomic.ts)).

**O que falta:** sequências para produção, conferência, caixa e notas. Via F5.

**Não faça:** não trocar o mecanismo existente — ele já é atômico e correto. Apenas estender o tipo.

**Concluído em 2026-07-31 — sem código novo, confirmado por leitura de código:** as sequências que faltavam não têm pra onde ir hoje. Produção e Conferência (Módulos 4/12) não têm nenhuma rota/tela implementada em `App.tsx` — não existe processo que precise de numeração própria ainda. Notas fiscais (`NFE.tsx`) usam o campo `numero` vindo do Spedy/SEFAZ (`spedyService`), não uma sequência interna — não é um caso pra `contadores/{tenantId}`. O "caixa" do PDV (`pdvHelpers.ts`/`PDV.tsx`) nem é documento do Firestore, é só uma chave de `localStorage` por sessão — não tem o que numerar. Módulo 19 fecha aqui; reabrir quando Produção/Conferência entrarem em pauta (Fase 3).

### Módulo 20 — Responsabilidade

**Estado atual:** `usuarioResponsavelId` + `createdAt` existem, mas de forma irregular; `alteradoPor` não existe.

**Como implementar:** via F5, aplicando o helper a todo documento novo, e adicionando aos existentes **sem migração retroativa** (documento antigo simplesmente não tem o campo; a UI trata ausência).

**Escopo real descoberto em 2026-07-31:** o helper (`buildDocumentMetadata`/`buildDocumentUpdateMetadata`, já existia com testes desde o F5) não era consumido em lugar nenhum do código — `grep` por escritas (`addDoc`/`updateDoc`/`transaction.set`/`transaction.update`) encontrou **30 arquivos**. Módulo bem maior do que os outros da Fase 2; fatiado por área, mesmo espírito do Módulo 1.

**Fatia 1/N concluída em 2026-07-31 — Cadastros simples (Categorias, Unidades de Medida, Bandeiras de Cartão, Bancos):**
- Todo `addDoc` novo ganhou `...buildDocumentMetadata(currentUser.uid, serverTimestamp())` **além** dos campos `createdAt`/`updatedAt` já existentes (não substituídos, para não quebrar nada que já leia esses nomes) — `criadoPor`/`criadoEm`/`alteradoPor`/`alteradoEm` são campos novos, adicionais.
- Todo `updateDoc`/`transaction.update` de edição ganhou `...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp())`, incluindo os `transaction.update` que só mexem em `saldoCentavos` (ajuste manual e as duas pontas de uma transferência em `BancosList.tsx`) — contam como alteração do documento `bancos` também.
- `BandeirasCartaoList.tsx` não desestruturava `currentUser` de `useAuth()` — adicionado.
- Onde a função ainda não tinha guarda de `currentUser` nulo antes de gravar (ex: `CategoriaForm.tsx` na edição, `CategoriasList.handleFixNames`, `BandeirasCartaoList.handleLoadDefaults`/`handleSaveFees`), adicionado `if (!currentUser) return;` no início — mesmo padrão defensivo que já existia no caminho de criação dessas telas.
- `lancamentos_bancarios` (F18) mantém seu campo `createdBy` próprio — não convertido pro padrão novo nesta fatia (são documentos imutáveis de auditoria, já carregam "quem" desde que nasceram; normalizar o nome do campo é polimento, não correção).
- Typecheck, lint (0 erros, 68 warnings pré-existentes) e build passando. Suíte de testes (66) passando — `buildDocumentMetadata`/`buildDocumentUpdateMetadata` já tinham testes próprios desde o F5, nenhum novo necessário (são só consumidos, não mudou a lógica pura).

**Pendente — validação manual:** mesma limitação de login. Falta criar/editar um item em cada uma das 4 telas e conferir no Firestore que `criadoPor`/`alteradoPor` aparecem corretamente.

**Fatia 2/N concluída em 2026-07-31 — Vendas/PDV/OS/Orçamentos (`PedidoVendaForm.tsx`, `OSForm.tsx`, `PDV.tsx`, `OrcamentoForm.tsx`, `DevolucoesVenda.tsx`):**
- Mesmo princípio da fatia 1, mas em fluxos com `runTransaction`: toda leitura já acontece antes de qualquer escrita (regra 1.4), então os metadados só entraram nos objetos já escritos — nenhuma leitura nova precisou ser adicionada.
- Cobertos: criação de venda/OS/orçamento, criação inline de cliente/serviço/peça a partir da tela (cadastro rápido), crédito de banco (Pix/Transferência/Cartão, do F18), emissão/consulta de NF-e via Spedy, e os quatro fluxos de cancelamento/estorno (venda, OS, reabertura de orçamento vinculado) e devolução de venda (crédito de cliente ou caixa).
- `OrcamentoForm.tsx`: `handleConvertToOS`/`handleConvertToVenda` não tinham guarda de `currentUser` nulo (só verificavam `tenantId`, com `currentUser?.uid || ''` tolerando vazio) — adicionado `if (!currentUser) throw ...`, já que um `criadoPor` vazio não serve pra nada.
- Sites com `set`/`merge` condicional pra criar-ou-atualizar (ex: pagamento de OS reaberta) recebem `buildDocumentMetadata` ou `buildDocumentUpdateMetadata` dependendo se o documento já existia, mesma lógica condicional que já existia ali pra `createdAt`/`updatedAt`.
- Typecheck, lint (0 erros, 68 warnings pré-existentes) e build passando. Suíte de testes (66) passando.

**Fatia 3/N concluída em 2026-07-31 — Financeiro (`Banco.tsx`, `Caixa.tsx`, `ContasPagar.tsx`, `ContasReceber.tsx`):**
- Cobertos: conciliação de cartão e crédito de banco (Banco.tsx), lançamento manual e estorno no Fluxo de Caixa (Caixa.tsx), baixa e criação de despesa (ContasPagar.tsx), confirmação de recebimento — incluindo o fluxo de abatimento com crédito de devolução do cliente, o mais complexo do módulo — em ContasReceber.tsx.
- Várias funções não tinham guarda de `currentUser` nulo (só checavam `tenantId`/estado do modal): `Banco.confirmarRecebimentoCartao`, `Caixa.handleEstornar`, `ContasPagar.handleConciliar`, `ContasReceber.confirmarRecebimento` — adicionada em todas, mesmo raciocínio das fatias anteriores.
- Typecheck, lint (0 erros, 68 warnings pré-existentes) e build passando. Suíte de testes (66) passando.

**Fatia 4/N concluída em 2026-07-31 — Cadastros com formulário próprio** (Clientes, Veículos, Estoque/Produtos, Serviços, Usuários):
- Mesmo padrão das fatias 1-3, aplicado a `ClienteForm.tsx`/`ClientesList.tsx`, `VeiculoForm.tsx`, `EstoqueForm.tsx`/`EstoqueList.tsx`, `ServicoForm.tsx`/`ServicosList.tsx` e `UsuarioForm.tsx`.
- Praticamente todo `handleSave` de criação/edição nessas telas não tinha nenhuma guarda de `currentUser` nulo (`ClienteForm`, `VeiculoForm`, `EstoqueForm` na edição, `ServicoForm` na edição) — adicionada em todas, mesmo padrão das fatias anteriores.
- `UsuarioForm.tsx` é o caso mais particular: criação de funcionário já gravava um campo próprio `createdBy` (não o padrão do F5) — mantido como está e os campos novos (`criadoPor`/`criadoEm`/`alteradoPor`/`alteradoEm`) adicionados ao lado, sem remover nada. O doc de índice `usernames/{usernameFinal}` (só email+tenantId, usado pelo Login pra descobrir o email a partir do usuário) ficou de fora — não é um documento de negócio, não faz sentido rastrear "responsabilidade" nele.
- Typecheck, lint (0 erros, **66** warnings — 2 a menos que antes: `VeiculoForm`/outros tinham `currentUser` importado e nunca usado, warning some sozinho ao consumir o valor) e build passando. Suíte de testes (66) passando.

**Fatia 5/5 concluída em 2026-07-31 — Fiscal/Admin/Auth, fechando o Módulo 20 por completo:**
- `NFE.tsx`: emissão/retransmissão de nota e cancelamento (com justificativa) ganharam metadados. **Decisão deliberada:** as duas rotinas de sincronização de status com a Spedy (`syncPendingInvoices`, usada tanto no polling automático quanto no botão de sincronizar manualmente, e `handleManualSyncSingle`) **não** ganharam `alteradoPor` — elas só espelham o status vindo da SEFAZ/Spedy, e a mesma função roda tanto sozinha (sem ação do usuário) quanto por clique; gravar `currentUser.uid` nesse caso atribuiria uma mudança automática a quem só estava com a tela aberta, informação enganosa.
- `EntradaNFE.tsx`: importação de XML (atualização/criação de peças no estoque + lançamento da conta a pagar) ganhou metadados.
- `SuperAdmin.tsx`: painel cross-tenant do NexarAdmin — não desestruturava `currentUser` de `useAuth()` (só `userRole`), adicionado. Edição de mensalidade/nome da empresa/limite de usuários (grava em `usuarios` e `configuracoes` do tenant-alvo) e o aviso global (`system_alerts/global`, tratado como criação a cada publicação já que é sempre um `setDoc` sem merge) ganharam metadados.
- `Configuracoes.tsx`: salvar configurações gerais (público + `configuracoes_privadas`), salvar permissões/regras de comissão de um funcionário e salvar módulos bloqueados do tenant — nenhuma das duas últimas tinha guarda de `currentUser` nulo, adicionada.
- `PerfilModal.tsx`: edição do próprio nome (dono edita `configuracoes.nomeUsuario`, funcionário edita `usuarios.nome`) ganhou metadados.
- **Decisão deliberada — fora de escopo:** `AuthContext.tsx` (heartbeat de sessão a cada 30s + fechamento de sessão no logout) e o `updateDoc` de `Login.tsx` (registro da sessão ativa no login) **não** ganharam metadados de responsabilidade — são telemetria de sistema (o próprio usuário atualizando o rastro da sua sessão), não edição de um documento de negócio por um terceiro; aplicar `alteradoPor` ali só adicionaria ruído (o mesmo uid do dono do documento, a cada 30 segundos).
- Typecheck, lint (0 erros, 66 warnings pré-existentes) e build passando. Suíte de testes (66) passando.

**Módulo 20 (Responsabilidade) está com todo o código pronto**, cobrindo as 5 fatias (Cadastros simples, Vendas/PDV/OS/Orçamentos, Financeiro, Cadastros com form próprio, Fiscal/Admin/Auth) — só falta validação manual (mesma limitação de login de sempre).

### F19 — Sistema de Abas: múltiplas telas abertas ao mesmo tempo (feature, 2026-07-31)

**Não estava no prompt original.** Pedido direto do usuário, com mockup: barra horizontal de abas abaixo do topbar (estilo navegador), permitindo ter Dashboard/Clientes/Pedidos/OS/Produtos etc. abertos ao mesmo tempo, cada aba fechável com "x".

**Decisões confirmadas com o usuário antes de planejar:** (1) trocar de aba **preserva o estado de verdade** (carrinho, formulário em andamento, rolagem) — não é só um atalho visual que recarrega a tela; (2) o **PDV fica fora do sistema de abas** — continua tela cheia, sem menu lateral/barra de abas, como já é hoje; (3) **uma aba por registro aberto** — editar Cliente A e Cliente B ao mesmo tempo são duas abas distintas, não uma aba "Clientes" só.

Trabalho fatiado (mudança estrutural na arquitetura de rotas do app inteiro, React Router 7):

**Fase A concluída em 2026-07-31 — fundação visual (abas "leves"):**
- Novo `TabsContext` (`src/contexts/TabsContext.tsx`): observa `useLocation()` e garante automaticamente uma aba pra URL atual sempre que ela muda — por clique no menu, redirecionamento interno após salvar, F5 ou digitar a URL direto. Não precisou instrumentar nenhum `navigate()` existente no app (dezenas de call sites) pra registrar abas; a detecção é passiva, via efeito no path. `resolveTabLabel` deriva o rótulo por prefixo de rota (tabela `SECTION_LABELS`), com fallback pro último segmento da URL formatado.
- Persistência em `localStorage` (`nexus_tabs_v1`), restaurada ao recarregar a página; limpa no `logout()` de `AuthContext.tsx`.
- Limite de segurança de **8 abas simultâneas** — a 9ª mostra aviso pedindo pra fechar alguma antes.
- Novo `<TabBar/>` (`src/components/layout/TabBar.tsx`) entre `TopBar` e `page-content` em `AppLayout.tsx`, dentro de um `<TabsProvider>` que já envolve a área de conteúdo inteira (preparado pra Fase B, que vai passar a renderizar uma aba por `MemoryRouter` isolado ali dentro). CSS novo em `Layout.css` (`.tab-bar` e variantes), reaproveitando as mesmas variáveis do topbar (`--bg-secondary`, `--border-color`, `color-mix` com `--bg-primary`).
- **Ainda não preserva estado** — trocar de aba hoje faz um `navigate()` de verdade (o `<Outlet/>` único de sempre desmonta/remonta a tela). Isso é só a fundação visual, validável cedo; a preservação de verdade (decisão #1) é a Fase B.
- Typecheck, lint (0 erros, 66 warnings pré-existentes) e build passando. Suíte de testes (66) passando — sem lógica financeira nova, sem testes novos necessários.

**Pendente — validação manual:** mesma limitação de login. Falta abrir várias telas pelo menu, conferir que a barra de abas aparece e reflete a navegação, fechar/reabrir abas, e que a lista sobrevive a um F5.

**Complemento pedido pelo usuário em 2026-07-31, ainda na Fase A: reordenar abas arrastando com o mouse.** `reorderTab(draggedId, targetId)` novo no `TabsContext` (tira a aba arrastada da posição atual e reinsere na posição da aba alvo); `TabBar.tsx` usa a API nativa de drag-and-drop do HTML5 (`draggable` + `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`, sem biblioteca nova), com feedback visual (`.dragging` esmaece a aba sendo arrastada, `.drag-over` destaca a aba alvo). Checklist completo passando.

**Fase B concluída em 2026-07-31 — isolamento de verdade (cada aba com seu próprio `MemoryRouter`, sempre montada):**
- `src/routes/appRoutesConfig.tsx` (novo): a lista de ~50 rotas que antes vivia aninhada em `App.tsx` sob `<Route path="/" element={<AppLayout/>}>` virou um `RouteObject[]` (formato de dados, não JSX) — necessário porque `<Routes>`/`useRoutes()` só conseguem casar contra uma localização diferente da real do navegador através desse formato (a alternativa de reaproveitar a mesma árvore JSX entre múltiplos `<Routes>` não é suportada pelo react-router).
- `src/components/layout/TabPane.tsx` (novo): cada aba = um `<MemoryRouter initialEntries={[tab.path]}>` próprio + `useRoutes(appRoutesConfig)` dentro, com `Suspense` local (pra abrir uma aba nova com uma tela ainda não carregada não "piscar" o conteúdo das outras abas, que ficariam presas ao mesmo Suspense de `App.tsx` senão). Escondida via `display:none` no `div` que envolve o `MemoryRouter` — nunca desmontada ao trocar de aba, só ao fechar de verdade.
- `src/utils/routeAccess.ts` (novo): a lógica de bloqueio por módulo/permissão que antes vivia direto em `AppLayout.tsx` (calculada a partir da URL real) virou uma função pura `resolveRouteAccess(pathname)`, porque agora cada aba calcula isso a partir da **sua própria** localização interna, não da URL do navegador.
- `AppLayout.tsx`: perdeu o `<Outlet/>` único e toda a lógica de bloqueio (foram pra `TabPane`); ganhou `<TabPanesArea/>` (mapeia uma `TabPane` por aba aberta) dentro do `<TabsProvider>`, que agora envolve também o `<Sidebar/>` (não só a área de conteúdo).
- **Mudança de identidade da aba:** o `id` da aba deixou de ser igual ao path (que ela pode "andar" internamente, ex: da lista de Clientes pra Editar Cliente sem trocar de aba) e virou um identificador sintético estável; `path`/`label` acompanham a navegação interna via `updateTabLocation()`, chamado pelo próprio `TabPane` sempre que a localização do seu `MemoryRouter` muda.
- **`Sidebar.tsx` e `TopBar.tsx` precisaram mudar** (não previsto originalmente como "sem tocar no Sidebar" da fase A): como a navegação de verdade agora acontece **dentro** do `MemoryRouter` de cada aba, um clique no menu não pode mais chamar `navigate()` do router real (isso só mudaria a URL visível sem trocar o conteúdo de nenhuma aba). Todo lugar que navegava passou a chamar `openTab()`/`activateTab()` do `TabsContext` — com uma exceção: o link do **PDV continua com `navigate()` de verdade**, porque é a única tela que sai do sistema de abas por completo. O destaque do item ativo no menu também parou de usar `useLocation()` (que fica "congelada" pra abas em segundo plano) e passou a comparar contra o path da aba ativa.
- **Atalhos de teclado e Esc ganharam proteção contra abas escondidas:** como as telas em segundo plano continuam montadas (não desmontadas), sem essa proteção os atalhos F2-F8 (Módulo 1) e o Esc de um modal aberto numa aba escondida disparariam junto com os da aba visível. Novo `TabActiveContext` (em `TabsContext.tsx`) é lido internamente por `useKeyboardShortcuts`/`useEscapeLayer` (`useKeyboardFlow.ts`) — nenhuma tela precisou ser alterada individualmente, a proteção entrou centralizada nos dois hooks compartilhados.
- **Custo real de Firestore, como avisado antes de aprovar o plano:** a partir de agora, cada aba aberta mantém suas próprias escutas `onSnapshot` rodando em segundo plano — abrir várias abas literalmente multiplica as leituras em tempo real. O limite de 8 abas (Fase A) é a única proteção hoje.
- Typecheck, lint (0 erros, 66 warnings pré-existentes) e build passando. Suíte de testes (66) passando — sem lógica financeira nova.

**Pendente — validação manual, mais crítica que o normal nesta fase:** mesma limitação de login de sempre, mas aqui é essencial testar de verdade antes de confiar na feature: abrir Cliente A e Cliente B em duas abas, editar campos em ambas sem salvar, trocar entre elas repetidamente e confirmar que nenhum formulário perde o que foi digitado; confirmar que fechar uma aba realmente para as escutas do Firestore dela (sem leituras remanescentes, checar no painel de rede); confirmar que o PDV continua tela cheia sem barra de abas; testar F2-F8 e Esc com duas abas abertas ao mesmo tempo (uma delas com um modal aberto) pra confirmar que não vazam entre abas; confirmar que passar de 8 abas mostra o aviso; confirmar que F5 recarrega a aba ativa corretamente.

**Bugfix crítico em 2026-07-31 — a Fase B derrubava o app inteiro (achado na primeira validação manual real do usuário):** cada aba tinha seu próprio `<MemoryRouter>` dentro do `<BrowserRouter>` de `App.tsx` — react-router proíbe Router aninhado ("You cannot render a `<Router>` inside another `<Router>`") e lançava esse erro ao renderizar **qualquer** aba, capturado pelo único `ErrorBoundary` global e derrubando o app inteiro pra tela genérica de erro. Não era intermitente: 100% reprodutível, só não tinha aparecido antes porque nenhuma sessão anterior tinha conseguido de fato logar e clicar.

Corrigido em `TabPane.tsx`: todas as abas voltaram a compartilhar o único router do App (não dá pra ter Router aninhado, ponto). O que continua diferenciando cada aba é **contra qual location o `useRoutes()` resolve**: a aba ativa resolve contra a location real do navegador (sem override — `navigate()`/`Link` das telas continuam funcionando normal, porque agora *são* o router de verdade), e as abas em segundo plano resolvem contra o último `tab.path` conhecido, congelado (`useRoutes(appRoutesConfig, tab.path)`, decoupled da location real que pertence só à aba ativa). Um efeito espelha a location real → `tab.path` sempre que a aba ativa navega; outro efeito reaplica o `tab.path` salvo na location real (`navigate(tab.path, {replace:true})`) no momento em que uma aba vira ativa, pra ela assumir o timão sem herdar a location que a aba anterior deixou.

**Bônus corrigido na mesma leva:** cada `TabPane` ganhou seu próprio `ErrorBoundary` (antes só existia o de `App.tsx`) — sem isso, mesmo depois de corrigir o Router aninhado, um crash futuro em qualquer tela (mesmo numa aba em segundo plano que o usuário nem está olhando) continuaria derrubando todas as abas juntas, contradizendo a própria promessa de isolamento da Fase B.

Typecheck, lint (0 erros, mesmos 66 warnings pré-existentes) e build passando. Publicado em `dev` (commit `a67f080`). **Validação manual dos itens do parágrafo acima continua pendente** — este bugfix não elimina a necessidade, só corrige o que já estava demonstravelmente quebrado.

**Segundo bugfix em 2026-08-02 — editar/cadastrar não abria aba nova (achado pelo usuário testando de verdade pela primeira vez, já com o Router corrigido):** não era regressão do fix acima, era lacuna pré-existente da própria Fase B. A decisão #3 ("uma aba por registro aberto") só tinha sido conectada no menu lateral/TopBar (`openTab()`); todo botão "Editar"/"Novo" dentro das telas de lista continuava com `useNavigate()` puro, herdado de antes do sistema de abas existir — nunca tinha sido exercitado de verdade porque o app travava em qualquer clique antes do fix do Router aninhado. Corrigido (commit `08a7931`): convertidos pra `openTab()` os botões Novo/Editar de Clientes, Veículos, Estoque, Serviços, Categorias, Usuários, OS e Orçamentos, Novo/Visualizar de Pedido de Venda, "Ver detalhes" de veículo/OS no Dashboard e "Cadastrar cliente" na Agenda. **Deliberadamente fora do escopo:** fluxos de impressão (`print`, `print-lote`) e o "converter Orçamento em OS/Venda" continuam com `navigate()` normal — são transições de "salvar e seguir", não abertura de um novo registro de trabalho. Typecheck/lint/build passando limpos. A "piscada" que o usuário relatou ao clicar em algum ponto do fluxo de login ainda não foi diagnosticada — hipótese mais provável é hot-reload do Vite recarregando a página inteira pra aplicar a mudança estrutural do primeiro fix (efeito colateral de sessão, não bug de produção); a confirmar num teste novo com F5 forçado antes de logar.

**Piscada diagnosticada e corrigida em 2026-08-03** (commit `8ce4fd2`) — não era hot-reload, era um bug real de CSS: a hipótese antiga estava errada. O usuário abriu o app no navegador interno da Claude e logou (login continua sendo ação exclusiva do usuário — Claude nunca digita credenciais, mesmo autorizada); com a sessão ativa, a Claude conseguiu inspecionar console/DOM ao vivo pela primeira vez nesse projeto. Causa raiz: abas escondidas usam `display:none` (F19), e **o navegador reinicia qualquer `animation` CSS sempre que um elemento volta de `display:none` pra visível** — isso reaplicava o fade-in+scale de 0.35s de `.page-transition` (`TabPane.tsx`) toda vez que o usuário voltava pra uma aba já aberta, não só na primeira vez que ela era criada. Confirmado com um listener de `animationstart` anexado ao vivo via `javascript_tool`: zero disparos ao trocar entre abas já existentes antes do fix, exatamente um disparo ao abrir uma aba nova (comportamento correto) depois dele. Corrigido com uma classe "settled" aplicada 400ms depois do primeiro mount que zera a animação — a entrada da aba nova continua intacta, só não repete mais em trocas seguintes. **Complemento:** durante a investigação, também apareceu um aviso de medição do Recharts (`width(-1) height(-1)`) ao voltar pra abas com gráfico (Dashboard) — criado `useChartRemountKey` (novo hook em `src/hooks/`) pra forçar o `ResponsiveContainer` a remontar quando a aba vira ativa, aplicado em `Dashboard.tsx`, `RelatoriosMecanica.tsx`, `RelatorioProducao.tsx` e `SuperAdmin.tsx`; não elimina sozinho o aviso (ficou registrado como ruído de dev tools, não confirmado como visível pro usuário), mas é uma melhoria correta por si só. Typecheck/lint/build/66 testes passando; **validado ao vivo no navegador** (não só pelos checks automáticos) — primeira vez nesta sessão que isso foi possível.

**Segunda causa achada e corrigida em 2026-08-03** (commit `430dfe7`) — o usuário testou o fix acima e a piscada continuava, agora descrita com mais precisão: "os dados de uma tela fica na outra". Bug diferente e mais sério que o do CSS: no exato render em que uma aba vira ativa, `TabPaneContent` já passava a resolver `useRoutes()` contra a location REAL do navegador (`isActive ? undefined : tab.path`) — mas essa location ainda pertencia à aba anterior, porque o `navigate({replace:true})` que a corrige só roda depois, num `useEffect` (que só executa após o commit). Por um frame, a aba recém-ativada renderizava o **conteúdo da aba anterior** por cima de si mesma, antes do efeito corrigir. Corrigido detectando esse frame de transição (via `useState` ajustado durante a própria renderização — não `useRef`+`useEffect`, que o lint `react-hooks/refs` do React 19 rejeita, e que de qualquer forma chegaria um frame tarde demais) e usando o `tab.path` congelado, já correto, só nesse frame de transição. Typecheck/lint/build/66 testes passando. **Não foi possível capturar automaticamente o flash de 1 frame** (o roundtrip das ferramentas de browser da Claude é mais lento que isso) — a causa foi confirmada lendo o código exato, não por reprodução visual automatizada; pedido ao usuário validar de novo.

**Terceira rodada em 2026-08-03** (commit `09a6b2e`) — o usuário testou de novo e continuava ruim ("muito ruim", "não tá fluido"). Desta vez a Claude anexou um `PerformanceObserver` de `longtask` ao vivo no navegador (com o usuário logado) em vez de só inspecionar visualmente. Achados reais:
1. **`Dashboard.tsx` tinha um relógio (`setInterval` 1s) sem guarda de aba ativa** — como o F19 mantém toda aba montada mesmo escondida, esse relógio re-renderizava o Dashboard inteiro (5 gráficos Recharts, tabela de OS, todos os cálculos de estatística) uma vez por segundo, pra sempre, mesmo com o usuário em outra aba. Corrigido: o intervalo só roda enquanto a aba do Dashboard estiver de fato ativa (`TabActiveContext`).
2. **Revertido o `useChartRemountKey`** do fix anterior (commit `8ce4fd2`) — media um pico de até 333ms ao ativar aba com gráficos, sem eliminar de fato o aviso de console que motivou a mudança. Benefício cosmético, custo real medido — não valia a pena.
3. **`TabPane` ganhou `React.memo`** — sem isso, toda troca de aba re-renderizava TODAS as abas abertas, não só as duas envolvidas na troca.

**Achado importante que NÃO é bug, e escala com uso normal:** com 1 aba aberta, zero `longtask` em 8s parado. Com 3 abas abertas (Dashboard + Orçamentos + Pedidos de Venda), `longtask`s de 50-330ms contínuos a cada 1-2s **mesmo parado, sem clicar em nada**. É custo cumulativo das escutas `onSnapshot` do Firestore + re-render de páginas pesadas rodando em segundo plano em várias abas ao mesmo tempo — já documentado nesta mesma seção como tradeoff aceito conscientemente do F19 ("mais abas = mais leituras simultâneas"), não um defeito pontual corrigível com patch. **Decisão pendente do usuário:** vale investir numa fatia maior (abas inativas pularem o re-render caro da página, não só ficarem visualmente escondidas — hoje só o `display:none` é "grátis", o React continua fazendo todo o trabalho de renderização por trás)? Typecheck/lint/build/66 testes passando.

**Quarta rodada em 2026-08-03 — usuário mandou vídeo, e a investigação mudou de direção completamente** (commit `a4f355e`, revert). O usuário confirmou que o vídeo foi gravado na mesma aba do navegador que a Claude controla, e descreveu o problema como "o conteúdo pula/troca de forma abrupta" (não piscada, não travamento de resposta). Investigação ao vivo, com logs de ciclo de vida (`useEffect` de mount/unmount) anexados diretamente nos componentes:

1. **Confirmado com um teste simples e repetível:** digitar texto num campo de busca (ex: Orçamentos), trocar de aba e voltar → **o texto digitado desaparece**. Isso quebra a promessa central do F19 ("trocar de aba preserva estado de verdade") e explica o "abrupto" muito melhor que qualquer teoria de animação — o campo de busca literalmente reseta a cada troca.
2. **Tentativas de correção pioraram a situação:** primeiro tentei sempre resolver `useRoutes()` contra `tab.path` (nunca a location ao vivo) — não resolveu a perda de estado. Depois tentei memoizar o objeto de location passado pro `useRoutes` com uma `key` estável — **isso causou um LOOP CONTÍNUO de mount/desmontagem** do componente da página (confirmado com log de ciclo de vida: dezenas de MOUNTED/UNMOUNTED em sequência, sem eu clicar em nada). Essa é provavelmente a causa real por trás do "muito ruim"/"sem fluidez" relatado antes — não uma questão visual, um loop de verdade consumindo CPU.
3. **Revertido tudo pro estado do commit `8ce4fd2`** (só a correção da animação CSS, sem a lógica de "justActivated" dos commits `430dfe7`/`09a6b2e`). Confirmado ao vivo que essa versão **não tem o loop** (longtasks voltam ao padrão de fundo normal, sem ciclo contínuo).
4. **Achado crítico: o teste de perder o texto digitado falha IGUALMENTE nessa versão revertida, mais simples.** Ou seja, **a perda de estado ao trocar de aba não é uma regressão de hoje — é um bug pré-existente desde a Fase B do F19** (`useRoutes(appRoutesConfig, locationArg)` não preserva a identidade do componente de forma confiável ao alternar `isActive` entre `true`/`false`, mesmo quando o pathname resultante é o mesmo). Nunca tinha sido pego porque nenhuma sessão anterior conseguiu de fato logar e testar digitando algo antes de trocar de aba.

> **RESOLVIDO em 2026-08-04 (commit `6d3a93b`) — ver "Sexta rodada" no fim desta seção.** A pendência crítica descrita abaixo era real e foi corrigida na raiz, com validação ao vivo. O texto original fica preservado como registro da investigação.

**PENDÊNCIA CRÍTICA PRA PRÓXIMA SESSÃO — não resolvida:** o sistema de abas hoje NÃO preserva estado local de formulário/busca ao trocar de aba, contradizendo a decisão #1 combinada com o usuário antes de construir o F19 ("trocar de aba preserva estado de verdade, não só recarrega"). Isso é sério — pode incluir perda de dados digitados em formulários (Pedido, OS, Orçamento), não só busca. Merece uma sessão dedicada, com tempo pra investigar a fundo o mecanismo do `useRoutes` compartilhado (talvez a solução correta seja voltar a usar Router isolado por aba de alguma forma que não esbarre na proibição de Router aninhado — por exemplo, um Router por aba fora da árvore do BrowserRouter principal, renderizado via portal, ou reavaliar a arquitetura de isolamento por completo) em vez de mais tentativas rápidas de patch. **Antes de mexer de novo:** reproduzir o teste simples primeiro (abrir uma aba, digitar em qualquer campo de texto, trocar de aba, voltar, ver se o texto sumiu) pra confirmar se ainda falha antes de tentar qualquer fix novo.

**Quinta rodada em 2026-08-03 — foco em fluidez a pedido do usuário, mais um beco sem saída documentado** (commit `3df0200`). Retomando de onde a quarta rodada parou:

1. **Achado incidental: o revert `a4f355e` tinha jogado fora o `React.memo(TabPane)` do commit `09a6b2e` sem querer**, junto com a lógica problemática do "justActivated" — os dois viviam no mesmo arquivo, e o revert reescreveu o arquivo inteiro de volta pro estado anterior a ambas as mudanças. O `React.memo` nunca tinha sido a causa do loop (só o "justActivated" era); reposto sozinho.

2. **Tentativa de corrigir o custo real do Recharts (~300ms medido por troca pro Dashboard, confirmado de novo com `PerformanceObserver`):** trocar `display:none` (que zera o layout da aba escondida, forçando o `ResponsiveContainer` a remedir do zero toda vez que a aba volta a ficar visível) por `visibility:hidden` + `position:absolute; inset:0` dentro de um container `position:relative` — ideia sendo cada aba ocupar sempre o mesmo retângulo real, ativa ou não, pro Recharts nunca precisar remedir.

3. **A ideia pareceu funcionar visualmente, mas expôs um bug muito pior: um LOOP CONTÍNUO de mount/desmontagem do Dashboard**, confirmado com log de ciclo de vida ao vivo (`useEffect` de mount/unmount) e com um log de render por aba (`tabId`/`isActive`/`location.pathname` a cada render). Testado e descartado sistematicamente:
   - Removido o `React.memo` do teste pra isolar a variável — **o loop continuou idêntico**, então a causa é a troca de CSS, não o memo.
   - `read_console_messages({onlyErrors:true})` não mostrou nenhum erro real, e o `ErrorBoundary` do projeto (`src/components/ErrorBoundary.tsx`) não tem nenhum mecanismo de auto-retry — descarta a teoria de "Recharts lança exceção com `-1x-1`, ErrorBoundary captura e re-tenta".
   - O mecanismo exato não foi identificado com certeza (aponta pra alguma interação entre as múltiplas chamadas paralelas de `useRoutes()` — uma por aba — competindo pelo mesmo `BrowserRouter`, que só fica instável quando todas as abas passam a ter layout real simultaneamente em vez de `display:none` numa das duas), mas o sintoma é claro e reproduzível: qualquer forma de manter as abas escondidas com layout "vivo" (em vez de removido via `display:none`) desestabiliza a resolução de rota compartilhada.
   - **Revertido de volta pra `display:none`.** Ficou só o `React.memo` (item 1), que é seguro e independente desse problema.

4. **Conclusão importante pra próxima sessão:** essa é a SEGUNDA tentativa (depois do "justActivated" da quarta rodada) de resolver um sintoma do F19 com uma mudança pontual que acaba desestabilizando a resolução de rota compartilhada entre abas. Reforça a suspeita já registrada acima — o mecanismo de múltiplos `useRoutes()` paralelos contra um único `BrowserRouter` é frágil por natureza, não só num ponto específico. **A perda de estado ao trocar de aba (pendência crítica acima) e o custo de ~300ms do Recharts no Dashboard são provavelmente sintomas do MESMO problema de fundo**, não dois bugs separados — ambos só se manifestam quando uma aba estava "congelada" (via `tab.path` fixo) e precisa assumir a location real de novo. Isso reforça, mais do que nunca, que a solução certa é uma sessão dedicada reavaliando a arquitetura de isolamento por completo (ex: Router por aba fora da árvore principal via portal), não mais tentativas pontuais — já são duas tentativas de patch que pioraram a situação em vez de melhorar.

Typecheck, lint, build e suíte de 66 testes passando. Publicado em `dev` (commit `3df0200`).

**Sexta rodada em 2026-08-04 — RESOLVIDO NA RAIZ, com validação ao vivo** (commits `d4cbc93` e `6d3a93b`). O usuário pediu pra focar na fluidez da troca de abas; a investigação acabou encontrando a causa raiz que explicava TUDO — fluidez, perda de estado e o "flash" de conteúdo trocado eram **um bug só**, não três.

**As duas causas, encontradas lendo o código-fonte do react-router v7** (não por tentativa e erro — a diferença decisiva em relação às cinco rodadas anteriores):

1. **`useRoutes()` só embrulha o resultado num `<LocationContext.Provider>` QUANDO recebe um `locationArg`**; sem ele, devolve a árvore crua:
   ```js
   if (locationArg && renderedMatches) {
     return <LocationContext.Provider ...>{renderedMatches}</LocationContext.Provider>;
   }
   return renderedMatches;
   ```
   O `TabPane` chamava `useRoutes(appRoutesConfig, isActive ? undefined : tab.path)` — ou seja, esse wrapper **aparecia e sumia do topo da árvore a cada troca de aba**. O React vê um tipo de elemento diferente naquela posição e desmonta/remonta a subárvore inteira em vez de reconciliar.

2. **Mais grave e mais sutil: o `<BrowserRouter>` do react-router v7 aplica TODA mudança de URL dentro de um `React.startTransition`** (confirmado no fonte: `React.startTransition(() => setStateImpl(newState))`). Transições têm prioridade baixa, então o React renderiza primeiro a mudança urgente (qual aba está ativa) e **só depois**, numa renderização separada, a URL nova. Consequência: no exato render em que uma aba vira ativa, a URL real **ainda é a da aba anterior** — e a aba recém-ativada, por resolver a rota contra a URL real, renderizava a tela da OUTRA aba, destruindo a sua própria. Confirmado ao vivo com log de ciclo de vida: **dois `OSForm` montados ao mesmo tempo** (dois `UNMOUNT` seguidos sem `MOUNT` no meio — só possível com duas instâncias vivas).

**Tentativa descartada no caminho (registrada porque parece óbvia e não funciona):** tornar a ativação atômica, chamando `navigate()` junto do `setState` no próprio handler do clique (o React agrupa os dois numa renderização só). **Não resolveu** — o `startTransition` do BrowserRouter separa as renderizações de qualquer jeito. Medido ao vivo: o log mostrava `activateTab -> navigate(/dashboard) | urlAtual=/os/nova` e, 147ms depois, um `OSForm MOUNT` na aba do Dashboard. Revertido; não sobrou nada dessa tentativa no código.

**Correção final (commit `6d3a93b`, uma linha de lógica + os efeitos):** `useRoutes(appRoutesConfig, tab.path)` para **toda** aba, ativa ou não. O `tab.path` passa a ser a única verdade pra renderizar, e a URL real vira só espelho (barra de endereço, F5, deep-link). Com isso o `locationArg` nunca deixa de existir nem muda ao trocar de aba — resolve (1) — e a renderização deixa de depender do timing da URL — resolve (2).

Os dois efeitos que sincronizavam URL ↔ `tab.path` viraram **um só**, com um `syncedRef` pra desempatar quem manda quando eles divergem — porque "URL ≠ tab.path" tem duas causas opostas: ou a aba acabou de virar ativa (a URL está atrasada, `tab.path` manda), ou a própria tela chamou `navigate()` (a URL é a novidade, ela manda). Sem esse desempate os dois lados se sobrescrevem — era essa ambiguidade que fazia as tentativas anteriores virarem loop. O `tab.path` agora guarda também a query string, senão as telas de impressão em lote (`?ids=...`) perderiam os parâmetros.

**Validação ao vivo (com o usuário logado, no navegador interno):**
- Preencher 3 campos de uma OS nova → passar por 3 outras abas → voltar: **os 3 campos continuam preenchidos**, e o log de ciclo de vida do `OSForm` registra **zero** mount/unmount na troca (antes registrava vários).
- Mesmo teste no campo de busca da lista de OS: texto e filtro sobrevivem.
- Sem regressão: navegação dentro da aba (botão voltar do formulário leva à lista, e o rótulo da aba acompanha), abrir registro em nova aba pelo "Editar" da lista, zero erros no console.
- `longtask`s na troca caíram de picos de ~300-330ms pra ~230ms — como não há mais remontagem da página inteira. O custo residual é o das escutas `onSnapshot` em várias abas, já documentado como tradeoff aceito.

**Complemento (commit `d4cbc93`, feito antes na mesma sessão):** o revert `a4f355e` tinha jogado fora sem querer o `React.memo(TabPane)` (otimização válida, do commit `09a6b2e`) junto com a lógica problemática do "justActivated" — as duas viviam no mesmo arquivo. Reposto sozinho.

**Sexta rodada em 2026-08-04 — popup de limite de abas + aviso ao fechar aba com dados não salvos, a pedido direto do usuário:**

- **Popup de limite de abas** (commit `3a5dc3f`): antes só o botão "+" (removido nesta mesma rodada, considerado inútil pelo usuário — só abria o Dashboard, redundante com o menu) avisava do limite de 8 abas; todo outro jeito de abrir uma tela (menu lateral, "Editar"/"Novo" em qualquer lista) fazia um no-op silencioso no `openTab()` do `TabsContext`, parecendo travamento. Aviso movido pra dentro do próprio `openTab`, lendo um `ref` que espelha `tabs` (evita trocar a identidade estável da função, que é `useCallback` com deps `[]`). Validado ao vivo: 8 abas abertas, clique num atalho do menu → popup "Limite de abas atingido" apareceu, sem aba fantasma.
- **Confirmar antes de fechar aba com dados não salvos** (commit `afeb08f`): escopo confirmado com o usuário — só Pedido de Venda, OS, Matéria-Prima e Ordem de Produção por enquanto (não every tela). Infra nova: `TabIdContext` (provido por `TabPane.tsx`, mesmo ponto do `TabActiveContext` já existente), registro de "abas sujas" (`ref`, não state, pra não re-renderizar a cada tecla) e `requestCloseTab()` no `TabsContext`, que a `TabBar` passa a chamar em vez de `closeTab()` direto. Sem registro sujo fecha na hora; com registro, abre um confirm de 3 vias (`confirmUnsavedChanges`, `alerts.ts`) — Salvar e fechar / Fechar sem salvar / Cancelar. Novo hook `useUnsavedChangesGuard(isDirty, onSave)`, usado pelos 4 formulários com um snapshot JSON dos campos de negócio (excluindo estado só-de-UI), guardado como **estado React**, não lido de `ref` durante o render (o lint `react-hooks/refs` do React 19 proíbe isso — achado ao rodar lint pela primeira vez depois de implementar). **Achado na revisão do plano antes de implementar:** `OrdemProducaoForm` precisa de duas fases de "sujo" — antes de criar, o formulário; depois de criada, a única forma de trabalho não salvo é a conferência de finalização aberta (perda/sobra digitadas ali ainda não confirmadas), não dava pra simplesmente desligar o guard em modo edição. Validado ao vivo nos 4 formulários, incluindo o caminho de falha (Pedido de Venda sem itens no carrinho → "Salvar e fechar" mostra o erro de validação e a aba continua aberta) e o caso mais delicado (conferência de finalização aberta sem ter digitado nada nela ainda já conta como "sujo").

Typecheck/lint (0 erros, 66 warnings pré-existentes)/build/73 testes passando nas duas fatias.

**Sétima rodada em 2026-08-04 — Matéria-Prima e Ordens de Produção limitadas a 1 aba por vez** (commit `5eabb03`): o usuário viu duas abas "Matéria-Prima" idênticas na barra e pediu pra corrigir. Causa raiz: o dedup de `openTab()` só rodava na criação (path exato); nada impedia duas abas convergirem pro mesmo path depois, via navegação interna (ex: botão "Voltar" de um formulário voltando pra lista, quando outra aba já estava lá). Escopo confirmado com o usuário (AskUserQuestion): só esses dois módulos, não o sistema inteiro (que continua "uma aba por registro"); comportamento — reaproveita a aba existente do módulo, trocando o conteúdo (com o aviso de dados não salvos entrando em ação se necessário).

Correção em duas frentes: `openTab()` ganhou um caminho pra módulos "single-session" (`SINGLE_SESSION_PREFIXES`), reaproveitando qualquer aba já aberta sob o mesmo prefixo em vez de dedup por path exato — checando dado não salvo antes via `confirmUnsavedChanges()`. `updateTabLocation()` ganhou uma limpeza automática: se a navegação interna de uma aba pousar no território de um módulo single-session que outra aba já ocupa, fecha a outra. **Achado ao planejar:** reaproveitar a aba pra um registro diferente não remonta o componente sozinho (mesma rota, só o `:id` muda) — precisou de `key={tab.path}` no elemento renderizado (`TabPane.tsx`, só pros módulos single-session) pra forçar remount limpo, evitando `MateriaPrimaForm`/`OrdemProducaoForm` vazarem estado de um registro pro outro.

Validado ao vivo: abrir ordem → voltar → abrir outra ordem manteve 1 aba só, dados corretos de cada uma; editar matéria-prima, digitar sem salvar, clicar no atalho do menu → aviso apareceu, as 3 opções testadas (Cancelar/Fechar sem salvar/Salvar e fechar) todas sem duplicar aba. Typecheck/lint/build/73 testes passando.

**Fase restante:**
- **Fase C:** título dinâmico por aba (nome do registro, não só o nome da tela).

### F20 — Trilha de ícones do menu compacto vira atalho direto por tela (feature, 2026-08-02)

**Não estava no prompt original.** Pedido direto do usuário, a partir de uma captura de tela do menu recolhido (`Sidebar.tsx`).

**Antes:** a trilha fina de ícones (`nexus-sidebar-rail`) ficava **sempre visível**, mesmo com o menu completo aberto ao lado dela — um ícone por *grupo* de menu (Principal, Comercial, Cadastros...), e clicar nele só expandia/recolhia esse grupo no painel largo, redundante com o próprio painel.

**Depois (commit `9a44a6b`):**
- A trilha só renderiza quando o menu está no **modo compacto** (`miniSidebar`); com o menu completo, ela desaparece — só o painel largo com os grupos fica visível.
- Os 9 ícones deixaram de representar grupos e viraram **atalhos diretos pra telas específicas**, na ordem pedida pelo usuário: Dashboard, Pedido de Venda, Ordem de Serviço, Estoque, Contas a Receber, Entrada de Notas, Agendamento, Relatórios Diversos, Configuração Geral. Clicar navega direto (reaproveita `navigateTo`/`openTab`, o mesmo mecanismo do resto do menu), em vez de tentar abrir um submenu que nem apareceria com o menu recolhido. Cada atalho respeita módulo/permissão do item real via `canAccess`, igual ao resto do menu.
- **Efeito colateral que precisou de correção:** o botão de recolher/expandir menu vivia dentro da trilha — como ela some no modo completo, ficaria impossível voltar pro modo compacto. Adicionado um botão de recolher próprio no cabeçalho do painel largo, visível só quando o menu está completo.

Typecheck, lint, build e suíte de 66 testes passando. **Falta validação manual** (mesma limitação de sempre).

**Complemento em 2026-08-02 (commit `78913a8`):** removido o switch "Menu Compacto" que existia na `TopBar.tsx` — um controle duplicado e praticamente morto: só ficava habilitado depois que o usuário usasse o toggle do próprio `Sidebar.tsx` pelo menos uma vez (dependia de um flag `nexus_sidebar_expand_all` gravado só ali, sem nenhum jeito visível de ligá-lo por conta própria). Removidos junto: os estados `expandAll`/`miniSidebar` e o handler que só existiam pra esse switch em `TopBar.tsx`, o `dispatchEvent('sidebar-state-change')` órfão em `Sidebar.tsx` (a `TopBar` era a única ouvinte) e a regra CSS órfã `.menu-compacto-toggle`. O menu compacto continua controlável pelos dois botões que já vivem no próprio Sidebar (trilha, quando recolhido; botão no cabeçalho do painel largo, quando expandido).

### Módulo 6 — fatia Entrada de XML (priorizada em 2026-08-02 a pedido do usuário)

**Pedido do usuário:** dar prioridade à tela de Entrada de Nota Fiscal por XML, integrada de verdade com Contas a Pagar, Estoque, com popup automático de cadastro de fornecedor quando ele não existir, e uma tela própria de "Cadastro de Fornecedores". Depois de validado, seguir para o Módulo 4 (Produção).

**Concluído em 2026-08-02, em 2 commits:**

1. **`4f0b1f9` — Cadastro de Fornecedores.** Nova coleção `fornecedores` (já prevista nas `firestore.rules` desde o F5/F6, só faltava UI). `FornecedoresList.tsx` + `FornecedorForm.tsx` no mesmo padrão de Clientes (código, nome, telefone, e-mail, CNPJ/CPF, endereço), com `openTab()` desde o início — a lacuna corrigida na sessão anterior (F19) não se repetiu aqui. Nova entrada no menu Cadastros, reaproveitando a permissão `cadastros.estoque` (é a que as `firestore.rules` já exigem pra essa coleção, não criei uma permissão nova). Substituiu o item "Fornecedores" que só existia como mockup do roadmap em `/compras/fornecedores` (grupo "Compras", ainda não implementado) — removido de lá e do catálogo de módulos pra não duplicar o mesmo nome apontando pra duas telas diferentes.

2. **`f4f4aa1` — Integração da Entrada de XML.** A tela ([`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx)) já incrementava estoque e lançava um título em Contas a Pagar antes disso, mas com lacunas reais:
   - **Fornecedor era só texto livre**, sem vínculo a nenhum cadastro. Agora, ao ler o XML, busca o fornecedor pelo CNPJ em `fornecedores`; sem match, abre um **popup bloqueante** de cadastro rápido pré-preenchido com nome/CNPJ do XML — decisão confirmada com o usuário (via AskUserQuestion): a confirmação da importação fica desabilitada até o fornecedor existir, não dá pra pular. Itens de estoque e título(s) de Contas a Pagar passam a gravar `fornecedorId` + `fornecedorNome`.
   - **Vencimento do título usava a data de emissão da nota**, o que é logicamente errado (emissão não é a data de pagamento) — bug real, não só lacuna. Corrigido: novo parser das duplicatas (`<dup>`/`<dVenc>`/`<vDup>`) do XML — nota com parcelamento lança **um título por duplicata**, cada um com seu vencimento; sem duplicata no XML, lança um único título com vencimento padrão de emissão + 30 dias (`addDaysToDateInput`, já existente e testado desde o F15).
   - Corrigido também um typo na categoria lançada (`"FORNEDORES DE PEÇAS"` → `"FORNECEDORES DE PEÇAS"`), que agora bate com o Plano de Contas mostrado em `ContasPagar.tsx`.

Typecheck, lint e build passando limpos; suíte de 66 testes sem mudança (nenhuma lógica financeira nova além de `addDaysToDateInput`, que já tinha teste). Publicado em `dev`.

**Continua pendente:** validação manual de ponta a ponta (mesma limitação de sempre — a Claude não pode logar). Roteiro sugerido: importar um XML de nota real (com e sem duplicata), conferir que o popup de fornecedor abre quando o CNPJ não bate com nada cadastrado, que a importação fica bloqueada até cadastrar, e que o(s) título(s) aparecem corretos em Contas a Pagar com o vencimento certo.

**Deliberadamente fora do escopo desta fatia:** a listagem central de Notas Fiscais (a parte "Módulo 6" original, ver mais abaixo) não foi tocada — fica pra depois de Produção, conforme combinado.

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

**Estado atual:** iniciado em 2026-08-02. Já há esqueleto nas `firestore.rules` (`ordens_producao`, `produtos_composicao`, `estoque_lotes`) e placeholder de rota (`/operacoes/:moduleId` → `RoadmapModule`), com a permissão `operacoes.producao` já catalogada (essa fica reservada pra fatia de Ordem de Produção — a de Matéria-Prima abaixo usa uma permissão própria, `cadastros.materia_prima`).

**⚠ Resolvido em 2026-08-02:** o trecho corrompido do PDF, confirmado com o usuário — faltava uma seção de **Cadastro de Matéria-Prima**, com a mesma lógica do cadastro de produtos, mas como **pool de estoque separado** do estoque de produtos acabados e de itens que não dependem de produção.

**Fluxo:** Entrada Matéria Prima → Estoque → Ordem de Produção → Em Produção → Pausada → Retornada → Finalizada → Produto Acabado.

**Controlar:** matéria-prima, produto acabado, perdas, produção parcial, responsável, data/hora, tempo, status, histórico, relatórios.

**Como implementar:** é o maior módulo — quebrado em sub-etapas com commit próprio: **(0) Cadastro de Matéria-Prima**, (a) composição de produto, (b) ordem de produção + máquina de estados, (c) consumo de matéria-prima, (d) perdas e produção parcial, (e) relatórios.

**Decisão confirmada com o usuário (AskUserQuestion, 2026-08-02):** a "ordem obrigatória 13 → 12 → 4" da Fase 3 (ver início da Seção 5) **não se aplica** aqui — foi pensada para quando Produção consumiria o mesmo pool de estoque das vendas. Com Matéria-Prima como pool separado, o consumo numa Ordem de Produção não depende do mecanismo de reserva do Módulo 13; é um débito/crédito atômico dentro da própria transação da ordem, no mesmo padrão que `applyStockAdjustments` já usa. Módulos 13/12 ficam pendentes, sem bloquear o 4.

**Fatia 0/N concluída em 2026-08-02 — Cadastro de Matéria-Prima** (commit `6673e26`): nova coleção `materias_primas`; `MateriasPrimasList.tsx` + `MateriaPrimaForm.tsx` em [`src/pages/Producao/`](../src/pages/Producao/) no mesmo padrão de Estoque (código, nome, categoria, unidade, quantidade, estoque mínimo, custo, fornecedor) — **simplificação deliberada:** unidade de medida é campo de texto livre, não ligada ao cadastro de Unidades de Medida (evita replicar a lógica de `unidadeMedidaId`/fracionado do `EstoqueForm.tsx`, fora de escopo pra essa fatia); fornecedor também é texto livre (não linkado a `fornecedorId`, diferente do que foi feito na Entrada de XML). Nova permissão `cadastros.materia_prima`, não pendurada em `cadastros.estoque` (seguindo a orientação já registrada na Seção do Módulo 12). Regra implantada em `sistema-nexus-dev` no mesmo dia. Typecheck/lint/build/66 testes passando. **Falta validação manual** (mesma limitação de sempre).

**Fatia 1/N concluída em 2026-08-02 — Composição de produto** (commit `b6ec2e7`): nova aba "Composição (Produção)" em [`EstoqueForm.tsx`](../src/pages/Estoque/EstoqueForm.tsx), visível só no modo Avançado e só depois do produto já salvo (precisa do `id`). Lista as matérias-primas cadastradas e monta a receita: quais matérias-primas e em que quantidade são consumidas pra produzir 1 unidade do produto acabado. Guardado num documento próprio por produto em `produtos_composicao/{produtoId}` — coleção **já liberada nas `firestore.rules` desde o F5/F6** sob a permissão `cadastros.estoque`, não precisou de deploy de regra nova. Salvamento independente do formulário principal do produto (botão "Salvar Composição" próprio, `setDoc(merge:true)`) — deliberado, pra não inchar ainda mais o `handleSave` já grande do produto. Typecheck/lint/build/66 testes passando. **Falta validação manual.**

**Fatia 2/N concluída em 2026-08-02 — Ordem de Produção + máquina de estados** (commit `d344182`): `OrdensProducaoList.tsx` + `OrdemProducaoForm.tsx` em `src/pages/Producao/`. Máquina de estados: Criada → Em Produção ⇄ Pausada → Finalizada, ou Cancelada a partir de qualquer estado não-final. Criação pede produto (do Estoque), quantidade planejada e responsável (mesmo padrão de `mecanicoId` do `OSForm.tsx`); número sequencial via `reserveTenantSequence`, mesmo padrão de OS/Pedido/Orçamento. **"Finalizar Produção"** lê a composição do produto (fatia anterior) e roda uma `runTransaction`: debita cada matéria-prima (erro claro se saldo insuficiente) e credita a quantidade planejada no produto acabado em `estoque` — sem composição cadastrada, bloqueia a finalização com aviso. **Deliberadamente fora de escopo nesta fatia:** produção parcial e perdas (fatia (d), ainda não implementada) — aqui a ordem sempre produz a quantidade planejada inteira, sem opção de registrar perda/sobra. Nova permissão `operacoes.producao` (já catalogada desde o esqueleto original, só faltava virar permissão de verdade): `ordens_producao` saiu do balaio genérico de `cadastros.estoque` nas `firestore.rules` e ganhou cláusula própria, seguindo a orientação já registrada no plano pra módulos novos — regra implantada em `sistema-nexus-dev` no mesmo dia. Novo grupo "Produção" no menu lateral; removido o item "Produção Interna" do grupo roadmap "Operações" (não é mais mockup). Typecheck/lint/build/66 testes passando. **Falta validação manual.**

**Fatia 3/N concluída em 2026-08-02 — Conferência de perdas antes de finalizar** (commit `01d7287`): o usuário testou a fatia 2 e apontou uma lacuna real — "Finalizar Produção" debitava a matéria-prima num clique só, sem nenhuma etapa de conferência, e não tinha como registrar produção parcial nem perda além do previsto na receita. Corrigido: "Finalizar Produção" agora abre uma **tela de conferência** (nada é gravado ainda) mostrando a quantidade produzida (editável, pré-preenchida com a planejada) e, por matéria-prima, o "necessário" recalculado ao vivo (receita × produzido) mais um campo de "perda extra" editável — só debita de verdade ao confirmar. **Decisão confirmada com o usuário (AskUserQuestion):** produção parcial consome pela quantidade **produzida**, não pela planejada (se planejou 100 e só saiu 95 boas, só debita proporcional a 95; a diferença vira perda extra manual, não é embutida automaticamente). `itensConsumidos` ganhou `quantidadeNecessaria`/`perdaExtra` separados do total consumido, refletido também na tabela pós-finalização. Typecheck/lint/build/66 testes passando. **Falta validação manual.**

**Fatia 4/4 concluída em 2026-08-02 — Relatório de Produção, fechando o Módulo 4** (commit `7d365a2`): `RelatorioProducao.tsx` em `src/pages/Producao/`, mesmo padrão visual dos relatórios já existentes (`StatCard`/`ChartWrapper`/`ReportFilter` reaproveitados sem mudança). Cobre: total de ordens no período, finalizadas/em andamento/canceladas, eficiência de produção (produzido/planejado, usando os números reais pós-conferência da fatia anterior), volume por dia, distribuição por status, ranking de produtos mais fabricados, ranking de responsáveis, e uma tabela de perda de matéria-prima no período agrupada por matéria-prima (não dava pra comprimir num único número porque cada matéria-prima tem sua própria unidade). Nova rota `/producao/relatorios`, mesma permissão `operacoes.producao` — sem regra nova no Firestore (só leitura de `ordens_producao`, já coberta). Typecheck/lint/build/66 testes passando. **Falta validação manual.**

**Módulo 4 fechado no código com isso — as 4 fatias completas:** (0) Cadastro de Matéria-Prima, (1) Composição de produto, (2) Ordem de Produção + máquina de estados, (3) conferência de perdas/produção parcial, (4) relatórios. Falta só validação manual de ponta a ponta.

**Fatia 5 (sobras), 6 (excluir/estornar) e complemento ao estoque previsto, concluídas em 2026-08-04, a pedido direto do usuário (não estava no prompt original):**

- **Sobras** (commit `37d6503`): terceiro campo na conferência de finalização, ao lado da perda extra já existente (F14) — perda = descartado, sobra = matéria-prima que volta pro estoque em vez de ser consumida. Débito líquido passou a `necessário + perdaExtra - sobra`, validado contra ficar negativo (não dá pra devolver mais do que foi retirado). Coluna nova nas duas tabelas (conferência e itens consumidos) e agregação "Sobra de Matéria-Prima no Período" no Relatório de Produção, espelhando a de perdas.
- **Excluir / Estornar ordem** (commit `94a59f6`): "Excluir" (deleteDoc simples) pra qualquer status que nunca tocou estoque (criada/em_producao/pausada/cancelada). "Estornar" (novo status `estornada`, mantém o registro — mesmo padrão do cancelamento de OS) só pra ordens finalizadas: transação que devolve a matéria-prima debitada, retira a quantidade creditada no produto, e **recusa o estorno se parte do produzido já saiu do estoque** (venda, etc.), mesmo espírito de segurança que a finalização já tinha. Achado durante a validação ao vivo: `OrdensProducaoList.tsx` tinha sua própria cópia local de `STATUS_LABELS`/`STATUS_COLORS` (não reaproveitava a de `OrdemProducaoForm.tsx`) e ficou sem entrada pra `estornada` — corrigido, senão a badge de status ficava em branco na lista.
- **Estoque previsto na Matéria-Prima** (commit `9ac8cd4`): nova função pura `src/utils/producaoDomain.ts` (`computeReservedRawMaterialMap`, testada — 7 testes novos, 73 no total) soma por matéria-prima quanto está reservado pelas ordens `em_producao` (usa a quantidade *planejada*, não a produzida, que só existe na finalização). Novo hook `useReservedRawMaterialStock` cuida do Firestore (assina ordens ativas + busca a composição de cada produto referenciado). Badge "Em Produção" + coluna "Estoque Previsto" na lista de matéria-prima, e painel "Reservado / Estoque Previsto" no formulário de edição. Validado ao vivo: ordem planejando 5un de um produto com 1kg de matéria-prima por unidade → lista e formulário mostraram "Reservado: 5 KG" / "Estoque Previsto: 24.5 KG" (29.5kg em estoque - 5kg reservados), batendo exato.

Todas as três validadas ao vivo no navegador (estorno testado revertendo uma produção real de 15kg de matéria-prima; exclusão testada numa ordem cancelada). Typecheck/lint/build/73 testes passando em cada fatia.

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
| M1 Navegação por teclado | 2 | 🟨 Código pronto (PDV + Pedido + OS + Cadastros) — falta validação manual | 2026-07-31 |
| M19 Numeração | 2 | ✅ Concluído — sem código novo, nada implementável hoje (ver seção do módulo) | 2026-07-31 |
| F20 Trilha do menu compacto vira atalho | 2 | 🟨 Código pronto — falta validação manual | 2026-08-02 |
| M20 Responsabilidade | 2 | 🟨 Código 100% pronto (5/5 fatias) — falta validação manual | 2026-07-31 |
| M6 fatia Entrada de XML (Fornecedores + Contas a Pagar + Estoque) | 2 | 🟨 Código pronto — falta validação manual (priorizada fora de ordem a pedido do usuário) | 2026-08-02 |
| M18 Cancelamentos (auditoria) | 2 | ⬜ Pendente — adiado, depois de M4 | |
| M6 Central de Notas Fiscais (listagem) | 2 | ⬜ Pendente — adiado, depois de M4 | |
| M15 Relatórios padronizados | 2 | ⬜ Pendente — adiado, depois de M4 | |
| M13 Reserva de estoque | 3 | ⬜ Pendente | |
| M12 Conferência de mercadoria | 3 | ⬜ Pendente | |
| M4 Produção — fatia 0/N Matéria-Prima | 3 | 🟨 Código pronto, regra implantada — falta validação manual | 2026-08-02 |
| M4 Produção — fatia 1/N Composição de produto | 3 | 🟨 Código pronto (regra já existia) — falta validação manual | 2026-08-02 |
| M4 Produção — fatia 2/N Ordem de Produção + máquina de estados | 3 | 🟨 Código pronto, regra implantada — falta validação manual | 2026-08-02 |
| M4 Produção — fatia 3/N Conferência de perdas/produção parcial | 3 | 🟨 Código pronto — falta validação manual | 2026-08-02 |
| M4 Produção — fatia 4/4 Relatórios (fecha o módulo) | 3 | 🟨 Código pronto — falta validação manual | 2026-08-02 |
| M16 Dashboard integrado | 3 | ⬜ Pendente | |
| M7 Novo fluxo de vendas | 4 | 🔒 Travado — aguarda decisão | |
| M8 Nota com valor diferente | 4 | 🔒 Travado — aguarda contador | |

---

## 9. Pendências a esclarecer com o usuário

1. ~~**Módulo 4:** trecho corrompido no PDF original — confirmar se falta requisito de Produção.~~ Resolvido em 2026-08-02: faltava Cadastro de Matéria-Prima (pool de estoque separado, mesma lógica do cadastro de produtos) — ver seção do Módulo 4.
2. **Módulo 15:** "Excel" exige `.xlsx` real ou CSV atende?
3. ~~**Módulo 2:** operadora/adquirente também vira catálogo agora ou fica texto livre?~~ Decidido em 2026-07-28: continua texto livre.
4. **Módulo 7:** decisão de arquitetura + plano de migração.
5. **Módulo 8:** validação contábil antes de qualquer implementação.
6. **Filial:** o relatório financeiro de 19/07 já apontou que não existe entidade de filial, e isso bloqueia sessão de caixa por operador/filial. Definir se entra no escopo.
7. **Módulo 14 / TopBar:** busca global (OS, clientes e agora produtos) usa `limit(80)` + filtro no cliente nas três coleções — não escala para catálogo grande. Resolver exige índice dedicado ou campo de busca normalizado, afetando as três buscas juntas; não implementado ainda, fora do escopo deste módulo.
8. **Repositórios git:** confirmado em 2026-07-28 que este diretório local tinha só um remote (`origin`), que na verdade aponta para o repo de **produção** (`Sistema-Nexus-Company-Commit`). Renomeado para `production` e criado um novo remote `dev` → `SaaS_NexarERP-DESENVOLVIMENTO`. Os commits de M2/M10/M9 já foram parar em `production` (não revertido, a pedido do usuário) mas **ainda não foram enviados a `dev`** — `git push dev main` ficou pendente (bloqueado pelo classificador de permissão do Claude Code na tentativa automática; precisa ser rodado pelo usuário ou reautorizado explicitamente a cada sessão).
