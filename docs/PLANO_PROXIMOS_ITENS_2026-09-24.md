# Plano: itens pendentes de 24/09/2026 (para continuar depois do reinício do limite)

> **Andamento em 25/09/2026 (tudo commitado local, nada enviado):** 1 Configurações (`690fc71`) ✔ · 3 Despesas parceladas + cheque emitido (`6c8981c`) ✔ · 4.1 Frota + despesa de veículo + Custo por Veículo (`f63adb7`) ✔ · 2 Insumos (`74e053d`) ✔ · 4 Lote e Validade fases 1-3 (`71cff93`, `c2caa5d`) ✔; fase 4 (baixa por lote na venda) pendente — ver `PLANO_LOTE_VALIDADE.md` seção 6.
> **Antes de enviar ao remoto de produção:** publicar as `firestore.rules` em PRODUÇÃO (coleções `frota` e `insumos` novas + `estoque_lotes` aceitando `fiscal.entrada`) ANTES do frontend.

- **Criado em:** 2026-09-24
- **Origem:** pedidos do dono ao longo da sessão de 24/09. Nada abaixo foi implementado ainda, exceto o que a seção 1 diz que já está commitado.
- Complementa `docs/PLANO_LOTE_VALIDADE.md` (Lote e Validade) — leia os dois.

---

## 0. Onde paramos (estado do repositório)

- Enviado a `dev` e `production` em 24/09 (`6967d38`): custo do produto acabado acompanhando a matéria-prima (com escolha de preço), Entrada de NF-e completa (leitura total do XML, custo real, precificação, pagamento, DANFE, bloqueio de duplicidade, transação única) e edição de agendamento na Agenda de Serviços.
- **Commitado só local, NÃO testado e NÃO enviado:** `3d9de10` — Trocas na Fila de Expedição (igual à pré-venda) + Enter pulando de campo na conferência. Mais `a6452b9` (plano de lote).
- Para testar `3d9de10`: subir o front (`preview_start nexus-dev`; a porta 5173 está ocupada por outro app "Adega Kil", então sobe em porta nova e **exige login do dono**), conferir a fila e o Enter em pedido/pré-venda; o fluxo da troca ponta a ponta precisa do backend local com **credencial do projeto dev** (hoje o servidor sobe sem conta de serviço). Só depois enviar aos 2 git.

---

## 1. Erro ao abrir Configurações do sistema — "Não foi possível carregar a chave da integração fiscal (Spedy)"

**Diagnóstico (feito em 24/09, sem alterar nada):**
- O aviso vem de `src/pages/Configuracoes/Configuracoes.tsx` (~linha 290): a tela lê `configuracoes_privadas/{tenantId}` no Firestore e o `catch` mostra o pop-up a **qualquer** falha.
- A regra `configuracoes_privadas` em `firestore.rules` só deixa ler **`isSuperAdmin()` ou `isTenantAdmin()`** (papel `Master` ou `Admin`). Usuário com acesso à tela de Configurações mas sem esse papel (ex.: funcionário/gerente com permissão de configurações) toma `permission-denied` e vê o aviso **toda vez que abre a tela**, mesmo sem ter feito nada errado.
- **Não** é falha de rede nem do servidor, e **não** tem relação com o que foi enviado hoje.
- Segurança já está certa: salvar sem ter lido a chave **não a apaga** (`spedyPrivateConfigLoadFailed` protege).

**Correção proposta (pequena):**
1. No `catch`, se o código for `permission-denied`, **não mostrar pop-up**; marcar o estado e mostrar **uma nota fixa no campo "Spedy API Key"**: "Só o administrador da empresa vê e altera esta chave." (campo desabilitado nesse caso).
2. Manter o pop-up só para erro **inesperado** (rede etc.), com texto que diga o que fazer.
3. Teste: unitário da decisão (função pura `erroDeChavePrivadaEsperado(codigo)`), e conferir no navegador com usuário admin (sem aviso, campo preenchido) e com usuário não-admin (sem pop-up, nota no campo).
- **Perguntar ao dono:** com qual usuário/papel apareceu (para confirmar que é um não-Admin) e se esse papel deveria mesmo ver/alterar a chave.

---

## 2. Insumos na Entrada de NF-e (nova classificação, cadastro separado)

**Pedido do dono:** na entrada de nota, além de **Revenda** e **Matéria-Prima**, poder lançar **Insumo**. O insumo fica **guardado num lugar próprio do sistema**, separado do estoque e da matéria-prima ("igual criamos matéria-prima separada do estoque, poderia ter insumos também").

**O que é insumo (confirmar com o dono):** material de consumo da operação que não é vendido nem entra na receita (embalagem, etiqueta, material de limpeza, EPI...). Nunca vai para venda/PDV; tem saldo e custo.

