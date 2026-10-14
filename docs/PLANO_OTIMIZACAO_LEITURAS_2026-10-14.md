# Plano — otimização de leituras do Firestore (2026-10-14)

Pedido do dono (13–14/10): "quanto maior o banco de produção, mais caro fica — dá
para já otimizar todas as telas para não ter esse trabalho lá na frente?".

**Princípio:** o Firestore cobra por documento LIDO, não pelo tamanho do banco.
O custo de cada empresa tem que acompanhar o USO (quantas telas abrem, quantas
vendas fazem), nunca o tamanho do HISTÓRICO. Hoje várias telas leem o histórico
inteiro a cada abertura, e o desktop usa cache em memória (de propósito — máquina
compartilhada), então reabrir a tela relê tudo.

Inventário feito por varredura de `src/` e `server/` no commit `dea2d4e`. Os
pontos marcados ✔ foram conferidos lendo o código; o resto vem da varredura e
deve ser conferido na hora de mexer.

Ramo de trabalho: `otimizar-leituras` (a partir do `main` com o bloco de 13/10).
Parte de performance de carregamento (Lighthouse) já feita: `11abe19`.

---

## Como o SDK cobra (vale para todas as telas)

- **Cache do desktop em memória com coleta imediata** (`src/services/firebase.ts`):
  fechou a última escuta de uma consulta, os dados somem; reabrir lê tudo de novo.
- **Consultas idênticas abertas ao mesmo tempo viram um alvo só.** Um `getDoc`/
  `getDocs` igual a uma escuta já sincronizada sai de graça. Hoje isso torna
  grátis `configuracoes/{tenant}` e `usuarios where tenantId` (o AuthContext
  escuta) e `clientes` dentro do OSForm. **Se essas escutas mudarem, essas
  leituras passam a custar a coleção inteira.**
- **Abas sempre montadas:** até 8 (`TabsContext.tsx:75`), escondidas mas vivas,
  restauradas ao recarregar. Escuta em coleção que muda muito (`estoque`,
  `pedidos_venda`, `transacoes`) cobra 1 leitura por documento alterado, por
  escuta, por máquina. O `VerificadorDataDoSistema` recarrega a página na virada
  do dia e relê tudo.
- **App `/vendedor`:** cache persistente (reabrir em ~30 min cobra só o que mudou),
  mas herda as leituras globais do `AuthProvider` (`App.tsx:33`) e remonta a tela
  a cada rota (`VendedorShell.tsx:110`).
- **Regras:** `firestore.rules:13,17` fazem `get()`/`exists()` em `usuarios/{uid}`
  — ~1 a 2 leituras extras por consulta aberta ou gravação.

---

## Fase 1 — global e servidor (sem mudança visível para o usuário)

Maior ganho por esforço. Nada muda na tela.

1. ✔ **Cascata do sinal de sessão (heartbeat).** `AuthContext.tsx:550-578` grava
   `usuarios/{uid}.activeSession.lastSeenAt` a cada 30 s (em transação). A escuta
   do próprio perfil (`AuthContext.tsx:292`) dispara e chama
   `setUserPermissions(novoArray)`, `setTenantOptions([])` (`:418-424`) → todo
   efeito que depende de `userPermissions` roda de novo a cada 30 s:
   `TopBar.tsx:180` desfaz e refaz as escutas de lembretes, agendamentos e contas
   a pagar pendentes (relidas inteiras do servidor), além de `Sidebar` e
   `LogsSistema`. Para quem não é o dono, `AuthContext.tsx:407` relê também
   `usuarios/{homeTenant}` a cada 30 s.
   - Correção: só chamar o `set` quando o conteúdo mudou; o `getDoc` do dono só
     quando `homeTenant` mudar; dependência do TopBar pelo booleano de acesso.
   - Janela de "sessão ativa em outro aparelho": `ACTIVE_SESSION_MAX_AGE_MS = 2 min`
     (`sessionInfo.ts:5`). Espaçar o heartbeat exige subir essa janela junto.
