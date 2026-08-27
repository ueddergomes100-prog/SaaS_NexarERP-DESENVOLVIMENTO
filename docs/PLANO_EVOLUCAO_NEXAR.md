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

**Módulo 20 (Responsabilidade) está com todo o código pronto**, cobrindo as 5 fatias (Cadastros simples, Vendas/PDV/OS/Orçamentos, Financeiro, Cadastros com form próprio, Fiscal/Admin/Auth).

**Validado ao vivo em 2026-08-15** (usuário logou no navegador interno, Claude só navegou/consultou o Firestore via SDK já autenticado na página — nunca tocou em credencial): editada a categoria "ANTIPULGAS" (documento antigo, criado antes do F5/M20) — consulta direta no Firestore confirmou `alteradoPor`/`alteradoEm` gravados com o uid e timestamp corretos, sem `criadoPor` (documento antigo não migrado, exatamente como documentado — "documento antigo simplesmente não tem o campo"). Criada uma categoria nova de teste — confirmado `criadoPor`/`criadoEm`/`alteradoPor`/`alteradoEm` todos presentes e corretos. Categoria de teste excluída ao final. Módulo 20 fechado, código e comportamento batendo 100% com o desenho.

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

### F21 — Redesign de Login/Cadastro: card dividido com painel de destaque deslizante (feature, 2026-08-14)

**Não estava no prompt original.** Pedido direto do usuário, com referência visual ao vivo (padrão "auth switch" popular, visto num componente de galeria — 21st.dev). Decisão confirmada antes de implementar: recriar o visual com nosso CSS próprio (variáveis de tema já existentes), sem adicionar Tailwind/shadcn ao projeto.

**Antes:** `Login.tsx` e `Register.tsx` eram duas telas separadas, cada uma com seu próprio card centralizado (`auth-container`/`auth-card`), navegação entre elas via link simples de rodapé.

**Depois:** novo `AuthPage.tsx` substitui os dois arquivos — Login e o passo "Empresa" do Cadastro (assistente de 3 passos: Empresa → Validação de e-mail/telefone → Senha) viram **um único componente montado**, com um card dividido em duas metades: painel de formulário e painel de destaque com gradiente (`--accent-purple` → `--accent-blue`, nossas cores) e borda curva que desliza de lado ao alternar entre "Entrar" e "Criar Conta". A troca de modo usa **estado local + `window.history.replaceState`** (nunca `navigate()` do react-router) — é isso que evita desmontar o componente e permite a transição CSS da curva acontecer de verdade, em vez de um "flash" de troca de página. As URLs `/login` e `/cadastro` continuam funcionando pra link direto/recarregar (`AuthPage` lê `useLocation().pathname` só na montagem pra decidir o modo inicial).

**Decisões confirmadas com o usuário antes de implementar (via AskUserQuestion):**
- Os passos de Validação e Senha do cadastro **não** entram no painel dividido (formato incompatível com códigos/senha) — continuam no layout de card único de sempre, acionado assim que `signupStep !== 'company'`.
- Ícones de login social (Google/Facebook/Twitter/LinkedIn) ficam como **enfeite visual puro**, sem `onClick` nem OAuth de verdade — o Hennder ERP só tem login por e-mail/senha ou usuário+CNPJ.

**Risco tratado com cuidado:** `Login.tsx`/`Register.tsx` tinham lógica de segurança real (sessão ativa, seleção de tenant multi-empresa, verificação de CNPJ/e-mail/telefone via backend, criação de senha, login automático pós-cadastro do F-anterior desta mesma sessão). Toda essa lógica foi **movida literalmente** pro arquivo novo, sem reescrever nada — só a casca visual (JSX de wrapper + CSS) mudou.

**Bug pego na validação ao vivo com o usuário, corrigido no mesmo commit:** a primeira versão deixava o painel de gradiente cobrir o texto do formulário no ponto mais largo da curva (`z-index` do painel de destaque acima do painel de formulário, sem que o texto tivesse recuo suficiente). Primeira tentativa de correção (dar fundo opaco ao painel de formulário e subir seu `z-index` acima do painel de destaque) resolveu a sobreposição mas deixou a curva com cara de "cortada" — o usuário apontou que não ficou igual à referência. Correção definitiva: manter o painel de destaque por cima (curva completa e fluida, como o site de referência), e em vez disso dar **padding assimétrico** ao painel de formulário (~100px do lado que enfrenta a curva, ~40px do lado oposto, espelhado entre os dois modos) — o texto nunca entra na zona de alcance máximo da curva. Confirmado por cálculo geométrico (não só visual): ~30px de folga entre o ponto mais largo da curva e o início do texto, nos dois modos.

Typecheck, lint (0 erros, warnings pré-existentes) e build passando. Validado ao vivo: animação de slide nos dois sentidos, cadastro completo de ponta a ponta (CNPJ real → códigos → senha → login automático → Dashboard, reaproveitando o fluxo do F-anterior), login normal (`handleLogin` intacto), tema claro, fallback responsivo mobile (painel de destaque vira faixa horizontal compacta acima do formulário). Conta de teste apagada do banco de dev ao final. Commit `b743a92`, publicado em `dev`.

### F23 — Animação de carregamento no login (polish, 2026-08-15)

**Não estava no prompt original.** Pedido do usuário ao clicar em "Entrar": a animação de carregamento não estava chamando atenção — pediu algo "intuitivo", nas cores do sistema, sugerindo um Lottie como referência (lottiefiles.com). Decisão confirmada com o usuário (via AskUserQuestion): construir a animação em CSS/SVG puro nas cores do sistema, em vez de adicionar a dependência `lottie-react` + baixar um arquivo externo — evita aumentar o bundle e questão de licença de asset de terceiro, sem perder o efeito "luxo".

**Investigação:** o código já tinha um spinner (`Loader2` com `spin-icon`) no botão "Entrar" e no painel de status, com a keyframe `authSpin` corretamente definida e escopada em `Auth.css` — tecnicamente já animava. O problema real era de percepção/qualidade: um ícone pequeno girando não lê como "carregando" com destaque, muito abaixo do padrão visual do resto do redesign (F21).

**Implementado em [`AuthPage.tsx`](../src/pages/Auth/AuthPage.tsx) + [`Auth.css`](../src/pages/Auth/Auth.css):**
- Novo anel giratório em `conic-gradient` (`--accent-blue` → `--accent-purple` → `--accent-blue`), com um círculo interno "furando" o centro pra criar o efeito de anel (donut) — usado no painel de status do login (`.auth-loading-ring`, 26px) e, maior e com glow, na tela cheia "Iniciando Ambiente" pós-login (110px, ao redor do logo, que ganhou um pulso suave próprio via `splashLogoPulse`).
- Botão "Entrar": substituído o ícone `Loader2` por um spinner de borda branca simples (`.auth-btn-spinner`) — mais legível em cima do fundo roxo sólido do botão do que um anel gradiente (que precisa de contraste de fundo pra aparecer).
- Removida a keyframe antiga `spinPulse` (quadrado rotacionando 45°/scale) da tela cheia, substituída por `splashRingSpin` (rotação simples do anel) + `splashLogoPulse` (pulso do logo).
- **Escopo deliberadamente restrito ao login** — os spinners de cadastro/verificação de código (`signupLoading`, `verifying`) continuam com o `Loader2`/`spin-icon` de sempre, que já funcionava e não foi alvo da reclamação.

**Validado ao vivo** (sem precisar de login real — nunca digitamos credencial, nem de teste): confirmado via `getComputedStyle` que a animação está de fato rodando (`animationName: authRingSpin`), e visualmente por injeção de debug temporária (removida em seguida) mostrando o painel de status, o botão e a tela cheia nos dois temas (claro e escuro) — anel com contraste bom nos dois. Typecheck/lint/build/133 testes (sem lógica pura nova, é só CSS/JSX) passando.

### F24 — Bugfix crítico: Esc nunca fechava nenhum modal em lugar nenhum do sistema (2026-08-15)

**Achado durante a validação manual do M1** (usuário logou no navegador interno e pediu pra validar o que estava pendente — ver Seção 8). Ao testar o modal de Taxas por bandeira (F14) em Bandeiras de Cartão, Esc não fechava, só o X funcionava. Investigação revelou que era sistêmico, não isolado dessa tela.

**Causa raiz:** `useEscapeLayer`/`globalEscapeStack` (F3, base do Módulo 1) sempre empilhou as camadas fecháveis corretamente, mas **nenhuma tela em todo o sistema registrava um binding `{ key: 'Escape', handler: () => closeTopEscapeLayer() }`** no `useKeyboardShortcuts` — confirmado por grep: `closeTopEscapeLayer` nunca era chamado em nenhum arquivo além de onde foi definida (`useKeyboardFlow.ts`). A pilha existia, era testada (`createEscapeStack` tem cobertura de teste desde o F3), mas nunca era conectada a um evento de tecla real. Afetava toda tela que dependesse só de `useEscapeLayer` sem lógica própria de Esc: `BandeirasCartaoList`, `BancosList`, `UnidadesMedidaList`, os dropdowns internos de `OSForm` (serviço/veículo), `ClientAutocomplete` e `ProductSearchModal` ("Ver Mais").

**Corrigido:**
- Nova `useGlobalEscapeKey()` em [`useKeyboardFlow.ts`](../src/hooks/useKeyboardFlow.ts) — um único listener `window.addEventListener('keydown', ...)` que chama `closeTopEscapeLayer()`. Chamada uma única vez em [`AppLayout.tsx`](../src/components/layout/AppLayout.tsx) (raiz da área autenticada, fora do `TabsProvider`) — corrige todas as telas de uma vez, sem depender de cada tela lembrar de registrar o binding sozinha (que é exatamente o que causou o bug: nenhuma lembrou).
- **Risco avaliado antes de aplicar:** três arquivos (`ProductAutocomplete.tsx`, `PaymentsEditor.tsx`, `PDV.tsx`) já tratavam Esc localmente, fora do `globalEscapeStack`. `ProductAutocomplete.tsx` já chamava `stopPropagation()` — sem risco. `PDV.tsx` não usa `useEscapeLayer` em nada (o bug conhecido dele, "Esc fecha os 3 modais juntos", é independente e permanece fora de escopo, não piorou nem melhorou). `PaymentsEditor.tsx` (dropdown de forma de pagamento, compartilhado por PDV/Pedido/OS) fechava o próprio dropdown sem `stopPropagation()` — corrigido com uma linha, pra Esc não fechar o dropdown E a camada seguinte da pilha (ex: o modal que o contém) na mesma tecla.
- Sem lógica pura nova (é wiring de infraestrutura já testada) — nenhum teste novo necessário; os 133 testes existentes continuaram passando.

**Validado ao vivo, em múltiplos componentes diferentes:** modal de Taxas (F14) e modal "Nova Bandeira" em Bandeiras de Cartão, dropdown do `ClientAutocomplete` numa OS, modal "Ver Mais" (`ProductSearchModal`) numa OS, e o dropdown inline do `ProductAutocomplete` — todos fecham com Esc agora, e só fecham **um nível por vez** (testado explicitamente: abrir peça → Esc → só o dropdown fecha, a OS inteira continua aberta e intacta).

Typecheck/lint/build passando. Commit próprio, antes do restante da rodada de validação manual.

### F22 — Histórico, precificação e exclusão na Entrada de NF-e (feature, 2026-08-14)

**Não estava no prompt original.** Pedido direto do usuário: (1) visualizar/ter histórico das notas de entrada já importadas; (2) poder precificar o produto (preço de venda + tributação) direto na tela de lançamento da nota, antes de gravar no estoque; (3) botão de excluir na tela fiscal que reverte a quantidade de estoque e apaga os títulos de Contas a Pagar gerados, mas mantém o cadastro do produto; (4) identificar, item a item, se é Matéria-Prima ou Revenda.