**Desenho proposto (espelhar `materias_primas`):**
- **Coleção nova `insumos`** — ⚠️ **regra permanente do projeto:** coleção nova exige publicar as `firestore.rules` em **dev e produção ANTES** do frontend (`memória feedback_regras_firestore_dois_projetos`; a coleção `marcas` já derrubou cadastro em produção). Adicionar `insumos` nas listas de read/create/update/delete e à permissão de escrita (proposta: nova permissão `cadastros.insumos` ou reaproveitar `cadastros.materia_prima`).
- Campos: `codigo, nome, categoria, unidade, quantidade, estoqueMinimo, precoCusto, ultimoCusto, custoMedio, fornecedor, codigosFornecedor, fatoresFornecedor, ativo, tenantId` (mesmos de MP).
- **Cadastro:** tela Cadastros Auxiliares → Insumos (lista, formulário, importação opcional), no molde de `MateriasPrimasList.tsx` / `MateriaPrimaForm.tsx`; código automático próprio.
- **Entrada de NF-e** (`EntradaNFE.tsx`, `ItemDaNotaCard.tsx`, `entradaNfeDomain.ts`): tipo do item passa a `'revenda' | 'materia_prima' | 'insumo'`; select "Item novo — classificar como" ganha "Insumo"; vínculo manual/sugestões (`vinculoItemNfeDomain.ts`) passam a procurar também em insumos; `NotaFiscalEntradaItemTipo` ganha `'insumo'`; gravação (transação única) soma quantidade e custo no insumo, aprende `codigosFornecedor`/`fatoresFornecedor`.
- **Exclusão da nota** (`NotasFiscaisEntradaList.tsx`) reverte saldo de insumo também.
- **NÃO** entra em: precificação, PDV/venda, custo do produto acabado, produção (a menos que o dono peça).
- Ajuste manual de estoque para insumo (como MP já tem `origem: 'materia_prima'` em `applyAjusteEstoqueManual`).
- Relatório de Estoque de insumos (PDF, regra permanente).
- Testes: domínio (classificação/vínculo), rules, entrada ponta a ponta no dev.

**Decisões a confirmar:** nome/permissão, se insumo aparece em algum relatório de custo, se entra em produção no futuro.

---

## 3. Despesas parceladas e CHEQUE (Contas a Pagar / Entrada de NF-e)

**Pedido do dono:** poder **lançar as despesas parceladas** e **lançar cheque**: escolher o **banco do cheque**, informar os **dados** e os **dias/datas em que o valor do cheque sai do banco** (compensação), e **parcelas do cheque**.

**O que existe hoje (levantado em 24/09):**
- Entrada de NF-e: forma de pagamento com parcelas editáveis, à vista (caixa/banco) e a prazo, com `formaPrevista` (Boleto, Transferência, PIX, Dinheiro, **Cheque**, Cartão, Outros) — mas **cheque é só um texto**, sem banco, número nem data de compensação (`src/utils/pagamentoEntradaDomain.ts`, `PagamentoCard.tsx`).
- `src/pages/Financeiro/Cheques.tsx` é a **fila de cheques A COMPENSAR de recebimento** (forma `Cheque` em transações de **entrada**, tipo `ChequeDetails` em `src/utils/financeDomain.ts`, compensa e credita o banco). **Não** trata cheque **emitido para pagar** (saída).
- Contas a Pagar tem baixa com data e estorno (`baixaFinanceiraDomain.ts`); a tela de lançamento manual de despesa parcelada precisa ser localizada (`ContasPagar.tsx` / importação).

**Desenho proposto:**
1. **Cheque emitido (saída):** estender o modelo — na transação `saida` com `formaPagamento: 'Cheque'` guardar `cheque: { bancoId, bancoNome, numero, emissao, bomPara (AAAA-MM-DD, data da compensação), titular?, observacao? }`. Reaproveitar `ChequeDetails` se couber; senão criar `ChequeEmitidoDetails` com testes.
2. **Parcelas de cheque:** N cheques = N parcelas, cada uma com **banco, nº do cheque, bom-para e valor**; gerador "dividir em N cheques a cada X dias" (mesma ideia de `dividirEmParcelas`).
3. **Compensação:** o título de saída em cheque fica **Pendente até o bom-para**; ao compensar (fila em `Cheques.tsx`, aba "Emitidos" — decidir se é a mesma tela com filtro entrada/saída), **debita o banco** (`saldoCentavos`) e marca Pago com data de compensação. Alerta de cheque emitido a vencer.
4. **Onde aparece:** (a) Entrada de NF-e (PagamentoCard: escolher Cheque abre o quadro de cheques/parcelas); (b) **lançamento de despesa** em Contas a Pagar (à vista, parcelada em boleto/PIX/transferência, ou em cheques) — mesma UI compartilhada.
5. **Despesa parcelada:** valor total + nº de parcelas + 1º vencimento + intervalo, com edição manual e **bloqueio de soma** (padrão da Nota Avulsa: parcelas editáveis que precisam fechar o total).
6. **Estorno/exclusão:** cheque já compensado segue a regra de estorno atual (`financeiro.estornar`); nota paga não exclui sem estornar.
7. Permissões e rules: `transacoes` e `bancos` já existem (sem coleção nova); conferir se a fila de cheques emitidos precisa de índice.