2. **Escuta `usuarios where tenantId`** (`AuthContext.tsx:653-654`) em todo desktop
   e app, só para o booleano `temVendedorCadastrado`. Cada heartbeat de cada
   usuário chega a todas essas escutas (U pessoas × C telas abertas a cada 30 s).
   Trocar por consulta pontual `limit(1)` ou flag em `configuracoes`. **Cuidado:**
   hoje ela deixa grátis `OSForm.tsx:530`, `RelatoriosMecanica.tsx:78`,
   `Configuracoes.tsx:529`, `SolicitarAprovacaoDescontoModal.tsx:94`,
   `acessoMobileDomain.ts:18` (coleção pequena, mas conferir).
3. **Seletor de empresas do admin da plataforma** (`AuthContext.tsx:264` →
   `platformTenants.ts:15,49`): relê `usuarios` de todas as empresas a cada
   disparo do perfil. Carregar uma vez.
4. **Busca global do TopBar** (`TopBar.tsx:221-298`): 240 leituras por pausa de
   500 ms na digitação (`limit(80)` em OS, clientes e estoque) e resultado errado
   (só procura nos 80 primeiros). Busca por código/prefixo com `limit(5)`.
5. **TopBar — avisos do sino:** contas a pagar pendentes inteiras (`:146`) para usar
   só as de hoje → `where data == hoje`; lembretes pendentes desde sempre (`:78`)
   e agendamentos "Agendado" (`:110`, nunca saem desse status) → janela de datas.
6. **Servidor — `server/middleware/auth.js:44`** lê `usuarios/{uid}` em toda
   requisição. **Decidido NÃO pôr cache (14/10):** funcionário inativado seguiria
   acessando o servidor durante a janela e, com mais de uma instância (balanceador),
   a troca de filial poderia demorar a valer — risco de gravar na filial errada.
   1 leitura por chamada não paga esse risco. Passar `req.user` adiante onde os
   serviços releem o mesmo documento (`transferencias.js:30`, `filiais.js:26,236`,
   `trocas.routes.js:78`) continua válido.
7. **Servidor — `spedyAcesso.js:37-40` (`loadSpedyConfig`)**: 2 leituras por
   chamada à Spedy. **Também sem cache (14/10):** trocar homologação ↔ produção
   com cache poderia emitir nota no ambiente errado durante a janela. O que
   pesava era a consulta automática de nota pendente (`NFE.tsx`), a cada 15 s
   **sem fim** — agora desacelera (15 s → 1 min após 2 min → 5 min após 30 min,
   `consultaPendentesDomain.ts`), o que também protege o limite de 60/min da Spedy.
8. **`/api/spedy/requisitos`** (`spedy.routes.js:169-175`): lê TODAS as notas
   autorizadas do tipo para achar o maior número, antes de cada emissão. →
   `orderBy('number','desc').limit(1)` com índice. **Correção mais barata de
   maior efeito.**
9. **Espelho de cadastros entre filiais** (`espelhoCadastros.js:129`): relê tudo a
   cada boot/deploy. Checkpoint + só o que mudou (avaliar; só afeta grupos).
10. **Backup diário** (`backup.js:109-123`): lê as 48 coleções da empresa todo dia.
    Com PITR ligado, avaliar frequência. `backups_historico` nunca é apagado.

## Fase 2 — telas do dia a dia por status e período (muda o padrão da tela)

Regra: **pendente nunca some por data** (filtra por status, sem período);
**histórico** abre com período padrão + "Ver mais"/filtro de período no banco;
**totais** por `getCountFromServer`/`getAggregateFromServer` ou resumo gravado.
O padrão de referência é o Dashboard (`Dashboard.tsx:217-236`,
`assinarColecaoDoPeriodo`, com fallback quando o índice ainda não existe).