**Descoberta ao investigar:** a importação de XML ([`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx)) nunca gravou um documento da nota em si — só atualizava `estoque` e criava `transacoes` direto, sem deixar rastro pra listar ou reverter depois. A coleção `notas_fiscais` que já existe é exclusiva de emissão (saída, via Spedy) — schema incompatível, não dava pra reaproveitar. Matéria-prima já é hoje uma coleção totalmente separada (`materias_primas`, sem preço de venda nem tributação, só custo) — a importação de XML sempre gravava em `estoque`, nunca lá.

**Decisões confirmadas com o usuário (via AskUserQuestion) antes de implementar:**
- Classificação Matéria-Prima/Revenda só é perguntada pra item **novo** (não reconhecido em `estoque` nem em `materias_primas`); item já cadastrado em qualquer uma das duas mantém o destino conhecido automaticamente.
- A precificação (preço de venda + tributação) aparece pra **todo** item de Revenda, novo ou já cadastrado — permite reajustar na própria tela de entrada. Item marcado como Matéria-Prima nunca mostra esse bloco.
- Exclusão de uma nota já confirmada é **bloqueada** se qualquer título de Contas a Pagar gerado por ela já estiver pago (mesmo princípio já usado no estorno de Produção — não desfaz automaticamente algo com efeito financeiro real).

**Fatiamento (4 fatias, uma por vez, commit próprio):** 0) fundação — nova coleção `notas_fiscais_entrada`; 1) histórico/listagem; 2) classificação Matéria-Prima/Revenda + precificação na tela de lançamento; 3) exclusão com reversão.

**Fatia 0/N concluída em 2026-08-14 — Fundação (zero mudança de comportamento visível):** nova coleção `notas_fiscais_entrada`, liberada em [`firestore.rules`](../firestore.rules) sob a permissão granular `fiscal.entrada` (a mesma que já protege a tela de Entrada de XML — create e delete, pra já deixar pronto pra Fatia 3). Novo `src/utils/entradaNfeDomain.ts` (`buildNotaFiscalEntradaRecord`, função pura testada) monta o formato do registro: cabeçalho da nota (número, emissão, valor, fornecedor), lista de itens (`itemId`, `tipo` — hoje sempre `'revenda'`, ainda sem a classificação da Fatia 2 —, quantidade, valor unitário, se o produto era novo ou já existia) e os ids dos títulos de Contas a Pagar gerados (`titulosPagarIds`) — é esse último campo que vai permitir a Fatia 3 excluir exatamente os títulos certos, sem varrer `transacoes` por descrição. `EntradaNFE.tsx` passou a capturar o id de cada produto criado/atualizado e de cada título criado durante o loop que já existia, e grava um documento novo em `notas_fiscais_entrada` ao final da confirmação — nenhuma escrita existente em `estoque`/`transacoes` foi alterada. 3 testes novos em `tests/entradaNfeDomain.test.ts` (registrado no runner, 115→118). Typecheck/lint (0 erros, 66 warnings pré-existentes)/build passando. Regra implantada em `sistema-nexus-dev` no mesmo dia. `git diff --stat` restrito aos arquivos esperados (`firestore.rules`, `run-finance-domain-tests.mjs`, `EntradaNFE.tsx`, os 2 arquivos novos).

**Falta validação manual** (mesma limitação de sempre — login é ação do usuário): importar um XML de teste e confirmar no console do Firestore que o documento novo em `notas_fiscais_entrada` aparece com os itens e títulos corretos.

**Fatia 1/N concluída em 2026-08-14 — Histórico (tela de listagem):** nova tela [`NotasFiscaisEntradaList.tsx`](../src/pages/Fiscal/NotasFiscaisEntradaList.tsx) em `/fiscal/entrada-nfe/historico`, acessível pelo menu Fiscal e por um botão "Ver Histórico" na própria tela de Entrada de XML (via `openTab`, seguindo o padrão do F19). Lista as notas por data/número/fornecedor/valor/qtd. de itens/status, com busca; "Ver detalhes" abre um modal com os itens da nota (denormalizados no próprio documento, sem refetch) e os títulos de Contas a Pagar gerados (buscados sob demanda via `where(documentId(), 'in', titulosPagarIds)`, só ao abrir o modal). Rota herdou a proteção de `fiscal.entrada` automaticamente pelo fallback genérico de `/fiscal/*` já existente em `routeAccess.ts` — não precisou de mudança lá. Sem lógica pura nova (é listagem/leitura), 118 testes seguiram passando. **Falta validação manual.**

**Fatia 2/N concluída em 2026-08-14 — Classificação Matéria-Prima/Revenda + Precificação/Tributação na tela de lançamento (o núcleo do pedido do usuário):**
- [`fiscalDomain.ts`](../src/utils/fiscalDomain.ts): nova `matchMateriaPrimaFromXmlItem` (2 camadas — código exato, depois nome exato — mais simples que o matching de `estoque` porque `materias_primas` não tem EAN/NCM/códigosFornecedor, decisão já registrada no Módulo 4 Fatia 0). `CSOSN_OPTIONS` centralizada aqui (antes vivia como const privada duplicável em `EstoqueForm.tsx`) — `EstoqueForm.tsx` migrado pra importar dali, sem duplicar a lista.
- [`entradaNfeDomain.ts`](../src/utils/entradaNfeDomain.ts): nova `buildInitialItemEntradaConfig` (pura, testada) decide, por item, a classificação inicial e os valores pré-preenchidos de preço/tributação a partir do resultado do matching: produto já em `estoque` → Revenda, herda preço de venda e dados fiscais já cadastrados (cai na margem padrão de 50% só se o produto não tiver preço de venda salvo); item já em `materias_primas` → Matéria-Prima, sem campos de preço/tributação; item novo → Revenda por padrão (comportamento antigo preservado), com CSOSN default '102' só no Simples Nacional, igual já era.
- [`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx): a tabela estática de itens virou uma lista de cards editável. Item novo ganha um seletor "Produto de Revenda" / "Matéria-Prima"; todo item de Revenda (novo ou mesclado) mostra um painel de Preço de Venda + CSOSN (Simples Nacional) ou CST de ICMS + alíquota ICMS + redução de base + CST/alíquota de PIS e COFINS (fora do Simples — os únicos campos que `buildTaxesPayload` de fato consome na emissão, MVP deliberado, mesmo espírito do IBS/CBS já documentado nesse arquivo; IPI/IBS/CBS continuam só editáveis depois no cadastro do produto). Confirmar a importação agora **bloqueia** se qualquer item de Revenda estiver sem preço de venda válido (> 0) — novo, não existia antes (o markup de 50% garantia um valor sempre, mesmo que errado; agora é decisão explícita do usuário). Itens classificados como Matéria-Prima gravam/atualizam em `materias_primas` (custo apenas, sem preço de venda nem tributação — mesma simplificação do cadastro manual: unidade/fornecedor texto livre) em vez de `estoque`. O histórico da nota (`notaItens`) passou a registrar `tipo` corretamente por item (antes sempre `'revenda'`, hardcoded na Fatia 0).
- Classificação só é recalculada depois que o fornecedor termina de resolver (`fornecedorStatus === 'found'`) — evita classificar um item como "novo" por engano antes de saber o código que aquele fornecedor específico usa pra ele (camada 2 do matching de `estoque`), o que criaria um produto duplicado em vez de mesclar.
- 9 testes novos (2 em `fiscalDomain.test.ts` cobrindo `matchMateriaPrimaFromXmlItem` + guard de string vazia, 5 em `entradaNfeDomain.test.ts` cobrindo `buildInitialItemEntradaConfig` nos 4 cenários — 118→127). Typecheck/lint (0 erros, 0 warnings novos)/build passando.

**Falta validação manual das fatias 0-2** (mesma limitação de sempre): importar uma nota real com item novo, item já em estoque e item já em matéria-prima; confirmar que só o item novo pede classificação; testar o bloqueio de preço de venda vazio; conferir que a nota criada em `materias_primas` não grava preço de venda; testar num tenant Lucro Presumido/Real que os campos extra de ICMS/PIS/COFINS aparecem e são gravados.

**Fatia 3/N concluída em 2026-08-14 — Excluir com reversão, fechando o F22:** botão "Excluir" na tela de Histórico (linha da lista e rodapé do modal de detalhe), só visível em notas com `status: 'ativa'`. Fluxo inteiro dentro de uma `runTransaction` (todas as leituras — nota, títulos, itens de estoque/matéria-prima — antes de qualquer escrita, mesma exigência do Firestore já documentada em outras transações do sistema):
- Pede motivo (mínimo 12 caracteres, mesmo padrão de `ContasPagar.handleExcluir`).
- **Bloqueia** se qualquer título de Contas a Pagar gerado pela nota não estiver `'Pendente'` (`findTituloBloqueandoExclusao`, pura, testada) — decisão já travada com o usuário antes de implementar.
- **Bloqueia** se o estoque atual de qualquer item (revenda ou matéria-prima) for menor que a quantidade que a nota somou — ou seja, parte já foi vendida/consumida por outro caminho (`findItemSemEstoqueParaReverter`, pura, testada; mesmo princípio de segurança já usado no estorno de Produção: "recusa se parte já saiu do estoque").
- Passando nos dois checks: reverte `quantidade` (subtrai, sem apagar o cadastro do produto/matéria-prima), apaga os documentos de `transacoes` dos títulos, e marca a nota como `status: 'excluida'` + `motivoExclusao` (soft-delete — continua aparecendo no histórico, não some da listagem).
- Log de auditoria após a transação, mesmo padrão do resto do sistema.
- **Sem mudança nenhuma em `firestore.rules`:** as escritas em `estoque`/`materias_primas`/`transacoes`/`notas_fiscais_entrada` já caem nas permissões existentes (`cadastros.estoque`, `cadastros.materia_prima`, `financeiro.estornar`, `fiscal.entrada` respectivamente) — mesma característica que a própria importação já tinha desde 2026-08-02 (quem importa NF já precisa dessas permissões além de `fiscal.entrada`; não é uma lacuna nova desta fatia).
- 6 testes novos (127→133). Typecheck/lint (0 erros, 0 warnings novos)/build passando.

**F22 fechado no código com isso** — as 4 fatias completas (0-Fundação, 1-Histórico, 2-Classificação+Precificação, 3-Exclusão). Falta só validação manual de ponta a ponta em todas.

### Módulo 6 — fatia Entrada de XML (priorizada em 2026-08-02 a pedido do usuário)

**Pedido do usuário:** dar prioridade à tela de Entrada de Nota Fiscal por XML, integrada de verdade com Contas a Pagar, Estoque, com popup automático de cadastro de fornecedor quando ele não existir, e uma tela própria de "Cadastro de Fornecedores". Depois de validado, seguir para o Módulo 4 (Produção).

**Concluído em 2026-08-02, em 2 commits:**

1. **`4f0b1f9` — Cadastro de Fornecedores.** Nova coleção `fornecedores` (já prevista nas `firestore.rules` desde o F5/F6, só faltava UI). `FornecedoresList.tsx` + `FornecedorForm.tsx` no mesmo padrão de Clientes (código, nome, telefone, e-mail, CNPJ/CPF, endereço), com `openTab()` desde o início — a lacuna corrigida na sessão anterior (F19) não se repetiu aqui. Nova entrada no menu Cadastros, reaproveitando a permissão `cadastros.estoque` (é a que as `firestore.rules` já exigem pra essa coleção, não criei uma permissão nova). Substituiu o item "Fornecedores" que só existia como mockup do roadmap em `/compras/fornecedores` (grupo "Compras", ainda não implementado) — removido de lá e do catálogo de módulos pra não duplicar o mesmo nome apontando pra duas telas diferentes.

2. **`f4f4aa1` — Integração da Entrada de XML.** A tela ([`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx)) já incrementava estoque e lançava um título em Contas a Pagar antes disso, mas com lacunas reais:
   - **Fornecedor era só texto livre**, sem vínculo a nenhum cadastro. Agora, ao ler o XML, busca o fornecedor pelo CNPJ em `fornecedores`; sem match, abre um **popup bloqueante** de cadastro rápido pré-preenchido com nome/CNPJ do XML — decisão confirmada com o usuário (via AskUserQuestion): a confirmação da importação fica desabilitada até o fornecedor existir, não dá pra pular. Itens de estoque e título(s) de Contas a Pagar passam a gravar `fornecedorId` + `fornecedorNome`.
   - **Vencimento do título usava a data de emissão da nota**, o que é logicamente errado (emissão não é a data de pagamento) — bug real, não só lacuna. Corrigido: novo parser das duplicatas (`<dup>`/`<dVenc>`/`<vDup>`) do XML — nota com parcelamento lança **um título por duplicata**, cada um com seu vencimento; sem duplicata no XML, lança um único título com vencimento padrão de emissão + 30 dias (`addDaysToDateInput`, já existente e testado desde o F15).
   - Corrigido também um typo na categoria lançada (`"FORNEDORES DE PEÇAS"` → `"FORNECEDORES DE PEÇAS"`), que agora bate com o Plano de Contas mostrado em `ContasPagar.tsx`.

Typecheck, lint e build passando limpos; suíte de 66 testes sem mudança (nenhuma lógica financeira nova além de `addDaysToDateInput`, que já tinha teste). Publicado em `dev`.

**Validado ao vivo em 2026-08-15 (ponta a ponta, junto com o F22 inteiro):** sem um XML real da SEFAZ disponível, construído um XML de nota sintético (mesma estrutura de tags que o parser exige — `emit`/`ide`/`det`/`prod`/`ICMSTot`/`cobr`/`dup`) e injetado no input de arquivo via JS (o navegador interno não tem mecanismo de upload de arquivo real; nenhuma credencial foi digitada, só simulada a seleção de um arquivo local já preparado). Nota com fornecedor novo, 2 itens novos (um pra virar Revenda, outro Matéria-Prima) e 2 duplicatas. Confirmado, cada etapa checada por consulta direta ao Firestore após a ação na tela:
- Popup de cadastro de fornecedor abriu bloqueante, pré-preenchido, confirmação ficou desabilitada até cadastrar — exatamente como documentado.
- Após confirmar: título por duplicata criado com vencimento correto (não a data de emissão), fornecedorId vinculado no produto e na matéria-prima criados, categoria "FORNECEDORES DE PEÇAS" correta.
- F22 Fatia 0 (`notas_fiscais_entrada`) gravada com itens/status/metadados corretos (de quebra, confirma o M20 nesse documento também).
- F22 Fatia 2: item novo pediu classificação (Revenda escolhida pro item 1, Matéria-Prima pro item 2); preço de venda pré-preenchido com margem de 50% (37,50 sobre custo 25,00); ao trocar pra Matéria-Prima, o painel de preço/tributação sumiu e mostrou só o aviso de custo — produto criado em `estoque` com `precoVenda`/`csosn` corretos, matéria-prima criada em `materias_primas` só com `precoCusto` (sem `precoVenda`).
- F22 Fatia 1: nota apareceu no Histórico de Entradas, ao lado de notas reais já existentes; modal de detalhe mostrou os 2 itens e os 2 títulos corretamente.
- F22 Fatia 3: excluída a nota de teste — `status` virou `'excluida'` com `motivoExclusao` gravado, quantidade do produto e da matéria-prima voltou a 0 (cadastros mantidos, não apagados), os 2 títulos foram removidos de verdade de `transacoes`.
- Dados de teste (produto, matéria-prima, fornecedor, nota) apagados do banco de dev ao final.

**M6 (Entrada de XML) e F22 (as 4 fatias) fechados — validação de ponta a ponta sem nenhum bug encontrado.**

**Deliberadamente fora do escopo desta fatia:** a listagem central de Notas Fiscais (a parte "Módulo 6" original, ver mais abaixo) não foi tocada — fica pra depois de Produção, conforme combinado.

### Módulo 18 — Cancelamentos

**Estado atual:** **em grande parte pronto.** A reformulação financeira de 19/07 já entregou estorno determinístico com `idempotencyKey`, cancelamento de venda ([`PedidoVendaForm.tsx:1159`](../src/pages/Vendas/PedidoVendaForm.tsx)) e de OS ([`OSForm.tsx:834`](../src/pages/OS/OSForm.tsx)), com comissão marcada como cancelada.

**O que falta:** auditar cobertura de "Reabrir" (existe?) e garantir que os módulos novos (produção, conferência) nasçam com as quatro operações. Este módulo vira **checklist de auditoria**, não implementação nova.

**Auditoria rodada em 2026-08-13 (agente de exploração, varredura completa de Pedido de Venda/OS/Orçamento/Devolução/Produção) achou bugs reais, não só itens de checklist — todos corrigidos em 5 fatias, cada uma com commit próprio:**
- **Fatia 1 (crítico):** o crédito lançado em `bancos/{id}.saldoCentavos` na finalização de venda/OS com pagamento digital nunca era revertido — nem ao cancelar, nem ao "reabrir" uma OS, nem ao excluir uma venda. Nova `computeBankCreditsMap` (`financeDomain.ts`) reaproveitada pra creditar e reverter. **Fixup no mesmo dia:** a reversão inicial usava o valor bruto do pagamento em vez do líquido (cartão só credita o banco na conciliação manual em `Banco.tsx`, pelo valor já descontada a taxa da administradora) — achado testando ao vivo, corrigido pra usar `transactionNetCents`.
- **Fatia 2:** Devolução de Venda deixou de ser tela separada (`/vendas/devolucoes`) e virou botão dentro da própria tela do Pedido de Venda finalizado — sem etapa de busca, já que o pedido já está carregado. Ganhou capacidade de estornar (antes era via de mão única). Módulo órfão `comercial.devolucoes` removido do catálogo (mesmo erro do `admin.backup` não repetido).
- **Fatia 3:** exclusão de Orçamento já convertido em Venda/OS agora é bloqueada (evitava `orcamentoId` órfão).
- **Fatia 4:** Ordem de Produção ganhou checagem de permissão granular nas 3 ações destrutivas (Firestore já protegia a escrita, então era inconsistência de UX, não brecha de segurança).
- **Fatia 5:** log de auditoria (`logs_sistema`) adicionado nos pontos que mexiam em estoque/financeiro sem deixar rastro (Cancelar/Excluir OS, as 3 ações de Produção).

**Achados fora do escopo do Módulo 18, resolvidos na mesma sessão a pedido do usuário:** coluna de saldo removida da listagem de Cadastros > Bancos (duplicava Financeiro > Banco).

**Validado ao vivo em 2026-08-15:** criada uma venda de teste real no PDV (ARROZ INTEGRAL 1KG, 1 un., Dinheiro — estoque 34→33 confirmado no próprio dropdown de busca do PDV) e excluída em seguida via Pedidos de Venda ("Sim, retornar estoque"). Confirmado por consulta direta no Firestore: estoque voltou exatamente a 34, e o log de auditoria (`empresas/{tenantId}/logs`) registrou os três eventos em sequência — `criar_pdv` ("Venda PDV #0016 finalizada no valor de 14.90"), `abrir_caixa`, e `exclusao` ("Pedido de Venda #0016 excluído permanentemente... Valor: R$ 14.90", `critical: true`) — com usuário e valores corretos em todos. Cobre o núcleo do módulo (exclusão com reversão de estoque + auditoria); o caso específico de reversão de crédito bancário da Fatia 1 (pagamento digital) não foi re-testado nesta rodada.

**Não faça:** não reescrever a lógica de estorno existente.

### Módulo 6 — Central de Notas Fiscais

**Estado atual:** existe emissão em [`NFE.tsx`](../src/pages/Fiscal/NFE.tsx) e entrada de XML em [`EntradaNFE.tsx`](../src/pages/Fiscal/EntradaNFE.tsx). Não existe listagem centralizada.

**Como implementar:** renomear o item de menu "Emitir Nota Fiscal" → "Notas Fiscais"; nova tela de listagem sobre a coleção `notas_fiscais` (já prevista nas `firestore.rules`) com NF, status, cliente, valor, data e ações (DANFE, WhatsApp, reenviar, cancelar). Botão "Emitir Nota Fiscal" acima da lista abre a emissão manual atual. **A emissão manual não baixa estoque** — o prompt é explícito.

**Aceite:** listagem paginada e filtrável; ações respeitam permissão (`fiscal.emitir`, `fiscal.excluir`); emissão manual não mexe em estoque nem financeiro; cancelamento registra auditoria.

**Descoberta em 2026-08-15, antes de implementar:** `NFE.tsx` já era, na prática, uma tela "listagem + modal de emissão" — tabela de notas com busca funcional, abas Todas/NF-e/NFC-e, cards de métricas, botão "+ Emitir Nota Fiscal" que abre a emissão dentro de um modal, e ações de sincronizar/retransmitir/DANFE/XML/cancelar/excluir já implementadas (excluir já tinha auditoria e gate de permissão). O módulo nunca tinha sido "batizado" como Módulo 6 nem cotejado contra o aceite. Confirmado por leitura de código que a emissão manual não baixa estoque nem mexe em financeiro (zero `applyStockAdjustments`/`runTransaction` sobre `estoque`/`transacoes` em todo o arquivo) — não precisou de mudança nesse ponto.

**Implementado em 2026-08-15 (commit pendente), fechando as 5 lacunas reais contra o aceite:**
1. Renomeado "Emitir Nota Fiscal" → "Notas Fiscais" em 4 lugares (menu `Sidebar.tsx`, título de aba `TabsContext.tsx`, catálogo SuperAdmin `moduleCatalog.ts`, `<h1>` da própria tela).
2. Paginação client-side na tabela, mesmo padrão já usado em `RelatoriosVendas.tsx` (`page`/`pageSize`, `.slice()`, seletor 10/20/50, "Página X de Y") — risco conhecido e aceito: `loadLocalInvoices` continua sem `limit()` no Firestore, então a paginação é só de UI, não reduz leitura (mesmo padrão já aceito na tela irmã `NotasFiscaisEntradaList.tsx`).
3. Botão de WhatsApp na tabela — decisão tomada durante o planejamento (revisão crítica por agente Plan): gravar `clienteId` (referência estável) nos dois pontos de escrita da nota, em vez de `clienteTelefone` (snapshot que ficaria desatualizado se o cliente trocasse de número) — telefone é resolvido em tempo de leitura via `clients.find()`, já carregado em memória. Notas emitidas antes desta mudança (sem `clienteId`) falham graciosamente ao clicar, sem quebrar a tela.
4. Gates de permissão: `canEmitirNota`/`canCancelarNota` nos botões Emitir/Retransmitir/Transformar-em-NFe/Cancelar. **Limitação conhecida:** `routeAccess.ts` já exige `fiscal.emitir` só pra abrir a rota inteira (prefix-match single-permission), então o gate de emitir no componente é redundante na prática — o gate que fecha uma lacuna real é o de Cancelar (`fiscal.excluir`), que antes não existia. Um perfil "só cancela, nunca emite" não é possível hoje sem alterar a arquitetura de permissão por rota — fora de escopo, registrado como pendência futura.
5. `createAuditLog` adicionado dentro de `handleCancel` (só `handleDeleteInvoice` tinha antes), mesmo padrão já usado ali.

Typecheck/lint (0 erros, 1 aviso pré-existente sem relação)/133 testes/build todos limpos.

**Validado ao vivo em 2026-08-15 (sessão seguinte), fechando o módulo por completo.** Bloqueio real encontrado e corrigido no caminho: o tenant de dev tinha `spedyEnabled:true` mas sem `spedyApiKey`, e mesmo depois do usuário configurar a chave sandbox (achada em Minha Empresa → Credenciais da API no painel da Spedy) e salvar várias vezes, a tela continuava em "Módulo Fiscal Desativado". **Causa raiz: `NFE.tsx` não lê a chave do Firestore no navegador — busca via backend (`spedyService.getRuntimeConfig()` → `/api/spedy/config`), por design de segurança explícito no código ("para nao expor a chave Spedy no navegador"), e o backend Express local (`server/server.js`, porta 3001) simplesmente não estava rodando** nesta sessão (só o frontend Vite tinha sido iniciado). Chave e config estavam salvas corretamente o tempo todo (confirmado lendo `configuracoes_privadas/{tenantId}` — a chave pública em `configuracoes` é deliberadamente removida via `deleteField()` no save, outro detalhe do mesmo design de segurança). **Subir o backend resolveu na hora.** Vale lembrar em qualquer sessão futura que mexer em Notas Fiscais/Spedy: rodar `node server/server.js` (ou equivalente) além do `npm run dev`, senão a tela trava permanentemente em "desativado" mesmo com tudo certo no banco.

Validação com 23 notas fiscais sintéticas criadas direto no Firestore (mesma técnica do XML sintético do F22 — não passa pela API real da Spedy, que rejeitaria `spedyId`s falsos): paginação confirmada (20/página, "Página 1 de 2", botões anterior/próxima funcionando); WhatsApp confirmado nos dois caminhos (cliente sem telefone → erro gracioso "Telefone indisponível"; cliente com telefone → URL exata interceptada via spy em `window.open`, número e mensagem corretos); tentativa de Cancelar numa nota sintética falhou como esperado ("Erro ao comunicar com a Spedy", porque o `spedyId` de teste não existe lá — a chamada real bloqueia antes do `updateDoc`/auditoria, então não dá pra testar esse caminho específico sem uma nota real); auditoria confirmada via Excluir (não depende da Spedy, mesmo mecanismo `createAuditLog` que o Cancelar agora usa) — log gravado certo em `empresas/{tenantId}/logs` com `acao:'exclusao'`, `critical:true`. Dados de teste apagados ao final (23 notas sintéticas); log de auditoria do teste de exclusão mantido (auditoria não se apaga, é registro permanente por design).

### Módulo 15 — Relatórios padronizados

**Estado atual:** filtros, CSV, paginação, ordenação e impressão já existem em [`RelatoriosVendas.tsx`](../src/pages/Vendas/RelatoriosVendas.tsx) e [`RelatorioComissoes.tsx`](../src/pages/Financeiro/RelatorioComissoes.tsx). **Faltam PDF e Excel.**

**Como implementar:** extrair o padrão dos relatórios existentes para componentes compartilhados em `src/components/Reports/`. Para PDF, avaliar usar a impressão do navegador (já usada nas telas de print) antes de adicionar dependência. Para Excel, preferir CSV com encoding correto se atender — **evitar adicionar biblioteca pesada** ao bundle sem necessidade (o vendor já tem 410 KB).

**Decisão pendente:** confirmar com o usuário se "Excel" exige `.xlsx` real ou se CSV resolve.

---

## 5. Fase 3 — Estrutural (risco alto, exige modelagem)

Ordem obrigatória original: **13 → 12 → 4 → 16**. **Duas exceções já registradas, com justificativa na seção de cada módulo:** o Módulo 4 foi desbloqueado em 2026-08-02 (matéria-prima é pool separado) e o Módulo 12 em 2026-08-18 (conferência é checagem física pós-venda, não operação de estoque). O 16 continua dependendo de 4 e 12.

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

**Decisão de fatiamento (2026-08-14):** dado o tamanho e o risco (mexe em 7 pontos de transação em 5 telas diferentes — PDV, OS, Orçamento, Pedido de Venda, Devolução), o usuário pediu para fatiar o módulo e começar só pela fundação. Investigação prévia mostrou que `Reservar no Pedido` não tem hoje um encaixe natural em Vendas/PDV (esses fluxos nascem `Finalizada` direto, sem estado de rascunho) — só a OS tem uma janela natural (criada → peças → Finalizada). Fatias seguintes (fora deste registro) vão ligar um fluxo real de cada vez.

**Fatia 0/N concluída em 2026-08-14 — Fundação (config + funções puras, zero mudança de comportamento):** novo `src/utils/estoqueReservaDomain.ts` com `MomentoBaixaEstoque` (`'imediato' | 'pedido' | 'caixa' | 'nf'`, default `'imediato'`) e `computeAvailableStock(quantidade, quantidadeReservada)`. Novo setting "Momento da Baixa de Estoque" em Configurações Avançadas (`Configuracoes.tsx`), mesmo padrão do `regimeTributario` (fallback `??` na leitura, então tenants existentes caem no default sem migração). **Deliberadamente não tocado nesta fatia:** `EstoqueForm.tsx` (o campo `quantidadeReservada` não é escrito em lugar nenhum ainda — colocá-lo no formulário do produto abriria risco de um `updateDoc` do cadastro sobrescrever com `0` uma reserva real que uma fatia futura venha a gravar por transação), `firestoreAtomic.ts` e nenhuma tela de venda/OS/PDV/Devolução. 10 testes novos em `tests/estoqueReservaDomain.test.ts` (registrados nas duas listas de `scripts/run-finance-domain-tests.mjs`), incluindo um guard-rail que quebra se alguém trocar o default de `'imediato'` por engano. Validado ao vivo: tenant novo abre o select já em "Baixar imediatamente (padrão)" sem salvar nada; trocado para "Reservar no Pedido" e salvo, uma venda completa (Pedido de Venda) com esse valor não-padrão selecionado decrementou o estoque exatamente como antes (50 → 49 unidades) e **nenhum campo `quantidadeReservada` foi escrito no documento** — confirma que a config ainda não é lida em lugar nenhum. Typecheck/lint (0 erros, 66 warnings pré-existentes)/build/102 testes passando. `git diff --stat` restrito aos arquivos esperados (`Configuracoes.tsx`, `run-finance-domain-tests.mjs`, os 2 arquivos novos) — nenhuma linha tocada em `firestoreAtomic.ts` ou nas telas de venda/OS/PDV.

**Fatia 1/N concluída em 2026-08-14 — Reserva na OS, ponta a ponta:** liga o modo `'pedido'` só na Ordem de Serviço (única tela com estado "criada, ainda não finalizada" — Pedido de Venda/PDV nascem `Finalizada` direto). Novo campo `estoqueReservado: boolean` no doc de OS (espelha `estoqueBaixado`). Ao salvar uma OS aberta em modo `'pedido'`, reconcilia a reserva com a lista atual de peças (`computeReservationDelta`, só mexe em `quantidadeReservada`); ao Finalizar, converte a reserva em baixa real numa única operação (`computeReservationCommit` — libera a reserva anterior e debita o que foi commitado, mesmo se a lista de peças mudou no mesmo save); ao Cancelar uma OS que só tinha reserva, libera sem popup (nada saiu do estoque de verdade); ao cancelar uma OS que já tinha baixa REAL, mantém o popup "Retornar Estoque?" de sempre e devolve via `computeReservationReturn`. Reabrir uma OS Finalizada não cria reserva fantasma (pulado quando a OS já tem baixa real, mesma paridade do comportamento de hoje). Nova função aditiva `applyStockFieldDeltas` em `firestoreAtomic.ts` — `applyStockAdjustments` não foi tocada, PDV/Pedido de Venda/Orçamento/Devolução continuam 100% no código de sempre. `OSList.tsx` (`handleDeleteOS`) virou `runTransaction` pra liberar qualquer reserva pendente antes de excluir (evita reserva órfã; o bug pré-existente de excluir uma OS com baixa REAL sem devolver estoque não foi tocado — fora de escopo). `EstoqueForm.tsx` ganhou um campo somente-leitura "Disponível" (só aparece quando há algo reservado). Reservar além do disponível usa o mesmo toggle `permitirVendaSemEstoque` de sempre (decisão confirmada com o usuário, não criou config nova). Revisão crítica por agente Plan antes de implementar encontrou e corrigiu 3 problemas de desenho: (1) nunca encadear duas funções de leitura+escrita de estoque na mesma transação (Firestore exige todas as leituras antes de qualquer escrita, na transação inteira, não só por documento); (2) reabrir uma OS Finalizada não pode criar reserva sobre estoque já debitado; (3) cancelar uma OS com baixa real precisa do fluxo de devolução real, não só liberar reserva. 14 testes novos em `tests/estoqueReservaDomain.test.ts` (102→115). Validado ao vivo, os 8 cenários da fatia: reservar sem mexer em `quantidade`; liberar ao remover peça; converter reserva em baixa real ao finalizar (50→49un, reservada zera); reabrir Finalizada não cria reserva fantasma + cancelar com baixa real mostra o popup e devolve (49→50un); cancelar OS só-reservada libera sem popup; excluir OS libera reserva pendente antes de deletar; `permitirVendaSemEstoque` desligado bloqueia sobre-reserva ("Estoque insuficiente para reservar... Disponivel: 5"), ligado permite. **Limitação conhecida e documentada:** a reserva desta fatia é best-effort só entre saves da mesma OS — PDV/Pedido/Orçamento/Devolução ainda não consultam `quantidadeReservada`, então uma peça reservada por uma OS ainda pode ser vendida por outro canal até uma fatia futura fechar essa proteção cruzada. Typecheck/lint (0 erros, 66 warnings pré-existentes)/build/115 testes passando. `git diff --stat` restrito aos arquivos esperados.

### Módulo 12 — Conferência de mercadoria

**Especificado em detalhe em 2026-08-18**, a partir de três áudios do usuário (transcritos na sessão). O desenho visual do fluxo, com a justificativa de cada decisão, está publicado em <https://claude.ai/code/artifact/93d76503-0c06-417c-87b8-93e963939c76>. Esta seção é a fonte da verdade para a implementação; o artefato é o material de apoio.

**Estado atual (confirmado por leitura em 2026-08-18):**

- Não existe nenhuma tela de conferência. `operacoes.expedicao` já está catalogado em [`moduleCatalog.ts:82`](../src/utils/moduleCatalog.ts) e o menu lateral já tem o item ([`Sidebar.tsx:279`](../src/components/layout/Sidebar.tsx)), mas apontando para o grupo roadmap `operacoesDev` → `/operacoes/expedicao` → `RoadmapModule` (mockup "Em breve", [`RoadmapModule.tsx:197`](../src/pages/Roadmap/RoadmapModule.tsx)).
- **Não existe** branch de `operacoes.expedicao` em [`routeAccess.ts`](../src/utils/routeAccess.ts) — nem `routeModule` nem `routePermission`. Sem isso a tela fica acessível por URL direta (mesma armadilha da auditoria 2026-08-05).
- Coleções `expedicoes` e `entregas` já estão nas quatro listas das `firestore.rules` (read/create/update/delete), mas penduradas em `cadastros.estoque` — exatamente o que a orientação abaixo manda corrigir.
- **Peças que já existem e devem ser reaproveitadas, não recriadas:** `codigoBarras` e `localizacaoEstoque` ("Corredor, prateleira, gaveta") já são campos reais do produto ([`EstoqueForm.tsx:1120` e `:1301`](../src/pages/Estoque/EstoqueForm.tsx)); a busca por código de barras já está pronta em [`productSearch.ts:32`](../src/utils/productSearch.ts) (`CODE_FIELDS`); o popup de finalização da venda já é um `NexusSwal` de três botões em [`PedidoVendaForm.tsx:783`](../src/pages/Vendas/PedidoVendaForm.tsx); o padrão de documento de impressão é [`PedidoPrintDocument.tsx`](../src/pages/Vendas/PedidoPrintDocument.tsx).

**Decisão de desbloqueio (2026-08-18): o Módulo 12 NÃO depende do Módulo 13.** A "ordem obrigatória 13 → 12" do início da Seção 5 foi pensada quando se imaginava conferência sobre estoque reservado. O fluxo que o usuário descreveu é **pós-venda**: a venda já foi finalizada e o estoque já foi debitado (`applyStockAdjustments`, default `'imediato'`). A conferência aqui é uma **checagem física de separação**, não uma operação de estoque — não lê nem escreve `quantidade`/`quantidadeReservada` em lugar nenhum. Mesmo raciocínio que desbloqueou o Módulo 4 em 2026-08-02.

**Escopo desta rodada:** só a conferência (`Pedido → Aguardando → Em conferência → Conferido | Divergente`). **Fora de escopo, adiado:** "Aguardando Expedição → Entrega → Finalizado", rastreio, romaneio de carga e a coleção `entregas` — o usuário não pediu isso nos áudios, e o fluxo de conferência entrega valor sozinho.

#### Decisões de arquitetura (não reabrir)

1. **O status nasce com a venda, não com o pop-up de impressão.** Este é o ponto central e o único lugar onde o desenho diverge do que o usuário descreveu nos áudios (divergência intencional, já explicada a ele). Se o status dependesse do clique em "imprimir minuta", um "não" acidental deixaria o pedido fora da conferência para sempre, silenciosamente. Com a chave ligada, `pedidoData` nasce com `statusConferencia: 'aguardando'` e o pedido aparece na fila com papel ou sem papel.
2. **Custo zero na transação da venda.** A única mudança em [`PedidoVendaForm.tsx:669`](../src/pages/Vendas/PedidoVendaForm.tsx) é **um campo a mais** no objeto `pedidoData` que já está sendo escrito. Nenhuma leitura nova, nenhum documento novo, nenhuma escrita nova dentro da `runTransaction`. O documento de conferência é criado depois, preguiçosamente, quando alguém abre o pedido na tela.
3. **`expedicoes/{pedidoId}` — id determinístico.** O documento de conferência usa o próprio id do pedido como id do documento. Idempotência natural (dois funcionários abrindo ao mesmo tempo não criam dois documentos), no mesmo espírito do `idempotencyKey` da Seção 1.4.
4. **Não mexer no formato de `itens` do pedido.** `item.id` já é o `produtoId` (é o que `applyStockAdjustments` usa em [`PedidoVendaForm.tsx:650`](../src/pages/Vendas/PedidoVendaForm.tsx)). A minuta e a tela de conferência buscam `estoque/{item.id}` para obter `localizacaoEstoque` e `codigoBarras`. Não snapshotar esses campos dentro do item na hora da venda — seria mexer no núcleo transacional para ganhar nada.
5. **Multiplicador é comportamento de tela, não configuração.** O usuário sugeriu uma config "bipar 1 conta os 10". Recusado, e o motivo está registrado: um bipe acidental fecharia a linha inteira e a conferência deixaria de conferir. O padrão implementado é digitar a quantidade **antes** de bipar (teclar `10`, depois bipar → lança 10), com o multiplicador zerando a cada leitura.
6. **A trava de bipagem tem válvula de escape.** `exigirBipagem` bloqueia lançamento manual **apenas em produtos que têm `codigoBarras` preenchido**. Produto sem EAN sempre aceita manual. Sem isso, o funcionário fica preso num item que tem na mão, e a saída dele vai ser desligar a trava para todo mundo.
7. **`divergente` é desfecho legítimo, não erro.** Guardar quantidade pedida × conferida por item, sem apagar histórico, e permitir reabrir.

#### Modelo de dados

Campos **novos e opcionais** em `pedidos_venda/{id}` (documentos existentes não migram; leitura sempre com fallback `??`):

| Campo | Tipo | Observação |
|---|---|---|
| `statusConferencia` | `'aguardando' \| 'em_conferencia' \| 'conferido' \| 'divergente'` | Ausente = tenant não usa conferência, ou venda anterior ao módulo |
| `conferidoPor` / `conferidoPorNome` | `string` | Auditoria — quem fechou |
| `conferidoEm` | `Timestamp` | Auditoria — quando |

Documento `expedicoes/{pedidoId}` (criado no primeiro "abrir conferência"):

```
tenantId, pedidoId, numeroPedido, clienteNome,
status: 'em_conferencia' | 'conferido' | 'divergente',
itens: [{ produtoId, codigo, codigoBarras, nome, localizacaoEstoque,
          quantidadePedida, quantidadeConferida }],
abertoPor, abertoPorNome, abertoEm,
conferidoPor, conferidoPorNome, conferidoEm,
observacao,
historico: [{ de, para, em, usuarioId, usuarioNome }],
createdAt, ...buildDocumentMetadata(...)
```

A **fila** é uma query direta em `pedidos_venda` por `tenantId` + `statusConferencia` — não depende de `expedicoes` existir.

#### Configurações (em `configuracoes/{tenantId}`, via `Configuracoes.tsx`)

Mesmo padrão de leitura com fallback `??` já usado em `regimeTributario` e `momentoBaixaEstoque` — tenants existentes caem no default sem migração.

| Flag | Default | O que faz |
|---|---|---|
| `conferenciaMercadoria` | `false` | Chave-mestra. Desligada, nenhuma venda ganha `statusConferencia` e nada do módulo aparece. **Default desligado é obrigatório** — ligar por padrão criaria status pendente em todo tenant que não usa separação |
| `imprimirMinutaAposVenda` | `true` | Mostra o pop-up da minuta depois do pop-up de recibo/NFC-e |
| `exigirBipagem` | `true` | Bloqueia manual **só** em produto com `codigoBarras` (ver decisão 6) |
| `bloquearExcedente` | `true` | Recusa conferir acima do pedido e item fora do pedido |
| `ordenarMinutaPorLocal` | `true` | Ordena a minuta por `localizacaoEstoque` — vira rota de separação |

#### Permissão e regras do Firestore

Permissão nova `operacoes.expedicao` (não pendurar em `cadastros.estoque`). Precisa entrar nos **quatro** lugares, senão o gate não existe de verdade:

1. [`moduleCatalog.ts`](../src/utils/moduleCatalog.ts) — já está lá (`operacoes.expedicao`), nada a fazer.
2. Catálogo granular embutido em [`Configuracoes.tsx:1597`](../src/pages/Configuracoes/Configuracoes.tsx) — **falta**, adicionar `{ id: 'operacoes.expedicao', label: 'Expedição: Conferência de Mercadoria', color: '#14b8a6' }`.
3. [`routeAccess.ts`](../src/utils/routeAccess.ts) — **falta**, adicionar branch nos **dois** blocos (`routeModule` e `routePermission`) para `/operacoes/expedicao` e `/operacoes/conferencia`. Cuidado com a ordem: o `else if` genérico de `/operacoes` não pode engolir o específico (mesmo bug de fallthrough que atingiu `/financeiro/banco` na auditoria de 2026-08-05).
4. `firestore.rules` — tirar `'expedicoes'` do balaio de `cadastros.estoque` em `canWriteTenantCollection` **e** `canDeleteTenantCollection`, e dar cláusula própria: `(collectionName == 'expedicoes' && hasPermission('operacoes.expedicao'))`. As quatro listas de allow (read/create/update/delete) já contêm `'expedicoes'` — não precisa mexer nelas.

**⚠ Armadilha que só aparece em runtime:** a tela de conferência escreve `statusConferencia` em `pedidos_venda`, e essa coleção exige `vendas.pedidos`/`vendas.alterar`. Um separador de estoque que só tenha `operacoes.expedicao` vai tomar `permission-denied` ao fechar a conferência. Resolver na regra, liberando **apenas os campos da conferência** — não dar `vendas.alterar` ao estoque:

```
(collectionName == 'pedidos_venda' && hasPermission('operacoes.expedicao') &&
 request.resource.data.diff(resource.data).affectedKeys()
   .hasOnly(['statusConferencia','conferidoPor','conferidoPorNome','conferidoEm','alteradoPor','alteradoEm']))
```

Toda regra nova precisa de `firebase deploy --only firestore:rules --project sistema-nexus-dev` (CLI via `npx`, ver memória do projeto) — sem isso a tela funciona no código e falha no banco.

#### Fatiamento

Quatro fatias, commit próprio cada uma, na ordem. Cada fatia entrega valor sozinha.

**Fatia 0/4 — Fundação (zero mudança de comportamento visível).**
Novo `src/utils/conferenciaDomain.ts` com as funções puras, todas testadas em `tests/conferenciaDomain.test.ts` (registrar nas duas listas de `scripts/run-finance-domain-tests.mjs`):
- `StatusConferencia` + `canTransition(de, para)` — máquina de estados explícita.
- `aplicarBipagem(itens, codigo, multiplicador, opts)` → `{ itens, resultado }` com `resultado` em `'ok' | 'nao_encontrado' | 'excedente' | 'bloqueado_manual'`.
- `computeStatusFinal(itens)` → `'conferido'` se toda `quantidadeConferida === quantidadePedida`, senão `'divergente'`.
- `ordenarPorLocalizacao(itens)` — itens sem localização vão para o fim, não para o começo.
- `podeLancarManual(item, exigirBipagem)` — encapsula a decisão 6.
As cinco flags em `Configuracoes.tsx`, a permissão nos itens 2/3/4 acima, e o deploy da regra. **Guard-rail obrigatório no teste:** um caso que quebra se alguém trocar o default de `conferenciaMercadoria` para `true` (mesmo padrão do teste de `momentoBaixaEstoque` na Fatia 0 do M13).

**Fatia 1/4 — Status nasce na venda.**
Um campo a mais em `pedidoData` ([`PedidoVendaForm.tsx:669`](../src/pages/Vendas/PedidoVendaForm.tsx)), condicionado à chave-mestra. Coluna/badge de conferência em [`PedidoVendas.tsx`](../src/pages/Vendas/PedidoVendas.tsx), visível só com a chave ligada. Nada de tela nova ainda — o objetivo é provar que o dado nasce certo e que tenant sem a chave não vê diferença nenhuma. **Verificar no Firestore** que uma venda com a chave desligada não grava o campo.

**Fatia 2/4 — Minuta de entrega.**
`src/pages/Expedicao/MinutaPrint.tsx` + `MinutaPrintDocument.tsx`, clonando o padrão de `PedidoPrintDocument.tsx`. Rota `expedicao/minuta/:pedidoId`. Busca `estoque/{item.id}` para `localizacaoEstoque`/`codigoBarras`, ordena conforme `ordenarMinutaPorLocal`. **Sem valores, sem preço, sem total em dinheiro** — só local, código, produto e quantidade, mais rodapé de assinatura ("Separado por" / "Conferido por"). Número do pedido impresso **também como código de barras** (o conferente bipa a própria folha para abrir o pedido na Fatia 4). Pop-up novo em `PedidoVendaForm.tsx`, encadeado **depois** do fluxo de recibo/NFC-e já existente — não substituir nem reorganizar o `NexusSwal` atual, só acrescentar uma etapa.

**Fatia 3/4 — Fila de Expedição.**
`src/pages/Expedicao/FilaExpedicao.tsx`, rota real `operacoes/expedicao` (declarada **antes** do curinga `operacoes/:moduleId` em [`appRoutesConfig.tsx:150`](../src/routes/appRoutesConfig.tsx), senão cai no `RoadmapModule`). Lista pedidos por `statusConferencia`, com filtro por status e busca por número/cliente. Botão de reimprimir minuta. Mover o item "Expedição e Entregas" do grupo roadmap `operacoesDev` para um grupo real no `Sidebar.tsx` — mesmo movimento que a Fatia 2 do M4 fez com "Produção Interna".

**Fatia 4/4 — Tela de conferência (fecha o módulo).**
`src/pages/Expedicao/ConferenciaForm.tsx`, rota `operacoes/conferencia/:pedidoId`. Abre (ou cria) `expedicoes/{pedidoId}`, marca `em_conferencia`, mostra os itens com pedido × conferido. Campo único de leitura que aceita EAN bipado ou digitado, com multiplicador prefixado (decisão 5). Feedback imediato e distinto para `nao_encontrado` e `excedente` — visual **e** sonoro (o separador não está olhando para a tela). Lançamento manual respeitando `podeLancarManual`. Fechar chama `computeStatusFinal`, grava nas duas pontas (`expedicoes` + os campos de auditoria em `pedidos_venda`) e emite o relatório final **destacando as divergências**. `createAuditLog` em cada transição com `valorAnterior`/`valorNovo` (Seção 1.4).

#### Arquivos afetados

Criados: `src/utils/conferenciaDomain.ts`, `tests/conferenciaDomain.test.ts`, `src/pages/Expedicao/` (`FilaExpedicao.tsx`, `ConferenciaForm.tsx`, `MinutaPrint.tsx`, `MinutaPrintDocument.tsx`).
Alterados: `Configuracoes.tsx` (flags + catálogo de permissão), `routeAccess.ts`, `appRoutesConfig.tsx`, `Sidebar.tsx`, `PedidoVendaForm.tsx` (um campo + um pop-up), `PedidoVendas.tsx` (coluna), `firestore.rules`, `scripts/run-finance-domain-tests.mjs`.
**Risco de regressão concentrado em `PedidoVendaForm.tsx`** — é o arquivo mais crítico do sistema e o único ponto onde este módulo toca código transacional existente. Conferir `git diff` desse arquivo linha a linha antes de commitar.

#### Critério de aceite

1. Tenant com `conferenciaMercadoria` desligado: nenhuma diferença visível em lugar nenhum, e venda finalizada **não** grava `statusConferencia` (conferir no Firestore).
2. Com a chave ligada: venda finalizada nasce `aguardando` e aparece na fila sem ninguém imprimir nada.
3. Minuta imprime sem nenhum valor monetário, ordenada por localização.
4. Bipar item fora do pedido é recusado com aviso; bipar além da quantidade é recusado com `bloquearExcedente` ligado.
5. Produto sem `codigoBarras` aceita lançamento manual mesmo com `exigirBipagem` ligado.
6. Conferência parcial fecha como `divergente`, com pedido × conferido preservado por item, e pode ser reaberta.
7. Usuário só com `operacoes.expedicao` consegue fechar uma conferência (prova real da regra de `affectedKeys`) e **não** consegue editar o resto do pedido.
8. Typecheck, lint (sem warnings novos), build e a suíte de testes passando.

#### Não faça

- Não ligar a chave-mestra por padrão.
- Não criar dashboard separado de expedição (Módulo 16 estende o `Dashboard.tsx` existente).
- Não mexer em `quantidade`/`quantidadeReservada` — conferência não é operação de estoque (decisão de desbloqueio acima).
- Não dar `vendas.alterar` ao separador para resolver o `permission-denied`; usar a regra por campo.
- Não trocar o nome "minuta" por outro termo — o cliente do usuário já usa essa palavra no dia a dia.
- Não implementar entrega/rastreio/`entregas` nesta rodada.

**Atenção de permissão (orientação geral, mantida):** as coleções hoje estão todas atrás de `cadastros.estoque`. Módulos novos precisam de **permissões próprias** em [`moduleCatalog.ts`](../src/utils/moduleCatalog.ts) e nas `firestore.rules` — não pendurar em `cadastros.estoque`.

**Fatia 0/4 concluída em 2026-08-18 — Fundação (commit `5ec63e4`):** novo `src/utils/conferenciaDomain.ts` com as 5 funções puras (`canTransition`, `aplicarBipagem`, `computeStatusFinal`, `ordenarPorLocalizacao`, `podeLancarManual`) e os 5 defaults de configuração — 29 testes novos em `tests/conferenciaDomain.test.ts` (152→181), incluindo o guard-rail que quebra se `DEFAULT_CONFERENCIA_MERCADORIA` virar `true` por engano. As 5 flags entraram em `Configuracoes.tsx` (Configurações Avançadas), lendo com fallback `??` no mesmo padrão de `momentoBaixaEstoque` — a UI das 4 sub-opções só aparece quando a chave-mestra está marcada. `operacoes.expedicao` entrou no catálogo granular de permissão do Funcionário (já existia em `moduleCatalog.ts` desde antes). `routeAccess.ts` ganhou as branches que faltavam para `/operacoes/expedicao` e `/operacoes/conferencia` (routeModule e routePermission) — antes dessa fatia essas rotas não tinham gate real nenhum. `firestore.rules`: `expedicoes` saiu do balaio de `cadastros.estoque` e ganhou cláusula própria; nova função `canCloseConferenciaOnPedido()` (mesmo padrão de `canAdjustStockQuantity()`, com isolamento de tenant) libera update de `pedidos_venda` restrito aos campos de conferência, resolvendo a armadilha de permissão já prevista na especificação — **regra implantada em `sistema-nexus-dev`** no mesmo dia. `git diff --stat` restrito aos arquivos esperados; `PedidoVendaForm.tsx` deliberadamente não tocado (é a Fatia 1). Typecheck/lint (0 erros, 66 warnings pré-existentes)/build/181 testes passando. **Falta validação manual** (mesma limitação de sempre — login é ação do usuário).

**Fatia 1/4 concluída em 2026-08-18 — Status nasce na venda (commit `6983f2a`):** `PedidoVendaForm.tsx` ganhou um `useState` (`conferenciaMercadoriaAtiva`) lido no mesmo `getDoc(configuracoes/{tenantId})` que já buscava `venderSemEstoque`/`buscaProdutoModo` — nenhuma leitura nova no Firestore. Dentro do objeto `pedidoData` (linha ~669, já existente), um único spread condicional `...(conferenciaMercadoriaAtiva ? { statusConferencia: 'aguardando' } : {})` — Firestore rejeita `undefined` como valor de campo, então "não gravar" é literalmente não incluir a chave no objeto, não gravar `null`/`undefined`. **Zero leitura nova, zero escrita nova dentro da `runTransaction`**, exatamente como a decisão de arquitetura 2 exige. `PedidoVendas.tsx` ganhou uma coluna "Conferência" (cabeçalho, célula com badge colorido, `colSpan` dos estados vazio/carregando ajustado) — **só renderiza quando a config está ligada**, lida via `getDoc` próprio (tenant sem a chave nunca vê a coluna). Mapas `CONFERENCIA_STATUS_LABELS`/`CONFERENCIA_STATUS_COLORS` já cobrem os 4 estados (`aguardando`/`em_conferencia`/`conferido`/`divergente`) para as Fatias 3/4 não precisarem voltar neste arquivo. Nenhuma regra do Firestore mudou nesta fatia (a escrita de `pedidos_venda` já usava `vendas.pedidos`, permissão que a tela de Pedido de Venda já tinha). `git diff --stat` restrito a `PedidoVendaForm.tsx` (9 linhas) e `PedidoVendas.tsx` (46 linhas). Typecheck/lint (0 erros, 66 warnings, nenhum novo)/build/181 testes passando. **Falta validação manual, em particular o item 1 do critério de aceite** (conferir no Firestore que uma venda com a chave desligada realmente não grava `statusConferencia`) — mesma limitação de sempre.

**Fatia 2/4 concluída em 2026-08-18 — Minuta de entrega, com duas correções deliberadas ao texto original desta seção (justificadas abaixo):**

- **Rota corrigida para `operacoes/expedicao/minuta/:pedidoId`** (a redação original desta seção dizia `expedicao/minuta/:pedidoId`, sem o prefixo `operacoes/`). Achado ao implementar: um prefixo `/expedicao/*` teria ficado **sem gate nenhum** em `routeAccess.ts` — a Fatia 0 só cobriu `/operacoes/expedicao` e `/operacoes/conferencia`, exatamente o padrão de bug que a auditoria de 2026-08-05 já tinha corrigido em outras rotas. Aninhar sob `/operacoes/expedicao/...` reaproveita a branch que já existe desde a Fatia 0, sem precisar de outra branch nova nem risco de esquecer. `src/routes/appRoutesConfig.tsx` ganhou a rota (declarada antes do curinga `operacoes/:moduleId`, embora não fosse estritamente necessário — `operacoes/:moduleId` só casa com 2 segmentos, não com 4).
- **Código de barras do número do pedido, adiado.** O texto original pedia o número do pedido impresso "também como código de barras" na minuta. Não implementado nesta fatia: o projeto não tem nenhuma biblioteca de código de barras (conjunto de dependências deliberadamente enxuto — ver `package.json`), e um encoder Code128 escrito à mão não tem como ser validado neste ambiente (sem leitor físico, sem biblioteca de referência pra conferir a tabela de padrões). Pesquisado via `WebFetch` — a fonte só devolveu uma amostra resumida da tabela completa, insuficiente pra garantir uma implementação correta sem risco de gerar um código visualmente plausível mas que não decodifica de verdade. Como esse recurso só é consumido na Fatia 4 (bipar a própria folha pra abrir o pedido), e a Fatia 4 já aceita digitar o número manualmente como alternativa, adiar não bloqueia nada. **Recomendação para quando for implementar:** instalar uma biblioteca auditada (ex. `jsbarcode`) em vez de reimplementar o encoder — é a única forma de ter confiança real sem hardware de teste.
- `src/pages/Expedicao/MinutaPrintDocument.tsx` (layout, clonado de `PedidoPrintDocument.tsx`, sem nenhum campo monetário) + `MinutaPrint.tsx` (busca o pedido, enriquece cada item com `estoque/{item.id}` para `codigo`/`localizacaoEstoque`, ordena conforme `ordenarMinutaPorLocal`).
- `ordenarPorLocalizacao` (Fatia 0) generalizada pra aceitar qualquer item com `localizacaoEstoque` (antes presa a `ConferenciaItem`) — a minuta usa um shape mais enxuto que a futura tela de conferência (Fatia 4), e forçar um cast unsafe pra reaproveitar a função seria pior que generalizá-la. 1 teste novo confirma a genericidade (181→182).
- `PedidoVendaForm.tsx`: pop-up novo (`askMinutaAndNavigate`) encadeado nos **5 pontos de saída** do fluxo de recibo/NFC-e já existente (sucesso NFC-e, erro NFC-e com/sem fallback de recibo, Imprimir Recibo, Apenas Concluir) — nenhum desses branches foi reorganizado, só passou a chamar o helper novo em vez de `navigate` direto. Se o usuário confirmar a minuta, ela vira o destino final da navegação (prioriza a minuta sobre o recibo se as duas fossem pedidas na mesma finalização — ambos continuam reimprimíveis depois pela lista/fila, então não é uma perda real).
- `git diff --stat`: `PedidoVendaForm.tsx`, `appRoutesConfig.tsx`, `conferenciaDomain.ts`, `tests/conferenciaDomain.test.ts` alterados; `src/pages/Expedicao/` novo. Nenhuma regra do Firestore mudou.
- Typecheck/lint (0 erros, 66 warnings, nenhum novo)/build (chunk `MinutaPrint` gerado)/182 testes passando. **Falta validação manual** (mesma limitação de sempre).

**Fatia 3/4 concluída em 2026-08-18 — Fila de Expedição:** `src/pages/Expedicao/FilaExpedicao.tsx` (mesmo padrão visual de `OrdensProducaoList.tsx` — filtro por status em botões, busca por número/cliente, tabela). Lê `pedidos_venda` por `tenantId` (mesmo padrão de `PedidoVendas.tsx`) e filtra no cliente por `statusConferencia` truthy — pedido sem o campo (tenant sem a chave, ou venda anterior ao módulo) nunca aparece na fila; nenhum índice novo do Firestore necessário. Botão "Reimprimir Minuta" por linha, navega pra rota da Fatia 2. **Deliberadamente sem abrir a tela de conferência ao clicar na linha** — essa tela é a Fatia 4, ainda não existe; abrir algo inexistente cairia no `RoadmapModule` e confundiria mais que ajudaria.

Rota `operacoes/expedicao` registrada em `appRoutesConfig.tsx` (antes do curinga `operacoes/:moduleId`), substituindo o mockup `RoadmapModule` que respondia por ali. `Sidebar.tsx`: item "Expedição e Entregas" saiu do grupo roadmap `operacoesDev` (que agora só tem "Lotes e Validades") e virou grupo real "Expedição" → "Conferência de Mercadoria", com `module`/`permission` `operacoes.expedicao` — mesmo movimento que a Fatia 2 do M4 fez com "Produção Interna" em 2026-08-02.

`git diff --stat`: `Sidebar.tsx`, `appRoutesConfig.tsx` alterados; `FilaExpedicao.tsx` novo. Nenhuma regra do Firestore mudou. Typecheck/lint (0 erros, 66 warnings, nenhum novo)/build (chunk `FilaExpedicao` gerado)/182 testes passando. **Falta validação manual** (mesma limitação de sempre).

**Fatia 4/4 concluída em 2026-08-18 — Tela de conferência, fechando o Módulo 12 no código:**

- `src/pages/Expedicao/ConferenciaForm.tsx`, rota `operacoes/conferencia/:pedidoId` (já coberta pelo gate de `routeAccess.ts` desde a Fatia 0, nenhuma branch nova). Abrir a tela roda uma `runTransaction` (toca `expedicoes` + `pedidos_venda`, regra da Seção 1.4) que cria `expedicoes/{pedidoId}` na primeira vez (enriquecendo os itens via `estoque/{id}` fora da transação, mesmo padrão da Fatia 2) ou reabre uma conferência `conferido`/`divergente` — se já está `em_conferencia`, só carrega, sem escrita nem entrada de histórico nova (evita spam de auditoria a cada revisita da tela).
- Campo único de leitura (aceita EAN bipado ou digitado) + campo de quantidade prefixado, exatamente a decisão 5: o multiplicador zera a cada leitura confirmada. Chama `aplicarBipagem` da Fatia 0 a cada confirmação.
- Feedback visual (banner colorido, ícone) **e sonoro** — Web Audio API pura (osciladores, sem arquivo de áudio nem biblioteca nova): `nao_encontrado` é um zumbido longo grave, `excedente` é dois bipes curtos, distintos entre si como o plano exige.
- Lançamento manual por linha, habilitado só onde `podeLancarManual` permite — **é aditivo, não substitui o valor** (soma a quantidade digitada ao que já foi conferido, mesmo contrato de `aplicarBipagem` usado pela bipagem; não existe correção/decremento nesta fatia — se o operador errar pra mais, a divergência fica registrada e visível, não há como "desconferir" um item).
- "Fechar Conferência": confirmação prévia (lista as divergências, se houver) → `computeStatusFinal` → `runTransaction` grava `expedicoes` (status final, itens, observação, histórico) e os 6 campos liberados em `pedidos_venda` (exatamente o allowlist de `canCloseConferenciaOnPedido()`, Fatia 0) → `createAuditLog` com `valorAnterior`/`valorNovo` (Seção 1.4) → navega de volta pra fila.
- `historico` (array) usa `Timestamp.now()` em cada entrada, nunca `serverTimestamp()` — Firestore rejeita o sentinel de servidor dentro de array; os campos de nível superior (`abertoEm`, `conferidoEm`, `alteradoEm`) continuam com `serverTimestamp()` normalmente.
- **Limitação conhecida, documentada e não implementada (fora do texto original desta fatia, era só uma sugestão minha no artefato de opinião, não um requisito do usuário):** sem trava contra dois separadores abrindo o mesmo pedido ao mesmo tempo — a máquina de estados evita pular entre `conferido`/`divergente` sem passar por `em_conferencia`, mas não impede duas pessoas na tela `em_conferencia` simultaneamente. Aceitável pro escopo formal do módulo; registrado aqui pra não ser esquecido caso vire problema real em uso.
- `FilaExpedicao.tsx` (Fatia 3) ganhou o botão "Conferir" que faltava — sem ele o módulo inteiro ficaria inacessível pela UI (a Fatia 3 só tinha "Reimprimir Minuta"). Pequeno complemento fora do texto original desta fatia, necessário pra fechar o módulo de ponta a ponta.
- `git diff --stat`: `appRoutesConfig.tsx`, `FilaExpedicao.tsx` alterados; `ConferenciaForm.tsx` novo. **Nenhuma regra do Firestore mudou** — a Fatia 0 já cobria tudo que esta fatia precisava escrever (confirma que a especificação original antecipou corretamente essa necessidade). Typecheck/lint (0 erros, 66 warnings, nenhum novo)/build (chunk `ConferenciaForm` gerado)/182 testes passando. **Falta validação manual, com atenção especial ao item 7 do critério de aceite** (usuário só com `operacoes.expedicao` consegue fechar a conferência e não consegue editar o resto do pedido) — mesma limitação de sempre.

**Módulo 12 fechado no código com isso — as 4 fatias completas:** (0) fundação, (1) status nasce na venda, (2) minuta de entrega, (3) fila de expedição, (4) tela de conferência. Três desvios documentados ao texto original, todos com justificativa registrada na fatia correspondente: rota da minuta corrigida por gap de permissão achado ao implementar, código de barras do pedido adiado por falta de forma de validar, e trava de concorrência entre separadores deliberadamente fora de escopo. **Falta em todas as fatias:** validação manual ao vivo (login é sempre ação do usuário) — pendência única e recorrente, não específica de nenhuma fatia.

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

**Módulo 4 fechado no código com isso — as 4 fatias completas:** (0) Cadastro de Matéria-Prima, (1) Composição de produto, (2) Ordem de Produção + máquina de estados, (3) conferência de perdas/produção parcial, (4) relatórios.

**Módulo 4 validado ao vivo em 2026-08-15, ponta a ponta, fechando o quadro de acompanhamento:** cadastrada matéria-prima real ("Chapa de Aço Teste M4", 100 UN); composição de produto salva (2 UN/unidade, custo R$40 calculado certo); máquina de estados Criada→Em Produção⇄Pausada→Finalizada exercitada; conferência de finalização testada com produção parcial (4 de 5 planejadas) + perda extra (3 UN) — recálculo "necessário" ao vivo confirmado (2×4=8) e débito líquido exato (11 UN) conferido direto no Firestore; Relatório de Produção com todos os números batendo (eficiência 41/74=55,4%, ranking por produto/responsável, perda por matéria-prima); estorno da ordem testado e confirmado revertendo os dois estoques exatamente ao ponto de partida. Dados de teste apagados ao final. **Não exercidos nesta rodada** (mesmo caminho de código do que foi testado, risco baixo): campo "Sobra" na conferência e "Excluir" de ordem nunca finalizada.

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
| M2 Bandeiras de cartão | 1 | ✅ Validado ao vivo em 2026-08-15 — lista, F14 (painel de taxas), CRUD | 2026-07-28 |
| M10 Limite de autocomplete | 1 | ✅ Validado ao vivo em 2026-08-15 — 6 itens + "Ver Mais" confirmado numa OS | 2026-07-28 |
| M9 Busca exata/completa | 1 | ✅ Validado ao vivo em 2026-08-15 — teste A/B real (Exata bloqueia "integral", aceita prefixo "arroz") | 2026-07-28 |
| M11 Consulta por CDP | 1 | ✅ Concluído — absorvido por F1, confirmado por leitura de código | 2026-07-28 |
| M14 Buscas do sistema | 1 | ✅ Validado ao vivo em 2026-08-15 — busca de cliente/OS e produto na TopBar; risco de performance segue aberto (Seção 9) | 2026-07-28 |
| M3 Impressão múltipla | 1 | ✅ Validado ao vivo em 2026-08-15 — quebra de página real confirmada (2 pedidos, folhas separadas) | 2026-07-28 |
| M5 Flags fiscais | 1 | ✅ Validado ao vivo em 2026-08-15 — 3 checkboxes persistem após reload | 2026-07-28 |
| M1 Navegação por teclado | 2 | ✅ Validado ao vivo em 2026-08-15 (Bandeiras, OS) — achou e corrigiu o F24 (Esc não fechava nada); Pedido/PDV não re-testados nesta rodada | 2026-07-31 |
| M19 Numeração | 2 | ✅ Concluído — sem código novo, nada implementável hoje (ver seção do módulo) | 2026-07-31 |
| F20 Trilha do menu compacto vira atalho | 2 | ✅ Validado ao vivo em 2026-08-15 — atalhos diretos + recolher/expandir nos dois sentidos | 2026-08-02 |
| F24 Bugfix: Esc não fechava nenhum modal (globalEscapeStack nunca conectado) | - | ✅ Concluído — validado em 4 componentes diferentes | 2026-08-15 |
| F21 Redesign Login/Cadastro (auth switch) | - | ✅ Concluído — validado ao vivo (animação, cadastro completo, login, tema claro, mobile) | 2026-08-14 |
| F22 Entrada NF-e: histórico/precificação/exclusão — Fatia 0/N Fundação | - | ✅ Validado ao vivo em 2026-08-15 (XML de teste, ponta a ponta) | 2026-08-14 |
| F22 Entrada NF-e — Fatia 1/N Histórico (listagem) | - | ✅ Validado ao vivo em 2026-08-15 | 2026-08-14 |
| F22 Entrada NF-e — Fatia 2/N Classificação MP/Revenda + Precificação | - | ✅ Validado ao vivo em 2026-08-15 — núcleo do pedido do usuário | 2026-08-14 |
| F22 Entrada NF-e — Fatia 3/N Excluir com reversão (fecha o F22) | - | ✅ Validado ao vivo em 2026-08-15 | 2026-08-14 |
| F23 Animação de carregamento no login | - | ✅ Concluído — validado ao vivo (painel, botão, tela cheia, 2 temas) | 2026-08-15 |
| M20 Responsabilidade | 2 | ✅ Validado ao vivo em 2026-08-15 — prova direta no Firestore (criadoPor/criadoEm/alteradoPor/alteradoEm gravados corretamente em documento novo e em edição de documento antigo) | 2026-07-31 |
| M6 fatia Entrada de XML (Fornecedores + Contas a Pagar + Estoque) | 2 | ✅ Validado ao vivo em 2026-08-15 (priorizada fora de ordem a pedido do usuário) | 2026-08-02 |
| M18 Cancelamentos (auditoria) | 2 | ✅ Validado ao vivo em 2026-08-15 — venda de teste no PDV → excluída → estoque revertido exato + log de auditoria completo (criação, abertura de caixa, exclusão) | 2026-08-13 |
| M6 Central de Notas Fiscais (listagem) | 2 | ✅ Validado ao vivo em 2026-08-15 (achado que já existia ~90%, fechadas as 5 lacunas + achado que o backend local precisa estar rodando pra tela funcionar) | 2026-08-15 |
| M15 Relatórios padronizados | 2 | ⬜ Pendente — adiado, depois de M4 | |
| M13 Reserva de estoque — Fatia 0/N Fundação | 3 | ✅ Concluído — config + funções puras, zero mudança de comportamento | 2026-08-14 |
| M13 Reserva de estoque — Fatia 1/N Reserva na OS | 3 | ✅ Concluído — validado ao vivo (8 cenários); reserva ainda não protegida contra PDV/Pedido/Orçamento/Devolução (fatias futuras) | 2026-08-14 |
| M12 Conferência — Fatia 0/4 Fundação (domain + config + permissão + rules) | 3 | ✅ Validado ao vivo em 2026-08-19 — chave-mestra liga/desliga o módulo corretamente | 2026-08-18 |
| M12 Conferência — Fatia 1/4 Status nasce na venda | 3 | ✅ Validado ao vivo em 2026-08-19 — Pedido de Venda real nasceu com `statusConferencia: aguardando` | 2026-08-18 |
| M12 Conferência — Fatia 2/4 Minuta de entrega | 3 | ✅ Validado ao vivo em 2026-08-19 — prompt "Imprimir minuta?" + documento sem valores renderizado certo | 2026-08-18 |
| M12 Conferência — Fatia 3/4 Fila de Expedição | 3 | ✅ Validado ao vivo em 2026-08-19 — pedido apareceu em "Aguardando Conferência" e depois "Conferido" | 2026-08-18 |
| M12 Conferência — Fatia 4/4 Tela de conferência (fecha o módulo) | 3 | ✅ Validado ao vivo em 2026-08-19 — bipagem manual (código certo e errado), fechamento como Conferido, refletido também na lista de Pedidos de Venda | 2026-08-18 |
| M4 Produção — fatia 0/N Matéria-Prima | 3 | ✅ Validado ao vivo em 2026-08-15 — cadastro real ("Chapa de Aço Teste M4", 100 UN) | 2026-08-02 |
| M4 Produção — fatia 1/N Composição de produto | 3 | ✅ Validado ao vivo em 2026-08-15 — composição salva, custo total calculado certo (2 UN × R$20 = R$40) | 2026-08-02 |
| M4 Produção — fatia 2/N Ordem de Produção + máquina de estados | 3 | ✅ Validado ao vivo em 2026-08-15 — Criada→Em Produção⇄Pausada→Finalizada e Estornada, todas as transições testadas | 2026-08-02 |
| M4 Produção — fatia 3/N Conferência de perdas/produção parcial | 3 | ✅ Validado ao vivo em 2026-08-15 — produção parcial (4 de 5 planejadas) + perda extra (3 UN), recálculo ao vivo e débito líquido (11 UN) conferidos no Firestore | 2026-08-02 |
| M4 Produção — fatia 4/4 Relatórios (fecha o módulo) | 3 | ✅ Validado ao vivo em 2026-08-15 — todos os números do Relatório de Produção batem exatos (eficiência 41/74=55,4%, ranking, perda por matéria-prima) | 2026-08-02 |
| M4 Produção — fatia 5 Sobras + fatia 6 Excluir/Estornar | 3 | ✅ Estorno validado ao vivo em 2026-08-15 (reversão exata dos dois estoques); campo "Sobra" e caminho "Excluir" (ordem nunca finalizada) não exercidos nesta rodada, mesmo código/transação do que foi testado | 2026-08-04 |
| M16 Dashboard integrado | 3 | ⬜ Pendente | |
| M7 Novo fluxo de vendas | 4 | 🔒 Travado — aguarda decisão | |
| M8 Nota com valor diferente | 4 | 🔒 Travado — aguarda contador | |
| F25 Pedidos Pendentes do Agente — Fatia 1/4 Permissões | - | ✅ Validado ao vivo em 2026-08-19 | 2026-08-19 |
| F25 Pedidos Pendentes do Agente — Fatia 2/4 Fila + Recusar | - | ✅ Validado ao vivo em 2026-08-19 | 2026-08-19 |
| F25 Pedidos Pendentes do Agente — Fatia 3/4 Editar e Finalizar | - | ✅ Validado ao vivo em 2026-08-19 (pedido #0029 real) | 2026-08-19 |
| F25 Pedidos Pendentes do Agente — Fatia 4/4 Aviso de estoque/preço desatualizado | - | ✅ Validado ao vivo em 2026-08-19 — fecha o F25 por completo | 2026-08-19 |
| F26 Bugfix: quantidade fracionada ignorava o checkbox do produto | - | ✅ Validado ao vivo em 2026-08-19 | 2026-08-19 |
| F27 Nota de exportação — Fatia 1/4 CFOP 7101/7102 + peso no produto | - | ✅ Validado ao vivo em 2026-08-20 | 2026-08-20 |
| F27 Nota de exportação — Fatia 2/4 Conversão em fiscalDomain.ts | - | ✅ 5 testes novos | 2026-08-20 |
| F27 Nota de exportação — Fatia 3/4 Aplicado em PedidoVendaForm.tsx | - | ✅ Concluído no código | 2026-08-20 |
| F27 Nota de exportação — Fatia 4/4 Aplicado em NFE.tsx + revisão visual | - | ✅ Validado ao vivo em 2026-08-20 — aviso "Exportação: 5,000 kg" conferido | 2026-08-20 |

---

## 8.1 Painel da Plataforma (`/superadmin`) — Fatia 1, 2026-08-18

**Origem:** o usuário questionou que "acessar o super admin e ele ser igual ao sistema dos outros é estranho demais". Estava certo, e a investigação achou algo maior: **`SuperAdmin.tsx` (750 linhas) e `SuperAdminBackup.tsx` (726) estavam os dois órfãos** — zero imports, zero rotas, `/superadmin` não existia. O platform admin entrava e caía no ERP normal de tenant, administrando via seletor de "empresa ativa" no TopBar + Configurações (com o risco, já registrado na Seção 9, de editar o tenant errado).

**Correção importante de premissa, registrada porque tende a reaparecer:** o usuário sugeriu `dominio.com/superadmin` como forma de deixar "tudo 100% seguro". **A URL não protege nada** — qualquer um digita, e o guard roda no navegador do próprio usuário. Quem protege é a custom claim (`superAdmin`/`NexarAdmin`) + `isSuperAdmin()` nas `firestore.rules`. Rota separada é decisão de **clareza e experiência de uso**, não de segurança. Não tratar `PlatformAdminRoute` como barreira.

**O que foi feito (Fatia 1 — ligar o que já existia; refino visual combinado para uma fatia posterior):**

- `src/components/layout/PlatformAdminRoute.tsx` — guard de navegação (espelha `ProtectedRoute`, mas exige `isPlatformAdmin`; sem sessão → `/login`, com sessão mas sem perfil de plataforma → `/dashboard`).
- `src/components/layout/PlatformAdminLayout.tsx` — shell próprio: cabeçalho com abas Empresas/Backups, e-mail do usuário, botão "Ir para o ERP" e sair. **Deliberadamente sem sidebar de módulos e sem o sistema de abas (F19)** — são conceitos de tenant e não fazem sentido na administração da plataforma. Mesmo precedente do PDV, que já vive fora do `AppLayout`.
- `App.tsx`: rotas `/superadmin` (index → `SuperAdmin`) e `/superadmin/backups` → `SuperAdminBackup`, declaradas **antes** do coringa `/*` do `AppLayout` — senão cairiam no ERP normal.
- `TopBar.tsx`: botão de escudo, visível só para `isPlatformAdmin`, com `useNavigate` e **não** `openTab` — abrir o painel como aba o colocaria dentro do ERP de tenant, exatamente o que ele não deve ser.

**Observações levantadas, não resolvidas nesta fatia:**
- O status de inadimplência do painel **não vem de gateway de pagamento** — é campo mantido à mão. O MRR soma `valorMensalidade` real de cada tenant, mas "quem está devendo" depende de alguém marcar.
- `SuperAdmin.tsx:340` tem `if (!isPlatformAdminRole(userRole)) return null` (guarda própria de UI); `SuperAdminBackup.tsx` **não tem** equivalente — renderiza a UI e depende só do guard de rota, das rules e da autenticação do backend. Assimetria conhecida, sem risco real de dados, mas vale uniformizar.
- A aba Backups depende do **backend Express** (`VITE_BACKEND_API_URL`, porta 3001 em dev) — sem ele a tela abre mas não lista nada.
**Fatia 2 (mesma data) — o login de plataforma deixou de passar pelo ERP:**

- **Login de platform admin agora cai em `/superadmin`**, não mais em `/dashboard` (o chunk pré-carregado durante o splash também mudou para o do painel). O usuário testou a Fatia 1, entrou e caiu no ERP completo — "caiu no mesmo painel do sistema" — que era exatamente a confusão original. O ERP continua a um clique, pelo botão "Ir para o ERP" do painel.
- **Removido o popup "Qual empresa deseja acessar?"** (`selectPlatformTenant`, ~45 linhas em `AuthPage.tsx`). Ele fazia sentido quando o platform admin caía direto no ERP e precisava de uma base antes de abrir a tela. Com o painel listando todas as empresas, virou pergunta sem propósito. Dois efeitos colaterais ruins que sumiram junto: ele **apagava** o tenant salvo no `localStorage` para forçar a escolha a cada login, e **deslogava** quem cancelasse.
- **Não precisou de fallback novo:** `AuthContext` já reaproveita a última empresa do `localStorage`, e quem nunca escolheu nenhuma encontra o card "Selecionar empresa ativa" que o `AppLayout` já renderizava quando `needsTenantSelection` é verdadeiro ([AppLayout.tsx:68](../src/components/layout/AppLayout.tsx)) — fluxo que já existia e é mais suave que um modal bloqueante. O PDV também já tratava esse estado.
- `userTenantId` do log de auditoria segue `'geral'` no login de plataforma, que é o correto: é acesso de plataforma, não de uma empresa específica.

**Fatia 3 (mesma data) — entrada no ERP virou explícita, por empresa:**

- **Achado:** o botão "Acessar Dados" de cada empresa **não tinha `onClick` nenhum** — era decorativo (o "Suspender" também é, e continua sendo). Agora ele define aquele tenant e abre o ERP.
- **Removido o botão genérico "Ir para o ERP"** do cabeçalho do painel. Ele abria a última empresa usada **sem dizer qual era** — a mesma ambiguidade que a Seção 9 já registrava como risco de mexer no cliente errado. A entrada agora parte da linha da empresa, onde o nome está à vista.
- **O usuário sugeriu que "Ir para o ERP" fosse para a tela de login. Recusado, com motivo:** desde a Fatia 2 o login de platform admin cai em `/superadmin` — então ir pro login e reautenticar como SuperAdmin **voltaria pro painel**, um loop. E não dá pra entrar como o usuário do cliente, cuja senha o platform admin não tem.
- **`setActiveTenantId` (AuthContext) passou a retornar `boolean`.** Ele busca o id em `tenantOptions` e, se não achar, falhava **em silêncio** — o clique navegaria pro ERP com o tenant **anterior** ainda ativo, exatamente o acidente que se quer evitar. `SuperAdmin.tsx` checa o retorno e, em caso de falha, avisa e **não navega**. Os dois filtram `usuarios` por caminhos parecidos mas não idênticos (`loadTenantOptions` vs. o filtro próprio do painel), então a divergência é possível.

---

## 8.2 Estornos deixaram de inflar receita e despesa (bugfix, 2026-08-18)

**Como apareceu:** o usuário estranhou o Dashboard mostrar R$ 93,70 no filtro "Mês" e disse ser "de uma venda que eu excluí". Investigado com consulta direta ao Firestore (REST, com o token da sessão do próprio usuário).

**Diagnóstico — não era dessincronização nem registro órfão.** Os dois documentos de origem existiam. O valor era: R$ 44,70 do PDV #0014 (venda real, `Finalizada`) + R$ 49,00 da **OS #05, que estava `Cancelada`** (parcela de R$ 50 no cartão, líquido R$ 49 após taxa).

**Causa raiz:** ao cancelar uma OS/venda, o sistema **não apaga** a entrada original — grava um lançamento de **saída** compensatório (`estorno_cancelamento_*`, categoria "Cancelamento de OS"/"Cancelamento de Venda"/"Devolução de Venda"). Isso é correto e preserva histórico. Mas nenhuma tela distinguia essa saída de uma despesa operacional: a entrada seguia somando na receita **e** o estorno entrava como despesa. O saldo fechava, mas **as duas parcelas mentiam**.

**Correção:** nova função pura `isRevenueReversal` em `financeDomain.ts` (+ `REVENUE_REVERSAL_CATEGORIES`), com 9 testes (182→191). Receita passa a ser `entradas − estornos`; despesas contam só saídas que **não** são estorno. Saldo e lucro não mudam de valor — são matematicamente idênticos.

**Detalhe que quase virou bug novo:** o `estorno_devolucao_*` (`PedidoVendaForm.tsx`) usa a **mesma categoria** "Devolução de Venda" mas com `tipo: 'entrada'` — é a devolução sendo desfeita, então a receita volta. Por isso `isRevenueReversal` exige `tipo === 'saida'`; sem essa guarda, receita legítima seria anulada. Há teste cobrindo exatamente esse caso.

**Telas corrigidas:** `Dashboard.tsx` (métricas, gráfico de fluxo de caixa e curva de performance), `Faturamento.tsx` (DRE anual e balancete mensal). No DRE o estorno virou **linha própria** ("3. (−) Cancelamentos e Devoluções") em vez de desconto mudo no total — assim a quebra por categoria (Peças/Serviços/Outros) continua somando exatamente a Receita Bruta que aparece na tela.

**Deliberadamente não alterados:** `Caixa.tsx` (Fluxo de Caixa) e `Banco.tsx` são extratos linha a linha — ali o estorno é saída real de dinheiro e está certo aparecer como tal.

**Validado ao vivo:** Dashboard de agosto passou de "Receita R$ 93,70 / Despesas R$ 49,00" para "R$ 44,70 / R$ 0,00", com saldo inalterado em R$ 44,70. DRE fechando em todas as linhas.

**Complemento (mesma data) — Relatório de Recebimentos:** o usuário escolheu **marcar** em vez de esconder. A linha estornada continua visível (tachada, com selo "ESTORNADO"), mas sai do total — esconder o lançamento apagaria o rastro num relatório de auditoria; somar dinheiro que voltou ao cliente é que estaria errado. A ligação é exata, pelo id: o estorno de cancelamento é gravado como `estorno_cancelamento_{idDaTransacaoOriginal}`. Estornos que não casam com nenhuma linha listada — devolução (aponta pro pedido, não pra uma parcela) ou cancelamento de recebimento de fora do período — entram como abatimento no rodapé, que passou a mostrar "Subtotal listado / (−) Estornado / TOTAL".

## 8.3 Bugfix: Admin de empresa não conseguia salvar permissões (2026-08-18)

**Sintoma reportado:** "Não foi possível salvar as permissões" ao editar um funcionário recém-criado.

**Causa raiz — regressão do Módulo 20.** Em 2026-07-31 toda escrita do app passou a enviar os metadados de responsabilidade (`alteradoPor`/`alteradoEm`/`ultimaAlteracao`, de `documentMetadata.ts`), mas a regra de `/usuarios` nas `firestore.rules` não foi atualizada junto. Ela usa `affectedKeys().hasOnly(tenantUserEditableFields())`, e essa lista não incluía os metadados — então **toda** edição de usuário feita por Admin de empresa passou a ser recusada silenciosamente.

**Por que ninguém tinha notado:** `isSuperAdmin()` curto-circuita antes na mesma regra, então o SuperAdmin nunca sentiu. Só Admin de empresa era afetado.

**Segunda tela quebrada pela mesma causa, não reportada:** o `PerfilModal.tsx` (usuário alterando o próprio nome) grava `nome` + metadados, e a branch de auto-edição também não os permitia.

**Correção:** novo helper `documentAuditFields()` nas rules, concatenado nas duas listas (`tenantUserEditableFields()` e a branch de auto-edição). Implantado em `sistema-nexus-dev` em 2026-08-18 e **em produção (`nexus-erp-2026`) em 2026-08-19**, a pedido explícito do usuário.

**Lição:** ao adicionar campo novo a escritas existentes, conferir se alguma regra usa `hasOnly()`/`affectedKeys()` sobre aquela coleção. O `hasOnly` falha fechado e sem mensagem útil no cliente.

**Complemento — atalho de permissões na tela de Usuários (2026-08-18):** o usuário pediu um caminho direto para definir permissões a partir do cadastro de usuários, deixando a escolha entre "levar para Configurações" ou "abrir popup".

**Escolhido popup, por um motivo concreto:** as duas telas exigem permissões **diferentes** — `/usuarios` pede `administrativo.equipe` e `/configuracoes` pede `administrativo.config` ([routeAccess.ts](../src/utils/routeAccess.ts)). Um gerente que administra a equipe sem ter acesso a Configurações clicaria num link e bateria numa parede. O popup funciona para quem já está na tela, e mantém o contexto de quem acabou de criar o usuário.

- Novo `src/components/common/PermissoesUsuarioModal.tsx` — carrega as permissões atuais do funcionário, salva só o campo `permissoes` (+ metadados), com busca e contador.
- **Catálogo extraído** de um literal dentro do `Configuracoes.tsx` (1.700 linhas) para `src/utils/permissionCatalog.ts`, agora **agrupado por área** (41 permissões numa lista plana não cabem bem num popup). `Configuracoes.tsx` passou a importar a mesma constante — a lista duplicada em dois componentes seria garantia de divergência, exatamente o risco que os comentários do próprio código já alertavam. Conferido por diff que os 41 ids são idênticos aos de antes, sem duplicata.
- Validado ao vivo: popup abre pela tela de Usuários, marca permissões, salva, e o Firestore recebe `["vendas.pedidos","mecanica.os"]` com `alteradoPor` correto — o mesmo fluxo que estava quebrado antes da correção da regra.

---

## 8.4 Pedidos Pendentes do Agente de WhatsApp (F25, 2026-08-19)

**Origem:** um agente de WhatsApp em desenvolvimento por um colaborador (Henrique) grava pedidos direto em `pedidos_venda` com `status: "Em Análise"` e `formaPagamento: "A definir"` — o cliente escolhe os produtos, mas o pagamento só é definido quando a equipe confirma. `PedidoVendaForm.tsx` tratava qualquer pedido existente como somente-leitura, então esses pedidos viravam um beco sem saída (nem editar, nem finalizar, nem recusar). Um deles (#0029) chegou a quebrar a tela por completo — bug à parte, já corrigido em `PaymentsEditor.tsx` (commit `ba55301`, ícone da forma de pagamento sem fallback).

**Fatia 1 — Permissões:** 5 ids novos em `vendas.*` (`permissionCatalog.ts`): uma mestre (`pedidos_pendentes_editar`) + 4 granulares de UI (editar cliente, alterar quantidade, adicionar item, excluir item — sem regra própria no Firestore, decisão deliberada por não haver precedente de regra por campo no projeto). `firestore.rules` só checa a mestre.

**Fatia 2 — Fila "Pendentes" + Recusar:** `PedidoVendas.tsx` ganhou uma terceira aba (`Ativos`/`Pendentes`/`Cancelados`), reaproveitando o `onSnapshot` já existente (só filtro no cliente). Recusar pede motivo por escrito (mín. 8 caracteres) e só grava `status: 'Cancelada'` + `motivoRecusa` — sem reverter estoque/financeiro, porque nada foi aplicado ainda pra um pedido que nunca passou por `handleFinalizarVenda`.

**Fatia 3 — Editar e Finalizar (a maior):** `PedidoVendaForm.tsx` libera cliente/vendedor/itens/frete/pagamento quando `status === 'Em Análise'` e a permissão mestre está concedida — ~14 pontos de `isViewing` viraram condições derivadas (`canEditPendingCliente`, `canEditPendingQtd`, `canAddPendingItem`, `canDeletePendingItem`, `canEditPendingOrder`). `handleFinalizarVenda` ganhou um branch pra reaproveitar o documento existente (`transaction.update` em vez de criar outro via `transaction.set`+`addDoc`-style ref) — pula a alocação de `numeroPedido` novo (mantém o que já existia) e preserva `createdAt`/`criadoPor`/`criadoEm` originais, só registrando quem finalizou. Todo o resto (baixa de estoque, `transacoes`, comissão, fluxo de NFC-e/recibo/minuta) é o mesmo caminho de uma venda nova — nenhuma lógica duplicada. **Validado ao vivo no pedido #0029 de verdade**: trocou forma de pagamento, adicionou e excluiu item, editou cliente, finalizou — número preservado, sem duplicar documento, estoque e financeiro corretos, saiu da fila Pendentes e apareceu em Ativos como Finalizada.

**Fatia 4 — Aviso de estoque/preço desatualizado:** ao abrir um pendente com permissão de edição, compara cada item contra `produtosCatalogo` (já carregado no form) e mostra um banner (não bloqueia) listando itens com estoque insuficiente ou preço mudado desde a criação. **Validado ao vivo**: mudou o preço do CAFÉ VERDE de R$18,80 pra R$25,00 direto no cadastro, reabriu o #0027, o aviso apareceu com a mensagem exata. **F25 fechado por completo com isso.**

**Achado incidental durante a validação (F26, bugfix à parte):** editar a quantidade de um item pendente expôs dois bugs reais e pré-existentes na regra de venda fracionada, corrigidos na mesma sessão — ver commit `2f5ede1`. (1) `EstoqueForm.tsx` só olhava a flag da Unidade de Medida (`permiteFracionado`) ao gravar `unidadeMedidaFracionado` do produto — o checkbox "Produto fracionado" do próprio cadastro existia na tela mas nunca era combinado (AND) com o da unidade. (2) Os prompts de "Alterar quantidade" (PDV e Pedido de Venda) fixavam `step: '0.001'`, causando um bug de precisão de ponto flutuante do `<input type=number>` nativo que rejeitava valores válidos como "3" — trocado para `step: 'any'`, com `isValidSaleQuantity` (agora aceitando um `casasDecimais` opcional) fazendo a validação de verdade em JS.

---

## 8.5 Nota fiscal de exportação — conversão de unidade pra quilo (F27, 2026-08-20)

**Origem:** cliente que vende pra Alemanha e emite nota de exportação — estoque/venda continuam em unidade, mas a nota fiscal de exportação precisa declarar a quantidade em quilo. Não é preferência do sistema: é exigência real da SEFAZ (Nota Técnica 2016.001, Tabela de Unidades de Medida Tributáveis no Comércio Exterior) — toda operação de exportação declara `uTrib`/`qTrib` (unidade/quantidade tributável) separado da unidade comercial.

**Achado que simplificou a solução:** os dois pontos que já emitem nota pela Spedy (`PedidoVendaForm.tsx` para NFC-e, `NFE.tsx` para NF-e) já mandavam os dois campos pra API (`unit`/`quantity`/`unitAmount` comercial e `unitTax`/`quantityTax`/`unitTaxAmount` tributável) — só duplicavam o mesmo valor nos dois. Não precisou de mecanismo novo, só passar a preencher de verdade quando o CFOP é de exportação.

- **Fatia 1** — `EstoqueForm.tsx`: dois CFOPs novos no cadastro do produto (`7101` produção própria, `7102` mercadoria de terceiros) e campo novo "Peso líquido por unidade (kg)" — distinto do campo "Peso" que já existia (esse é só frete/e-commerce, nunca usado em nota fiscal).
- **Fatia 2** — `fiscalDomain.ts`: funções puras compartilhadas `isExportCfop`, `resolveInvoiceUnitFields` (a conversão em si, com bloqueio se o peso não estiver configurado — subfaturamento seria pior que travar a emissão) e `resolveInvoiceDestination` (achado extra pesquisando a doc da Spedy: o payload tem um campo `destination` que devia virar `'international'` em CFOP de exportação, hoje sempre `'internal'`/`'interstate'`). 5 testes novos.
- **Fatias 3 e 4** — aplicado nos dois pontos de emissão (`PedidoVendaForm.tsx` e `NFE.tsx`), incluindo a UI de revisão em `NFE.tsx`: quando o item tem CFOP de exportação, aparece um aviso automático com o peso convertido antes de transmitir (ex: "Exportação: 5,000 kg").

**Achado à parte, fora do escopo, registrado como pendência (item 12 da Seção 9):** o cadastro de cliente não tem campo de estado nem de país — só endereço/bairro/número. O código de CFOP por estado em `NFE.tsx`/`PedidoVendaForm.tsx` já lê `cliente.estado` como se existisse, caindo silenciosamente pra São Paulo. Não corrigido aqui — o usuário optou por CFOP manual no produto, que não depende disso.

**Validado ao vivo, ponta a ponta:** produto de teste com CFOP 7102 + peso 0,5kg/unidade, pedido de 10 UN finalizado, importado em Notas Fiscais — o aviso "Exportação: 5,000 kg" apareceu exatamente como esperado (10 × 0,5 = 5kg, conferido). **Transmissão real não testada** — sandbox da Spedy sem certificado digital A1 configurado, pendência já conhecida (item 11 da Seção 9). Publicado em `dev`; produção pendente de autorização.

---

## 8.6 Pré-venda + alteração de pagamento em venda finalizada (F28, 2026-08-24)

**Origem:** pedido do usuário — trabalhar com pré-venda no balcão (gravar o pedido em aberto e finalizar depois), mais dois controles em Configurações com hierarquia config → permissão de usuário.

**Achado que reduziu o tamanho da feature:** o fluxo de pedido em aberto **já existia inteiro**, só que a única porta de entrada era o agente de WhatsApp (F25). Pedido `'Em Análise'` já ficava em aberto, já era editável sob permissões granulares, já avisava se estoque/preço mudaram desde a criação, e já finalizava pelo mesmo caminho da venda direta. A pré-venda não precisou de tela nova nem de fluxo novo: precisou do botão **Gravar** no balcão e da separação entre *estado* e *origem* do pedido.

**Bug pré-existente achado e corrigido junto (o mais grave da fatia):** `RelatoriosVendas.tsx` e `Dashboard.tsx` contavam como faturamento **todo** pedido que não fosse `'Cancelada'` — ou seja, pedido `'Em Análise'` do agente, que nunca gerou um único lançamento financeiro, **já inflava o faturamento e o gráfico de vendas em silêncio**. Com pré-venda (uso diário) isso viraria receita fantasma em escala. A regra saiu das telas e virou `contaComoFaturamento()`.

- **Fatia 1** — `preVendaDomain.ts` (novo, puro, 10 testes): modelo de estado do pedido (`ABERTO` = `'Pré-venda'` + `'Em Análise'`, `FATURADO`, `CANCELADO`), `contaComoFaturamento()`, `isPedidoAberto()` e `resolveOrigemPedido()`. `contaComoFaturamento` é escrito como "não é aberto E não é cancelado", **não** como "é Finalizada": existem pedidos legados com outros status que sempre contaram como venda, e a comparação positiva sumiria com faturamento histórico do cliente (tem teste de regressão pra isso).
- **Fatia 2** — separação **estado × origem** em `PedidoVendaForm.tsx`. Antes, `isPendingFromAgent = isViewing && status === 'Em Análise'` colava as duas coisas. O estado governa o comportamento (não gera financeiro, reserva estoque); a origem (`'balcao'` | `'agente'`) governa **quais permissões** o usuário precisa. Sem isso, quem cuida da pré-venda do balcão herdaria acesso aos pedidos do WhatsApp. Pedido `'Em Análise'` legado sem campo `origem` resolve como `'agente'` — era o único jeito de ele existir.
- **Fatia 3** — reserva de estoque real, reusando `estoqueReservaDomain` (que só a OS usava). Pré-venda **reserva e não baixa**; a baixa vira real só na finalização, via `computeReservationCommit` (libera 100% da reserva e debita os itens atuais — os dois lados podem divergir se o usuário mexeu nos itens na mesma tela que finaliza). Regravar uma pré-venda **reconcilia** a reserva (`computeReservationDelta`), nunca soma por cima — senão cada regravação duplicaria a reserva e o produto sumiria do disponível.
- **Fatia 4** — configs + permissões, na hierarquia que o sistema já usa (mesmo padrão de `modoLimiteDesconto` + `vendas.liberar_desconto`): `trabalhaComPreVenda` e `alterarPagamentoVendaFinalizada` em Configurações; 6 permissões novas em `permissionCatalog.ts` (4 do ciclo de vida da pré-venda + relatório + alterar pagamento), `routeAccess.ts` e `firestore.rules` atualizados.
- **Fatia 5** — **Relatório de Pré-vendas em Aberto** (`RelatorioPreVendas.tsx`, rota `/pre-vendas`), pedido explícito do usuário: pré-venda não pode somar em caixa nem faturamento, então precisa de tela própria pra esse dinheiro não ficar invisível. Filtros por origem/data/busca, CSV, e um aviso fixo e não dispensável de que **aqueles valores não são receita** — é o número mais fácil de confundir com faturamento no sistema inteiro.
- **Fatia 6** — alterar forma de pagamento de venda finalizada. Valor total **não muda** (`normalizePayments` roda com o mesmo total); muda só a composição do recebimento, e os lançamentos em `transacoes` + o saldo dos bancos são refeitos por delta. Três travas **que não passam por permissão nenhuma**: cupom fiscal NFC-e autorizado (imutável na SEFAZ), venda com devolução, e lançamento já estornado — nesses casos o caminho certo é Estorno ou Devolução, que preservam o que aconteceu.

**Outro bug pré-existente corrigido de passagem:** excluir um pedido em aberto pela lista (`PedidoVendas.tsx`) devolvia `quantidade` ao estoque — mas pedido em aberto nunca baixou quantidade, ele reservou. Isso criava mercadoria do nada **e** deixava a reserva pendurada, tirando o produto do disponível pra sempre. Agora exclusão de pedido aberto libera a reserva e não toca no estoque real; e não tenta estornar crédito bancário que nunca existiu.

**Decisão de escopo do usuário:** editar **itens/valores** de venda finalizada ficou **de fora** — Devolução (parcial) e Estorno (total) já cobrem, preservando o histórico, e NF-e emitida não permite ser honesto com edição de item.

**Status:** typecheck, lint (0 erros), 268 testes e build limpos. **Não validado ao vivo** — reproduzir exige login no sistema. `firestore.rules` foi alterado e precisa de deploy pra permissão nova valer no servidor.

---

## 8.7 CONCLUÍDO — F29 Backend hospedado + F30 Identificação do vendedor na venda (2026-08-25 a 2026-08-27)

> **Status em 2026-08-27: as duas fatias estão implementadas e publicadas em produção.**
> `local = dev = production = commit 102b8ed`. O texto abaixo, até "Status final",
> é o **plano original** (mantido como registro histórico da decisão); a seção
> "Status final da fatia" ao fim documenta o que de fato aconteceu — inclusive
> um problema real de credencial na migração que consumiu a maior parte do
> tempo, e uma lacuna de design que o próprio usuário identificou faltando
> (virou um complemento do F30: a tela "Minhas Vendas").

**Origem:** o usuário vai montar, num cliente novo, um fluxo com **10 computadores** com o sistema aberto na tela de Pedido de Venda o dia inteiro. A cada venda, um popup deve pedir **código e senha do vendedor**; ao gravar/imprimir e começar a próxima venda, pede de novo. Mais uma chave em Configurações para ligar/desligar isso por empresa.

### Decisões já tomadas pelo usuário

- **Código do funcionário: 2 dígitos.** Teto de 100 funcionários por empresa, único por empresa.
- **Senha do popup: 4 dígitos numéricos.**
- **Uma conta de login por máquina** (`balcao01`, `balcao02`, …), aberta o dia todo. O funcionário **não** troca a sessão: ele só se identifica por venda.
- Editar itens/valores de venda finalizada continua fora de escopo (decisão anterior, mantida).

---

### F29 — Backend hospedado

> **CORREÇÃO (2026-08-25, mesma sessão):** esta fatia nasceu de uma premissa **errada** — a de que o backend nunca tinha sido hospedado (pendência 13, escrita em 15/08). **Ele já está hospedado e rodando**, no **Render**, e a produção já aponta para ele.
>
> Verificado por chamada real: `https://sistema-nexus-company-commit.onrender.com/health` responde **HTTP 200**, com **uptime de ~7,9 dias contínuos** (não está dormindo) e **0,27s** de latência com o serviço quente. O CORS já libera `https://accounts.nexarcompany.com.br` explicitamente, e `/api/spedy/config` responde **401** — ou seja, a rota existe e o middleware de autenticação está funcionando.
>
> `VITE_BACKEND_API_URL` **já está** no `.env.production` (que é versionado, e é de onde o build Vite tira a configuração — não do painel da Hostinger, como eu havia afirmado). Foi configurada no commit `bdf85d1`, "backend hospedado no Render".
>
> **Consequências:**
> - **A pendência 13 está resolvida**, não em aberto.
> - **O F30 está desbloqueado agora**, sem nenhum trabalho de infraestrutura: o PIN de 4 dígitos validado no servidor é possível hoje.
> - Migrar do Render para a Hostinger vira **decisão de custo, não de viabilidade** — os 2 slots de aplicação web continuam livres lá, e o levantamento do hPanel abaixo segue válido caso se decida migrar.
>
> **Verificações manuais que só o usuário pode fazer (no painel do Render):**
> 1. **Para qual projeto Firebase esse backend aponta** — `sistema-nexus-dev` ou `nexus-erp-2026`? Decisivo antes de acrescentar qualquer rota.
> 2. **O deploy é automático a partir do GitHub?** De qual repositório e branch?
> 3. **O plano do Render é pago?** Uptime de 7,9 dias contínuos sugere que sim (instância gratuita hiberna por inatividade). Se for pago, é um custo recorrente já existente — e aí a migração para a Hostinger, onde já há slot livre e pago, passa a economizar dinheiro de verdade.
> 4. **`BACKUP_ENCRYPTION_KEY` está configurada lá?** Com `NODE_ENV=production` e ela vazia, o serviço de backup lança erro. E sem guardar esse valor, backups já criados ficam irrecuperáveis.

**Levantamento da Hostinger (segue válido para a decisão de migrar):**

**Verificado ao vivo no hPanel em 2026-08-25** (usuário logado por conta própria; Claude só navegou e leu, não alterou nada):

- Plano **Business Web Hosting**, ativo até 2027-08-05, datacenter **South America (Brazil)** — latência baixa importa aqui, porque o popup bate no servidor a cada venda.
- **Aplicações web: 3 / 5** — dois slots livres. O backend cabe **sem comprar nada**, o que derruba a premissa antiga de que isso exigiria infraestrutura nova.
- A plataforma de Web Apps já oferece tudo que o `server/` precisa: **deploy automático do GitHub**, **variáveis de ambiente** (com importação de `.env`), **logs de execução**, **Node 22.x**, SSH, subdomínios e SSL.
- Limites com folga para um Express pequeno: **3 GB de memória**, **120 processos**, 50 GB de disco (1,63 GB em uso), 600 mil inodes (45 mil em uso). CPU hoje em 0-1%.
- O `server/` já está no formato certo: Express + `firebase-admin` + `node-cron`, com credencial vinda de **variável de ambiente**, não de arquivo no disco (`server/config/firebase.js`). E já existe middleware que valida ID token do Firebase (`server/middleware/auth.js`).

**Fatias:**

1. Criar o subdomínio `api.nexarcompany.com.br` e apontá-lo para uma nova aplicação web (4ª de 5).
2. Ligar o deploy ao repositório do backend; configurar `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_PROJECT_ID` nas variáveis de ambiente do painel — **chaves separadas para dev e produção**, nunca cruzadas.
3. Validar em produção as rotas que já existem (Spedy, sessão, backup, onboarding) antes de acrescentar qualquer rota nova.
4. **Mata a pendência 13 de quebra:** a página de variáveis de ambiente do `accounts.nexarcompany.com.br` está **vazia** — nenhuma variável cadastrada. Como o front é build Vite, `VITE_BACKEND_API_URL` precisa estar lá **antes** do build. Cadastrar + reimplantar resolve o "Backend não configurado" do módulo fiscal, que arrasta desde 14/08.

**Risco aberto, único que não deu para confirmar no painel:** não há nada no hPanel dizendo se a aplicação Node **dorme por inatividade**. Existe um botão "Parar processos em execução" descrito para processos de execução longa, o que é indício de que processo longo é normal ali — mas não é confirmação. Importa por dois motivos: **cold start na primeira venda do dia** e o **`node-cron`** do backup agendado, que só roda se o processo ficar de pé. Resolver perguntando ao suporte da Hostinger, ou empiricamente (o backend vai existir de qualquer forma). Se dormir, o PIN ainda funciona; o agendamento de backup é que precisaria de outra solução.

**Decisão de segurança que não pode ficar para depois:** a chave de service account do Firebase Admin **ignora todas as `firestore.rules`** — lê e escreve o banco inteiro, de todos os tenants. Hoje ela só existe na máquina do usuário. Hospedá-la é o lugar certo dela, mas **toda rota nova precisa passar pelo middleware de autenticação que já existe**. Uma rota `POST /reset-senha` desprotegida é literalmente "qualquer pessoa na internet assume a conta de qualquer funcionário, em qualquer empresa".

**Achado operacional:** o deploy de produção é **automático a partir do GitHub** (branch `main`). O site está rodando o build do commit `40bfa08f`, de 2026-08-20 — anterior a tudo desta semana. Push para `production` publica sozinho, sem passo manual.

---

### F30 — Identificação do vendedor na venda

**O que já existe e não precisa ser construído:**

- **Funcionário já não entra com email.** `AuthPage.tsx` trata login sem `@` como funcionário e resolve **CNPJ + usuário** via o índice `usernames/{cnpj-usuario}`; o email `@nexar.app` é sintético e invisível ao usuário.
- **Validar senha sem derrubar a sessão da estação já roda em produção:** `SolicitarAprovacaoDescontoModal.tsx` autentica num **app Firebase secundário** e desloga em seguida. O popup da venda é irmão desse modal.
- **A venda já sabe quem vendeu:** `vendedorId`/`vendedorNome` já são gravados e já alimentam a comissão. Hoje é dropdown livre, sem senha — o popup não cria o campo, ele passa a **autenticar** o que hoje é confiança.

**Descobertas que moldam o desenho (todas verificadas no código):**

- **Sessão única por usuário** (`AuthContext.tsx`): `activeSessionId` divergente desloga o cliente. Confirma que as 10 máquinas **não podem compartilhar um login** — daí as contas por estação.
- **`limiteUsuarios` padrão é 3** (`UsuarioForm.tsx`). Dez estações + funcionários estouram. Ajustar no SuperAdmin **antes** de o cliente entrar. Decisão comercial pendente: estação conta como licença?
- **PIN de 4 dígitos não pode ser a senha do Firebase Auth** — o mínimo é 6, e o próprio `UsuarioForm.tsx` já valida isso. Por isso o F30 depende do F29: o PIN vira segredo próprio, validado **no servidor**. Validar no navegador exigiria expor o hash, e 10.000 combinações caem em milissegundos.
- **Não existe reset de senha em lugar nenhum do sistema** — zero ocorrências de `updatePassword`/`sendPasswordResetEmail` em `src/` e `server/`. A edição de usuário só altera o nome. E **recriar não resolve**: excluir apaga só o documento e o índice, a conta do Firebase Auth fica órfã, e recriar com o mesmo usuário bate em `auth/email-already-in-use`. Hoje, funcionário que esquece a senha fica travado **para sempre**. Com PIN digitado dezenas de vezes por dia, isso vira chamado na primeira semana — entra como parte obrigatória do F30, não como extra.
- **`visibilidadeVendasDomain.ts`** (trabalho em andamento de outra sessão, não commitado quando isto foi escrito) decide o dono da venda por `vendedorId` primeiro. Com o popup, a venda passa a ser do **funcionário**, não da estação — então, com a restrição ligada, `balcao01` **deixa de ver a venda que acabou de fazer** e não consegue reimprimir. Não é bug, é interação: ou as estações ficam com nível "Administração", ou a restrição fica desligada nesse cliente. Precisa ser decisão consciente.

**Fatia 0 (bloqueante, antes de tudo) — prefixo divergente.** O prefixo do usuário é montado em dois lugares que só coincidem quando a empresa tem CNPJ cadastrado: `UsuarioForm.tsx` cai para slug do nome ou para os 4 primeiros caracteres do `tenantId`, enquanto `AuthPage.tsx` usa **sempre** o CNPJ digitado. Empresa cadastrada sem CNPJ ⇒ funcionário indexado sob chave que o login nunca gera ⇒ **ninguém entra**, com mensagem que manda procurar no lugar errado. Unificar numa função pura testada, com bloqueio claro em português quando falta CNPJ.

**Fatias seguintes:**

1. **Código do funcionário** — campo `codigoFuncionario` (2 dígitos), único por empresa, no cadastro de usuários.
2. **PIN + rotas no backend** — definir/alterar PIN, validar PIN, resetar PIN (admin). Todas autenticadas. Controle de tentativas do lado servidor.
3. **Config + permissão** — "Exigir identificação do vendedor a cada venda" em Configurações, na hierarquia config → permissão que o sistema já usa. Ligado, o dropdown de vendedor vira somente-leitura.
4. **O popup** — foco automático, Enter avança (balcão é teclado, não mouse).
5. **Ligar em Pedido de Venda** — pedir antes de finalizar **e** antes de Gravar Pré-venda (a pré-venda já carimba `vendedorId` e a comissão nasce dali); limpar a identificação ao concluir, para a próxima venda pedir de novo. PDV e OS ficam para depois.

**Riscos a tratar explicitamente:**

- **Erro no PIN não pode limpar a venda.** Carrinho de 30 itens refeito na frente do cliente é inaceitável. Requisito explícito, não detalhe de implementação.
- **Bloqueio por tentativas.** Com validação no servidor, o controle é nosso — mas precisa existir, com mensagem clara em português e caminho de contingência (gerente libera, como no desconto).
- **Comissão:** cada funcionário precisa do percentual configurado, senão a venda vai carimbada com comissão zero.
- **Código de 2 dígitos é público por natureza** (todo mundo vê o do colega). Toda a segurança fica no PIN.

---

### Status final da fatia (2026-08-27)

**F30 — implementado e em produção.** Commit `17cc1d3` ("Identificacao do vendedor na venda: codigo (2) + PIN (4 digitos)") entregou o núcleo: `server/services/vendedorPin.js` (hash scrypt com salt por usuário, coleção `usuarios_pin` negada a todo mundo nas `firestore.rules` — só o Admin SDK alcança —, bloqueio de 5 minutos após 5 tentativas erradas), `server/routes/vendedorPin.routes.js` (validar/definir/remover, todas autenticadas, `tenantId` sempre do token), a Fatia 0 (`loginIdentidadeDomain.ts`, prefixo de usuário unificado), `IdentificarVendedorModal.tsx`, e a integração em `PedidoVendaForm.tsx` (trava em Finalizar e em Gravar Pré-venda). 33 testes na época. Esse commit foi feito por uma sessão anterior que travou antes de validar ao vivo — retomado nesta sessão.

**F29 — implementado, mas de um jeito diferente do plano original.** O plano dizia "criar o backend do zero na Hostinger". Na prática, **o backend já estava rodando havia dias no Render** (achado que corrigiu a pendência 13, escrita como aberta em 15/08 — o time já tinha resolvido isso numa sessão que não deixou registro claro). O que de fato aconteceu foi uma **migração** do Render para uma nova aplicação Node na Hostinger (`api.nexarcompany.com.br`), com o Render mantido no ar como rede de segurança, não desligado.

**O problema real, que consumiu a maior parte do tempo:** ao importar o `.env` exportado do Render para a Hostinger, `FIREBASE_PRIVATE_KEY` (~1.700 caracteres, com quebras de linha escapadas) chegava corrompida no processo — o backend subia, `/health` respondia 200 normalmente, mas **toda rota que tocava o Firestore falhava** com "Could not load the default credentials", porque o Admin SDK caía silenciosamente no modo sem credencial. Diagnosticado por comparação direta: uma mesma rota pública que lê o Firestore (`/api/onboarding/verify-email` com um id inexistente) respondia `404` no Render e `500` na Hostinger — prova de que a credencial não estava chegando, sem precisar abrir o painel.

**Correção**, em `server/config/firebase.js` (commit `bbe17e3`): passou a aceitar `FIREBASE_SERVICE_ACCOUNT_BASE64` (o JSON da conta de serviço inteiro em base64, numa variável só — sem quebra de linha, aspas nem caractere especial, nada que um painel de hospedagem consiga corromper), mantendo o formato antigo funcionando para o Render. Ganhou também `normalizarChavePrivada()` (remove aspas nas pontas, que é o que `.env` exportado costuma trazer) e diagnóstico no log dizendo **qual** variável está vazia — antes só dizia "credenciais padrão", sem apontar a causa. Gerada uma **chave de service account nova** para essa migração (rotação, já que a antiga tinha aparecido em texto puro na conversa em algum momento — ver pendência abaixo).

**Reconciliação de produção:** ao publicar tudo, descobrimos que o repositório de produção tinha um commit (`4b0cb57`, a correção de impressão) feito direto nele numa urgência, em paralelo ao mesmo commit no fluxo normal (`1126374`) — conteúdo idêntico, hashes diferentes. Resolvido com `git merge` (não rebase, para não reescrever os commits já publicados em dev) — commit de merge `ec37ef4`. Depois disso, **34 commits acumulados da semana foram para produção de uma vez**: pré-venda (F28), histórico de preços, `#` na busca, visibilidade de vendas por usuário, e o próprio F30.

**A virada** (`.env.production`, commit `0d3ff4d`): uma linha, `VITE_BACKEND_API_URL` do Render para a Hostinger. Validado por deploy automático (~1 min) e a mesma sonda de antes respondendo igual nos dois backends.

**Complemento ao F30, pedido pelo usuário ao planejar o teste ao vivo — "Minhas Vendas" (commit `102b8ed`):** o usuário percebeu, testando o desenho, que o vendedor comum não podia mais ver a lista geral de Pedidos de Venda com o F30 ligado (ela mistura vendas de todos os colegas da mesma estação compartilhada), mas precisava de algum jeito de consultar e reimprimir as **próprias** vendas. Confirmado no código que o toggle de visibilidade que já existia (`restringirVendasPorUsuario`/`nivelAcesso`) não serve para esse cenário: ele compara a venda com `currentUser.uid` (a **estação**, sempre logada), não com o vendedor identificado pelo PIN — ligar aquele toggle faria a estação parar de ver até a própria venda que acabou de fazer.

Solução, decidida com o usuário: `listaGeralDeVendasEscondidaParaFuncionario()` (nova função pura em `vendedorPinDomain.ts`, reaproveita `hasTenantFullAccess` — mesmo padrão de `somenteVendasProprias`) esconde a lista geral **da tela** (não do Firestore — barreira de fluxo, não blindagem, escopo aceito explicitamente) para quem não é dono/Master/Admin quando "Exigir identificação do vendedor" está ligado; nova tela **Minhas Vendas**, trancada atrás do mesmo popup de código+PIN, mostra só as vendas de quem se identificou (totais + filtro de período + últimas 10 com "Ver mais" + reimprimir — sem editar/cancelar/estornar, de propósito, para não abrir outro fluxo de permissão). Também acrescentado, a pedido do usuário: popup de confirmação **antes** de ligar o toggle (primeiro precedente desse padrão no sistema), explicando as duas consequências de uma vez.

**Achado de segurança durante o planejamento (não pedido, corrigido por conta própria):** o Sistema de Abas (F19) mantém toda aba montada em segundo plano ao trocar de aba — nunca desmonta. Sem tratamento, a identificação do vendedor ficaria presa num estado local, e trocar de aba sem fechar "Minhas Vendas" deixaria os dados do vendedor anterior carregados para o próximo colega que reabrisse a mesma aba. Corrigido com `TabActiveContext` (já usado por `Dashboard.tsx` com o mesmo padrão): sair da aba esquece a identificação, forçando o popup de novo.

Planejado via `EnterPlanMode` formal (2 agentes Explore + 1 agente Plan), plano salvo em `C:\Users\uedde\.claude\plans\resilient-chasing-key.md`.

**Validação técnica das duas fatias:** typecheck, lint (0 erros) e build limpos em cada commit; 311 testes no total (33 do F30 original + os novos do complemento). **Nada foi validado ao vivo com login real** — é a pendência mais importante que sobra, ver Seção 9.

---

## 8.8 PWA — sistema instalável como app (2026-08-27)

**Origem:** pedido direto do usuário, fora do prompt original — um atalho fixo no computador do cliente, "igual banco faz" (instala, ganha ícone próprio, abre sem barra de endereço), sem virar `.exe` (isso fica para um plano futuro, deliberadamente fora de escopo aqui).

Implementado com Web App Manifest + service worker mínimo — commit `726f9b4`, publicado em produção junto com o F30 (`102b8ed`).

- `public/manifest.webmanifest`: nome, ícones, `display: standalone`, cor da marca (`--brand-600` `#7c3aed`) e fundo escuro (`--bg-primary` `#0b0c12`).
- Ícones (192/512px, `purpose` `any` + `maskable`) renderizados do `favicon.svg` já existente via `<canvas>` no navegador — já vinha com cantos arredondados e sombra, pronto como ícone de app, sem precisar desenhar nada novo.
- `public/sw.js`: fetch handler **só passthrough, sem cache nenhum** — decisão deliberada. O sistema busca saldo/estoque/preço em tempo real; um service worker que guardasse resposta antiga mostraria dado desatualizado sem o usuário perceber, pior que não ter app instalável. `src/main.tsx` já trata chunk JS obsoleto pós-deploy forçando reload (`vite:preloadError`); cache aqui reintroduziria o mesmo problema por outro caminho. O fetch handler existe só para satisfazer o critério de instalabilidade de versões mais antigas do Chrome, que exigem um handler mesmo vazio.
- `registerServiceWorker()` só roda em produção (`import.meta.env.PROD`) — no dev server atrapalharia o HMR do Vite sem benefício nenhum.

**Validado** servindo o build de produção real (`vite preview`): manifesto resolve com `content-type: application/manifest+json`, os 4 ícones carregam como `image/png`, o service worker registra e chega a `state: "activated"`, escopo correto. **Não validado**: o prompt real de "Instalar app" do Chrome/Edge em uso — o navegador de automação não confirma o evento `beforeinstallprompt` de forma confiável; os critérios técnicos que o Chrome checa estão todos corretos, falta só o clique real do usuário num Chrome de verdade.

---

## 9. Pendências a esclarecer com o usuário

1. ~~**Módulo 4:** trecho corrompido no PDF original — confirmar se falta requisito de Produção.~~ Resolvido em 2026-08-02: faltava Cadastro de Matéria-Prima (pool de estoque separado, mesma lógica do cadastro de produtos) — ver seção do Módulo 4.
2. **Módulo 15:** "Excel" exige `.xlsx` real ou CSV atende?
3. ~~**Módulo 2:** operadora/adquirente também vira catálogo agora ou fica texto livre?~~ Decidido em 2026-07-28: continua texto livre.
4. **Módulo 7:** decisão de arquitetura + plano de migração.
5. **Módulo 8:** validação contábil antes de qualquer implementação.
6. **Filial:** o relatório financeiro de 19/07 já apontou que não existe entidade de filial, e isso bloqueia sessão de caixa por operador/filial. Definir se entra no escopo.
7. **Módulo 14 / TopBar:** busca global (OS, clientes e agora produtos) usa `limit(80)` + filtro no cliente nas três coleções — não escala para catálogo grande. Resolver exige índice dedicado ou campo de busca normalizado, afetando as três buscas juntas; não implementado ainda, fora do escopo deste módulo.
8. ~~**Repositórios git:** `git push dev main` ficou pendente...~~ Resolvido em 2026-07-29: usuário deu autorização permanente pra `dev` receber push automático após cada lote de trabalho (ver [[project-nexar-git-repos]] na memória). `production` continua exigindo pedido explícito a cada vez — nunca mudou.
9. **Auditoria de permissões/módulos (2026-08-05):** levantamento completo dos dois catálogos de acesso do sistema — o de módulo bloqueável por plano SaaS (`src/utils/moduleCatalog.ts`, controlado pelo SuperAdmin) e o de permissão granular do Funcionário (lista embutida em `Configuracoes.tsx`). Corrigido no código: 4 ids que existiam num catálogo mas não no outro (`cadastros.bandeiras_cartao`, `cadastros.bancos`, `financeiro.banco`, `financeiro.caixa_registros`), 3 rotas sem nenhum gate real (`/bandeiras-cartao`, `/bancos`, `/dashboard` — qualquer Funcionario acessava por URL direta independente de bloqueio/permissão), um bug onde `/financeiro/banco` herdava por engano o módulo/permissão de `financeiro.comissoes` (fallthrough do `else if` genérico em `routeAccess.ts`), e o PDV (que vive fora do sistema de abas) não respeitava `blockedModules` do SuperAdmin. **Decisão pendente do usuário, não corrigida ainda:**
   - ~~`admin.backup` está no catálogo de módulos bloqueáveis mas não tem nenhuma tela roteada — existe um `SuperAdminBackup.tsx` completo (726 linhas) só que nunca importado em lugar nenhum.~~ **Resolvido em 2026-08-18:** religado como aba do novo Painel da Plataforma (`/superadmin/backups`). Descoberto na mesma investigação que o **`SuperAdmin.tsx` (750 linhas) também estava órfão** — nem rota `/superadmin` existia; o platform admin usava o ERP normal de tenant com um seletor de "empresa ativa" no TopBar. Ver seção do Painel da Plataforma abaixo.
   - `compras.*`, `integracoes.*`, `operacoes.lotes` continuam no catálogo com telas só placeholder "Em breve" (`RoadmapModule`) — bloquear/desbloquear esses módulos hoje não muda nada na prática. Sem ação necessária até essas telas virarem reais. **`operacoes.expedicao` deixou de ser placeholder em 2026-08-18** — Módulo 12 completo no código (fila real + tela de conferência), a permissão agora controla algo de verdade.
   - O SuperAdmin não tem um botão "gerenciar módulos" direto na lista de empresas — pra bloquear um módulo de um tenant específico é preciso trocar a "empresa ativa" no seletor e editar em Configurações. Funciona, mas é fácil editar o tenant errado por engano. Vale um botão dedicado por linha da tabela?
10. **Roadmap de Boleto bancário (remessa/retorno CNAB, Banco do Brasil + Sicoob), pedido em 2026-08-05:** greenfield total, sem nenhuma linha de código hoje. Fatiado em 4 fases (convênio bancário → emissão/impressão de boleto → arquivo remessa → arquivo retorno/conciliação), plano detalhado salvo em `C:\Users\uedde\.claude\plans\enchanted-whistling-planet.md`. Nenhuma fase implementada ainda — aguardando o usuário priorizar quando quiser começar.
11. **Notas Recebidas automática via Spedy (achado em 2026-08-06, auditando a documentação da Spedy pedida pelo usuário):** a Spedy tem uma API que já busca automaticamente, via SEFAZ, as notas que fornecedores emitem contra o CNPJ da empresa (com manifestação e XML completo) — poderia substituir ou complementar o fluxo 100% manual do `EntradaNFE.tsx` de hoje (usuário baixa o XML e arrasta pro sistema). **Usuário pediu explicitamente pra ser lembrado desse item em toda continuação do trabalho até decidir** — sempre mencionar como pendência em aberto ao retomar o módulo fiscal ou o plano de evolução, não deixar cair.
    - **Painel sandbox da Spedy inspecionado ao vivo em 2026-08-13** (usuário logado no navegador interno, Claude só navegou/leu — nunca digitou nem tocou em credencial): o recurso **já existe na UI**, não precisa confirmar com o suporte — Configurações → aba "NF-e" → seção "Notas recebidas" → toggle "Importar automaticamente" (hoje **desligado**) + campo "Importar a partir de".
    - **Bloqueio real confirmado:** **certificado digital A1 não está cadastrado** na Spedy, nem no sandbox (aba "Certificado" em "Minha empresa" vazia, com banner de venda "40% OFF"). Sem certificado, não dá pra ligar Notas Recebidas nem emitir de verdade em produção — é pré-requisito da própria Spedy, decisão de compra do usuário.
    - **Achado extra, relevante pro que já implementamos (Fatia D + IBS/CBS):** em Configurações → "Geral", o toggle **"Habilitar campos da Reforma Tributária?" está desligado** — pode fazer a Spedy ignorar/rejeitar o bloco `taxes.ibsCbs` que passamos a enviar. E em "Minha empresa → Dados", os campos **CRT e "Regime de Apuração dos Tributos do Simples Nacional" estão vazios** — o cadastro da empresa na Spedy não reflete regime tributário nenhum ainda. Nenhum desses três foi alterado — ficam para o usuário decidir/configurar.
    - Confirmado por leitura (sem expor o valor): **já existe uma chave de API ativa** cadastrada — o comando de registro do webhook (ver módulo fiscal na memória do projeto) pode usar essa chave existente, sem precisar gerar outra.
12. ~~**Bug achado durante a validação do M4 (2026-08-15):** a busca da tela principal Estoque/Produtos estava completamente desconectada.~~ Corrigido em 2026-08-15: `src/pages/Estoque/EstoqueList.tsx` ganhou `searchTerm`/`filteredPecas` (mesmo padrão de `ClientesList.tsx`), filtra por código, nome ou categoria; validado ao vivo (busca por nome, código e "sem resultado"). Typecheck/lint/build limpos. O botão "Filtros" continua sem `onClick` — mas isso é decorativo em **todas** as listas do sistema (Clientes, OS, Pedidos, etc.), não é uma lacuna específica desta tela, então não foi mexido. **Achado à parte durante a verificação, sem relação com a correção:** um aviso de console "A component is changing an uncontrolled input to be controlled" aparece no carregamento inicial do app autenticado, antes de qualquer interação — confirmado que não é causado por este fix (aba nova sem sessão não mostra o aviso; ele já aparece direto no Dashboard). Não investigado a fundo — candidato a próxima pendência, mas sem sintoma visível reportado pelo usuário até agora.
13. ~~**Arquitetura de deploy esclarecida em 2026-08-15**~~ — **Resolvido em 2026-08-25/27** (ver Seção 8.7): o backend nunca precisou ser hospedado do zero, já estava no Render havia dias; migrado para uma aplicação Hostinger (`api.nexarcompany.com.br`) em 27/08, com o Render mantido no ar como rollback. `VITE_BACKEND_API_URL` de produção aponta pra Hostinger desde o commit `0d3ff4d`. O texto original abaixo fica só como registro histórico do que se sabia em 15/08:
    - **Vercel** (`saas-nexarerp-desenvolvimento.vercel.app`, projeto `saas-nexarerp-desenvolvimento`) — deploy automático a cada push no remote `dev` (repo `SaaS_NexarERP-DESENVOLVIMENTO`), branch `main`. Confirmado ao vivo: 7 minutos depois do último push desta sessão, o deploy "Ready" já mostrava o commit certo e o menu já renomeado pra "Notas Fiscais". **Segundo o usuário, esse ambiente aponta pro banco de dev** (não confirmado de forma independente — o `.env.production` do repo aponta pra `nexus-erp-2026`, mas o dashboard da Vercel pode sobrescrever essas variáveis; não vale a pena insistir nesse ponto).
    - **Produção real** — hospedada num domínio próprio na **Hostinger** (não na Vercel). Presumivelmente essa é a que usa o banco `nexus-erp-2026`. Não investigada nesta sessão.
    - **Bloqueio real na Vercel, achado ao vivo:** a tela de Notas Fiscais lá mostra "Módulo Fiscal Desativado" mesmo com o código do M6 já publicado — causa confirmada no console: `Error: Backend nao configurado. Configure VITE_BACKEND_API_URL para usar o modulo fiscal.` Essa variável é fixada **no build**, não dá pra corrigir reconfigurando a chave da Spedy (mesmo que ela já esteja salva certa no banco, o que é provável se a Vercel realmente compartilha o banco de dev). **É a mesma pendência já registrada em 14/08** (erro "Backend não configurado" no cadastro) — o backend Express (`server/`) nunca foi hospedado publicamente em lugar nenhum. Resolver exige: decidir onde hospedar o backend (Render/Railway/etc.) e apontar `VITE_BACKEND_API_URL` da Vercel pra lá, depois redeploy.
14. **Bug achado ao vivo em 2026-08-15, não corrigido:** o botão "Ir para Configurações" da tela de bloqueio do módulo fiscal (`src/pages/Fiscal/NFE.tsx`, `<a href="/configuracoes">` simples, linha ~1117) **não navega** — reproduzido com clique real (via automação de mouse, não só JS sintético) tanto no ambiente local quanto na Vercel, nenhuma requisição de navegação disparada, URL não muda. Não é um problema introduzido pelo M6 (código pré-existente, não tocado). Causa raiz não identificada (não é `preventDefault`, não é CSP) — suspeita de interação com o sistema de abas F19 (`useRoutes(appRoutesConfig, tab.path)` em `TabPane.tsx`, que desacopla o conteúdo renderizado da URL real do navegador), mas não confirmada. **Workaround:** usar o menu lateral "Configurações → Configurações Gerais" (esse já usa `openTab()` corretamente). Vale conferir se outros links soltos (`<a href>` sem `openTab()`) espalhados pelo sistema têm o mesmo problema — este pode não ser o único.
15. **Achado durante o F27 (nota de exportação, 2026-08-20), não corrigido:** o cadastro de cliente (`ClienteForm.tsx`) não tem campo de estado/UF nem de país — só endereço/bairro/número. Apesar disso, `NFE.tsx` e `PedidoVendaForm.tsx` já leem `cliente.estado`/`cliente.cidade`/`cliente.codigoIbge` em vários pontos (cálculo de CFOP por comparação de estado, endereço do destinatário na nota) com fallback silencioso pra São Paulo (`'SP'`, `'3550308'`) quando ausente. Ou seja, hoje qualquer cliente sem esses dados preenchidos manualmente em algum lugar (não há onde preencher pela UI) é tratado como paulista pra fins fiscais. Não bloqueou o F27 porque o usuário optou por CFOP manual no produto (não depende do estado do cliente), mas vale decidir se o cadastro de cliente ganha esses campos numa fatia futura — mexe em pelo menos 2 telas (NFE.tsx e PedidoVendaForm.tsx) que já esperam esses dados.
16. **Pendências reais deixadas pela migração de backend + F30 (2026-08-27, ver Seção 8.7 completa):**
    - **Validar F30 + Minhas Vendas com login real.** Nada disso foi testado ao vivo ainda (limitação de sempre: Claude não loga). Roteiro já entregue ao usuário: cadastrar código+PIN de um vendedor em Usuários, ligar o toggle (conferir o popup novo), testar uma venda completa, testar erro de senha e bloqueio de 5 tentativas, abrir Minhas Vendas e — **o teste mais importante** — identificar-se, trocar de aba sem fechar e voltar, confirmando que pede identificação de novo (é a correção do vazamento entre vendedores do F19).
    - **Rotacionar de vez a chave de service account antiga.** Ela apareceu em texto puro na conversa em algum momento desta migração (arquivo lido pra gerar o base64). Uma chave nova já foi gerada e está em uso na Hostinger; falta confirmar que a **antiga foi revogada** no Google Cloud (IAM → Contas de serviço → Chaves) — só depois de confirmar que a nova funciona nos dois backados (ver item abaixo).
    - **Adicionar `FIREBASE_SERVICE_ACCOUNT_BASE64` também no Render**, com a mesma chave nova usada na Hostinger. Sem isso, revogar a chave antiga (item acima) derruba o Render — que ainda é o rollback caso a Hostinger dê problema.
    - **`BACKUP_ENCRYPTION_KEY` não está configurada em nenhum dos dois backends** (achado durante a migração) — com `NODE_ENV=production`, o serviço de backup lança erro sempre que tenta rodar. Gerar uma chave nova (não há backup antigo pra descriptografar, então pode ser qualquer valor aleatório longo) e configurar nos dois, Render e Hostinger.
    - **`limiteUsuarios` do tenant que vai usar o F30** (10 estações + funcionários) precisa ser ajustado no SuperAdmin antes do cliente entrar — o padrão do sistema é 3. Decisão comercial em aberto: estação compartilhada conta como licença?
    - **Decidir o destino do Render**: manter como rollback por quanto tempo, e quando desligar de vez (economiza a mensalidade que motivou a migração).