**Decisões a confirmar com o dono:**
- Cheque de **terceiros** recebido e repassado (endosso) entra? (não foi pedido — assumir que não.)
- Compensação é manual (confirmar na fila) ou automática no bom-para? (proposta: manual, como o recebimento de cheque hoje.)
- "Dias de retirada do valor": é o bom-para (data) por parcela, ou um prazo padrão em dias a partir da emissão (ex.: 30/60/90)? (proposta: os dois — prazo em dias gera as datas, editáveis.)

---

## 4. Lote e Validade

Ver `docs/PLANO_LOTE_VALIDADE.md` (decisões do dono já registradas: configuração avançada FEFO/informar, vencido só avisa, tela 15/30/45 dias, NF-e exige lote).

---


## 4.1 Despesas de VEÍCULO ligadas ao Contas a Pagar (ideia do dono, 24/09 — a decidir)

**Pedido:** "vincular a tela de veículos com contas a pagar, algo assim, para lançar despesas de veículos, ou outra ideia".

**Achado importante (levantado em 24/09):** a tela **Cadastros → Veículos é de veículo de CLIENTE** (`VeiculoForm.tsx` exige `clienteId`; serve à Ordem de Serviço e à Agenda). **Não existe cadastro de veículo da própria empresa (frota).** Já existe controle de **despesas de viagem por motorista/rota** (Rotas e Despesas: `rotaDomain.ts`, `RotaForm.tsx`, `MotoristasList.tsx`), que lança cada despesa como linha própria no financeiro.

**Opções (escolher com o dono):**
- **A) Frota própria (recomendada):** novo cadastro **Veículos da empresa** (placa, modelo, ano, tipo, motorista padrão, KM, situação) — separado do veículo de cliente (coleção nova, ex.: `frota` → ⚠️ rules em dev e produção ANTES do front). Em **Contas a Pagar / lançamento de despesa** ganha o campo opcional **"Veículo"** (e "Motorista"). Cada despesa (combustível, manutenção, IPVA, seguro, multa, pedágio, pneus...) grava `veiculoId/veiculoNome` na transação. Relatório **custo por veículo** (PDF, por período/tipo de despesa) e custo por KM se houver KM.
- **B) Só vincular, sem cadastro novo:** campo "Veículo" (texto ou lista) na despesa; mais rápido, mas sem relatório confiável (digitação livre). Não recomendada.
- **C) Reaproveitar Rotas e Despesas:** despesa de veículo = despesa de rota sem viagem. Aproveita a tela pronta, mas mistura viagem com manutenção/IPVA. Só se o dono quiser tudo num lugar.
- **D) Despesas recorrentes:** IPVA/seguro/licenciamento com parcelas (junta com a seção 3 — despesa parcelada) e alerta de vencimento por veículo.

**Também decidir:** o combustível/manutenção da **rota** (motorista) passa a apontar para o veículo da frota? (proposta: sim, campo opcional na rota); permissão (`operacoes.rotas` ou financeiro); se veículo de cliente deve poder virar despesa (ex.: peça comprada para OS) — provavelmente **não**, isso é custo da OS.

**Ordem:** entra junto/depois da seção 3 (despesa parcelada), porque compartilha a tela de lançamento de despesa.

## 5. Ordem sugerida na próxima sessão

1. **Testar e enviar** `3d9de10` (seção 0).
2. **Erro de Configurações** (seção 1) — pequeno e destrava o uso; perguntar o papel do usuário.
3. **Despesas parceladas + cheque** (seção 3) — financeiro; começar pelo domínio puro + testes, depois PagamentoCard/Contas a Pagar, depois a fila de cheques emitidos.
4. **Insumos** (seção 2) — publicar rules em dev e produção **antes** do frontend.
5. **Despesas de veículo** (seção 4.1) junto com a despesa parcelada/cheque, depois de decidir a opção A/B/C/D.
6. **Lote e Validade** fases 1→3 e só depois a fase 4 (baixa por lote nas vendas).

Regras permanentes (valem em tudo): responder em pt-BR; erro de tela em português dizendo o que fazer; nunca gravar `undefined` no Firestore; não contornar cadastro incompleto do cliente na lógica; relatório sempre em PDF na tela; nada roda contra produção a partir da máquina local; push para dev/production só quando o dono pedir; conferir `git log`/`git status` antes de commitar (outra janela pode estar mexendo); `npm run typecheck` (não `tsc --noEmit -p .`).