| Tela | Hoje | Proposta |
|---|---|---|
| Pedidos de Venda `PedidoVendas.tsx:335` | escuta tudo, viva escondida | Ativos por período; Pré-vendas/Pendentes por status; total por agregação |
| — idem `:297` `notas_fiscais` NFC-e | todas, mesmo sem fiscal | `nfceStatus` no pedido ou `pedidoId in` dos visíveis |
| OS `OSList.tsx:65` | tudo | Em andamento por status (sem data); finalizadas/canceladas por período + limit |
| Caixa `Caixa.tsx:81` | toda `transacoes` | `Paga` + período (2 consultas: `dataPagamento` e `data`) |
| Contas a Receber `ContasReceber.tsx:207` | toda entrada | `Pendente` (total e vencidas) + pagas de hoje; resto sob demanda |
| Contas a Pagar `ContasPagar.tsx:167` | toda saída | igual |
| Banco `Banco.tsx:86` | toda `transacoes` | conciliar: pendentes de cartão; extrato: pagas por período |
| Boletos `Boletos.tsx:120` | todo boleto | abertos por status; **retorno bancário passa a consultar `nossoNumero in` ANTES do corte** |
| Cheques `Cheques.tsx:88` | todo cheque | pendentes; compensados por período |
| Faturamento/DRE `Faturamento.tsx:32` | toda `transacoes` | `Paga` + ano |
| NF-e `NFE.tsx:1232` (+ `:1162` redundante) | todas as notas | **Feito 14/10 (`0c88b12`):** período (padrão mês atual) + escutas das em transmissão e rejeitadas de qualquer data; cupom do pedido e devoluções consultados no banco; releitura após ação removida |
| NF-e `NFE.tsx:460,498,510` | pedidos/OS finalizados e cancelados inteiros | **Feito 14/10 (`3b1ad49`):** finalizados dos últimos 90 dias por `dataVenda`/`dataSaida`; pedido antigo pelo id (link do pedido); cancelados só os citados pelas notas da tela |
| Notas de entrada `NotasFiscaisEntradaList.tsx:101` | todas, com XML dentro | **Feito 14/10 (`2a8b8be`):** lançadas no mês (`createdAt`); filtro Emissão por `dataEmissao`. Importar de nota (Etiquetas/Precificação): ativas de 90 dias + "Ver mais antigas". *Falta:* XML fora do documento |
| Orçamentos `Orcamentos.tsx:57` | tudo, relido após cada "Recusar" | **Feito 14/10 (`97d9560`):** Pendente/Aprovado de qualquer data + emitidos no período (mês atual); escuta ao vivo |
| Devoluções, Minhas Vendas, Pré-vendas, Expedição, Notas Avulsas (**feito 14/10, `2a8b8be`**), Lotes, Ajustes, Produção, Transferências, Trocas, Condicionais, Romaneios, Rotas, Agenda, Lembretes, Caixas do PDV, Custo por Veículo, Extrato bancário | só `tenantId` | aba padrão por status; histórico por período/limit |
| Relatórios (`useDadosRelatorioVendas`, Comissões, Descontos, Financeiro, Taxas de cartão, Mecânica, Produção, SINTEGRA) | coleções inteiras, período no navegador | período no banco |
| App Vendas (OS, Meus Pedidos, Trocas, Contas, ranking) | tudo / limit 50 que conta errado | filtro por vendedor/status no banco; ranking por contagem |
| Servidor: resumo de filiais (`filiais.js:322`), integridade de cadastro (`cadastroIntegridade.js`), trocas (`trocas.routes.js:108`) | históricos inteiros | status/período no banco; `array-contains` + `limit(1)` para "nunca movimentou" |

## Fase 3 — N+1 (uma leitura por item, em loop)

- `PedidoVendaForm.tsx:1393` créditos do cliente **a cada tecla**; `:3053/3066`
  consulta repetida; `:1139` estoque por item no "Criar cópia".
- `loteBaixaService.ts:54,204` `getDoc` de estoque por produto só para
  `controlarLote` (já está no catálogo em memória); `reservaEstoqueService.ts:30`
  4 coleções inteiras de reservas abertas para achar 1 produto.
- Impressões em lote: `MinutaPrintLote.tsx`, `minutaTrocaLoader.ts`,
  `usePedidoPrintExtras.ts`, `PedidoPrintLote.tsx`, `ConferenciaForm.tsx:99`,
  `TrocaDetalhe.tsx:85`, `EtiquetasPrint.tsx:40`, `Boletos.tsx:590,662`
  (`configuracoes` relida a cada boleto).
- Fiscal: `NFE.tsx:603,804,841,1695`, `nfceEmissaoService.ts:115`,
  `EntradaNFE.tsx:1030,1488`.
- Produção: `useReservedRawMaterialStock.ts:53`; `custoProducaoService.ts:59`
  relê 3 coleções inteiras a cada mudança de custo.
- Servidor: `filiais.js:236` (4 + N por produto destacado), `transferencias.js:50,159`.
- Admin: `SuperAdminBackup.tsx:69,115`.

## Fase 4 — catálogos (estoque, clientes, fornecedores, veículos, serviços)

Carregados inteiros em quase todo formulário (PDV, Pedido — inclusive só para
visualizar venda finalizada —, Orçamento, OS, Estoque, Etiquetas, Precificação,
Nota Avulsa, Entrada de NF-e, Trocas, Condicional, app Vendas...). Próximo código
de cliente/fornecedor e checagem de CPF/CNPJ duplicado leem a coleção inteira.

- Contador de código em `contadores/{tenant}/sequencias` (padrão já existe) e
  `where documento ==` para duplicidade.
- Catálogo compartilhado em memória por sessão (uma escuta, várias telas), em
  vez de `getDocs` por tela.
- **O offline do app Vendas depende do catálogo inteiro no aparelho** — busca sob
  demanda quebra o offline. Alternativa: sincronizar só o que mudou, o que exige
  um campo "alterado em" padronizado (hoje: `updatedAt` na movimentação,
  `alteradoEm` na edição, nenhum nos antigos) e tratar exclusões.

---

## Índices compostos

Existentes (9): OS, pedidos e orçamentos (tenantId + número DESC) e (tenantId +
createdAt ASC); ordens_producao e notas_avulsas (tenantId + numero DESC);
caixas_pdv (tenantId, operadorId, status, fechadoEm DESC). `transacoes` não tem
nenhum.

Cada consulta nova com `where` + `orderBy`/intervalo precisa de índice
**publicado em dev E produção antes do frontend** (produção: o dono publica). Usar
o fallback do Dashboard (`failed-precondition` → consulta antiga) para a tela
nunca quebrar se o índice atrasar.

Possivelmente já falhando calados hoje (`.catch` engole): `vendedorRankingService`
(tenantId, createdAt DESC), `VendedorHome.tsx:69`, `VendedorConsultarCliente.tsx:86/93`,
e o índice (critical, dataHora) da limpeza de logs.

## Riscos — conferir antes de cortar qualquer lista

1. **Documento sem o campo de data some do filtro.** `dataVenda` falta em pedido
   antigo; pedido da integração externa pode não ter `createdAt`; `dataPagamento`
   não é gravado quando o título nasce pago; transferências só têm `enviadoEm`;
   romaneio em montagem pode estar sem `dataSaida`. **Empresa restaurada de
   backup:** `restore.js:189` regravava `createdAt` como mapa `{_seconds,_nanoseconds}`
   — some de todo `where`/`orderBy` por data (já acontece no Dashboard).
   **Corrigido na origem em 14/10 (`46a55dc`, `server/services/backupDatas.js`).**
   Falta conferir em produção se alguma empresa já foi restaurada
   (`restauracoes_historico`) e, se sim, converter os documentos dela.
2. **Pendente antigo não pode sumir** (OS em andamento, título vencido, cheque,
   pré-venda, condicional, lote a vencer) → status, nunca período.
3. **Totais mudam de significado** ("Total a Receber", cartões da NF-e, rodapé de
   Pedidos). Valor líquido de cartão e lançamentos sem centavos não somam no
   servidor; "só minhas vendas" é filtro do navegador.
4. **Buscas em memória que dependem da lista completa** (cupom do pedido e nota
   rejeitada na NF-e, retorno de boleto, visibilidade por vendedor, busca por
   texto) viram consulta no banco ANTES do corte.
5. **Filtros que perdem documento sem o campo:** `ativo`/`statusAtivo`,
   `formaPagamento` em importados, `movimentaCaixaFisico`; `codigo` é texto
   ("999" > "1000").
6. **Status legados** (ex.: OS 'Orçamento Aprovado') — levantar os status reais
   antes de usar `in`/`==`.
7. Mudar o heartbeat mexe no aviso de sessão em outro aparelho (AuthPage,
   `session.routes.js`).
8. **Documento recém-criado** fica fora de um intervalo por data até o servidor
   confirmar o `serverTimestamp` → `snapshot.data({ serverTimestamps: 'estimate' })`.
9. **SINTEGRA** filtra pelo mês do `createdAt`; não existe data de autorização na
   nota (`data` é a última transmissão).

## Decisões do dono (14/10)

- **Período padrão das listas de histórico: mês atual**, com filtro de período e
  "Ver mais" para o resto. Pendente aparece sempre, de qualquer data.
- **Totais:** o que é pendente ("Total a Receber", vencidos) soma tudo em aberto;
  cartões de histórico (vendas, notas) somam o período escolhido.
- **Bugs do inventário: corrigir agora**, um commit por bug, começando pelo
  Crédito de Devolução (precisa estar certo antes do bloco de 13/10 ir para
  produção).
- **Sessão: manter o heartbeat de 30 s** e a trava de 2 min; só cortar a cascata.

## Bugs achados no inventário

Conferidos (✔) lendo o código:

1. ✔ `TopBar.tsx:87` faz `dataPrevisao.split('-')`, mas o `LembreteForm.tsx:171-176`
   grava um Date (vira Timestamp) → o aviso de lembrete do sino quebra.
2. ✔ `ConferenciaForm.tsx:456-461` compara o status da troca em minúsculas
   ('cancelada'), o gravado é 'Cancelada' → a trava de troca cancelada/recusada/
   entregue durante a conferência nunca dispara.
3. ✔ `vendaFechamento.js:197` procura `creditos_cliente` por `clienteId`, mas o
   `DevolucaoVendaModal.tsx:337` grava o crédito só com `clienteNome` → com "Venda
   pelo servidor" ligada, pagar com Crédito de Devolução é recusado. **Está no
   bloco de 13/10 ainda não enviado.**
4. ✔ `VendedorContasReceber.tsx:56` descarta 'Recebida', que nunca é gravado (o
   real é 'Paga') → títulos pagos aparecem como pendentes no app.
5. ✔ `CaixaRegistros.tsx:111` consulta `pedidos_venda` sem `where tenantId` → as
   regras negam e "Vendas vinculadas" fica vazio.
6. (conferir) `Sintegra.tsx:130` casa `item.codigo` com o id do documento →
   produto com código interno ficaria fora do Registro 75.
7. (conferir) Efeitos sem `tenantId` nas dependências (não reassinam ao trocar de
   filial): OSList:65, ContasPagar:163, EstoqueList:121, ClientesList:47,
   Agenda:64, LembretesList:59, LembreteForm:114, CategoriasList, ServicosList,
   ServicoForm.
8. (conferir) Próximo código por contagem + 1 pode repetir: ServicoForm:59,
   CadastroRapidoProdutoModal:180, LembreteForm:154-166.
9. (conferir) `backupColecoes.js` sem `condicionais` e `transferencias`.
10. (conferir) `vendedorRankingService.buscarResumoHojeDoVendedor` olha só os
    últimos 50 documentos da empresa → conta a menos em empresa movimentada.
