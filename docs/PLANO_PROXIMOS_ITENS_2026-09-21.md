# Plano — 13 itens pedidos em 21/09/2026

**Situação:** só planejamento. Nada disto foi implementado.

**Decisões do dono (21/09, depois de ler este plano):** o "+ Dividir pagamento"
vira **opcional por configuração**, não some; **não** criar limite de desconto por
vendedor agora; desconto do cliente **passa direto** até o percentual cadastrado;
rota é lançada **só pela loja** por enquanto.

O dono mandou a lista e depois detalhou item a item (mesma data). Este documento
já está com o detalhamento. Cada item diz o que existe hoje (lido no código), o
que muda, o que ainda falta decidir e o tamanho (P = horas, M = ~1 dia, G = vários
dias).

## Resumo

| # | Item | Hoje | Tam. | Trava em |
|---|------|------|------|----------|
| 1 | Boleto com remessa CNAB 240 (Sicoob e BB) | nada; "Boleto" é só um rótulo de forma de pagamento | G | os 2 layouts + dados bancários |
| 2 | Digitar a chave e importar a nota sozinho | só aceita arquivo XML | G | plano Spedy "Notas recebidas" + manifestação |
| 3 | CT-e (frete) na entrada + cadastro de transportadoras | nada: `vFrete` do XML é ignorado, não há cadastro de transportadora | M/G | — |
| 4 | Finalizar entrada e continuar na tela | `navigate('/estoque')` no fim | P | — |
| 5 | Ordem das formas de pagamento configurável | ordem fixa no código | P/M | — |
| 6 | Parcelas automáticas (3x = 30/60/90) e "+ Dividir pagamento" opcional | a prazo é 1 linha só; parcelar é na mão | M | — |
| 7 | Contas a Pagar abrindo em "vence hoje" + filtros | abre em "Em aberto", agrupado por fornecedor, ordenado por valor | M | — |
| 8 | Fornecedor do cadastro no lançamento de despesa | campo de texto livre | P/M | — |
| 9 | Rota: uma despesa agrupada por motorista/veículo | **não existe nada** | G | — |
| 10 | Código do cliente no `/vendedor` | só o nome | P | — |
| 11 | Logo na NF-e | a API da Spedy **não tem campo de logo** | ? | Spedy |
| 12 | Marcar/desmarcar todas as permissões | só uma a uma | P | — |
| 13 | Desconto padrão por cliente, no topo da hierarquia | não existe; e **não existe limite por vendedor** | M | — |

## Três achados que mudam o que foi pedido

### 1. Não existe limite de desconto por vendedor

O dono descreveu a hierarquia do desconto como "sistema → usuário → produto",
igual à da comissão. **A hierarquia de 3 níveis é só da comissão**
(`resolveComissaoPercentual`: produto > vendedor > sistema, com "em branco ≠ 0").

O desconto tem **dois** níveis, e nenhum deles é o vendedor:
- **Produto:** `descontoMaximoPercentual` no cadastro (limite por item);
- **Tela:** `limiteDescontoPedido` / `limiteDescontoOS` / `limiteDescontoOrcamento`
  / `limiteDescontoPdv` em Configurações, com `modoLimiteDesconto` =
  `avisar` | `bloquear` | `senha`.

Ou seja: a pergunta "o vendedor só pode dar 3%, e o cliente tem 10%" **não tem
como acontecer hoje** — não há onde cadastrar os 3% do vendedor.

**Decisão do dono (21/09): não criar o nível do vendedor agora.** Quem precisa
segurar desconto grande usa o modo "pede senha" das Configurações, que já
funciona. Fica registrado como possível fase 2 do item 13.

Bom: o modo `senha` já existe e funciona — `SolicitarAprovacaoDescontoModal`
valida senha de usuário ou código+PIN de vendedor e grava quem aprovou.

### 2. A API da Spedy não recebe logo

O OpenAPI só expõe `danfePrintLayout` (`default` | `simplified`). O DANFE é gerado
pela Spedy. A logo do ERP (Configurações → Logotipo) hoje só sai nos impressos do
próprio sistema. Caminhos, nesta ordem: (a) ver no painel da Spedy, em "Minha
empresa", se existe cadastro de logotipo — se existir é configuração manual, uma
vez por CNPJ, sem código nosso; (b) perguntar ao suporte se há endpoint não
documentado; (c) só se os dois falharem, gerar DANFE próprio a partir do XML
(grande, e o layout é regulado).

### 3. XML pela chave: existe, mas passa por um ato fiscal

`GET /v1/inbound-product-invoices?accessKey=` acha a nota, mas o XML **completo**
(`nfeProc`, o que serve para dar entrada) só é liberado **depois da manifestação
do destinatário** na SEFAZ. Antes disso o download traz só o resumo. Também: a
SEFAZ retém 90 dias, só distribui notas emitidas contra o CNPJ da empresa, e a
conta Spedy precisa ter "Notas recebidas" no plano, com certificado A1.

Manifestar é ato fiscal em nome da empresa — o sistema vai **perguntar** antes,
nunca fazer sozinho.

## Detalhe por item

### 1. Boleto (CNAB 240 Sicoob + Banco do Brasil)

É **boleto bancário registrado**: o sistema gera o arquivo **remessa** (CNAB 240),
o cliente envia ao banco, o banco registra e devolve o **retorno**. O dono vai
mandar os dois layouts (Sicoob e BB) e os boletos impressos de modelo.

Peças (a desenhar quando os layouts chegarem):
- **Cadastro de convênio/carteira por banco** (agência, conta, convênio, carteira,
  código do cedente, faixa de nosso-número). Cada banco tem o seu.
- **Nosso número** com sequência própria por convênio (usar
  `contadores/{tenantId}/sequencias/...`, mesmo padrão das trocas) e dígito
  verificador — a regra do DV muda de banco para banco.
- **Geração do boleto** a partir do título de Contas a Receber: linha digitável,
  código de barras (44 posições), PDF no layout do modelo.
- **Arquivo remessa CNAB 240**: posição fixa, um registro por título, com header/
  trailer de arquivo e de lote. Errar uma posição = banco rejeita o arquivo
  inteiro; por isso é domínio puro com teste por campo.
- **Retorno** (baixa automática do que o banco liquidou): vale a pena junto, senão
  a baixa continua manual e o boleto some do radar.

Este item tem numeração e dinheiro de verdade no meio, e cada banco homologa o
arquivo antes de liberar. É o maior dos 13.

### 2. Digitar a chave e importar sozinho

- Campo "Chave de acesso (44 dígitos)" + "Buscar" no topo da Entrada de Notas; o
  upload de arquivo continua como alternativa.
- Servidor (`/api/entrada-nfe/buscar`, chave Spedy do tenant via `spedyAcesso.js`,
  que nunca sai do servidor): valida os 44 dígitos e o DV, consulta a nota; se o
  XML já estiver completo, devolve para o **mesmo parser** da tela — a conferência
  e a importação não mudam em nada.
- Nota achada sem XML completo: pop-up "Para importar esta nota é preciso registrar
  a Ciência da Operação na SEFAZ. Confirma?" → manifesta → espera o XML (segundos)
  → segue.
- Nota não achada: pede sincronização (a Spedy limita a frequência e responde
  `Retry-After`) e avisa "ainda não chegou, tente em N minutos". Fora dos 90 dias
  ou de outro CNPJ: orienta a usar o arquivo XML.

### 3. CT-e (frete) na entrada + cadastro de transportadoras

Dois pedaços:

**a) Cadastro de Transportadoras** (coleção `transportadoras`, módulo novo): nome,
CNPJ com o botão "Buscar" que já existe (`BuscarDocumentoButton`, Receita Federal),
endereço, telefone, ativo. Mesmo padrão de `FornecedorForm`. **Coleção nova ⇒
publicar as rules em dev e produção antes do front.**

**b) Lançamento do CT-e na entrada da nota:** bloco "Frete / Conhecimento de
transporte" com chave do CT-e (44 dígitos, validada), valor do frete e
transportadora (busca no cadastro novo). O valor é **rateado entre os itens**
(proporcional ao valor de cada um, reaproveitando `ratearValorPorPesos` da Nota
Avulsa) e entra no custo que vai para o estoque. Gera **título de Contas a Pagar
para a transportadora**, separado do título do fornecedor da mercadoria — são
dois credores diferentes.

Quando o XML da nota já traz `vFrete` (frete embutido, pago ao próprio
fornecedor), o campo vem preenchido com ele e o título continua sendo só o do
fornecedor.

Atenção: o custo do produto é **sobrescrito** a cada entrada (`precoCusto =
valorUnitario`, não há custo médio). Somar o frete muda o último custo — e a Tela
de Precificação avisa quando a margem muda, mas nunca reajusta preço sozinha.

### 4. Finalizar a entrada e continuar na tela

Tirar o `navigate('/estoque')` do fim do salvar; a tela já se limpa sozinha
(`handleRemoverFile`). Mostrar "Nota NNN importada com sucesso — X produtos
atualizados, Y criados" e ficar na Entrada de Notas, pronta para a próxima. No
aviso, atalhos "Ver histórico" e "Ver produtos" para quem quiser ir.

### 5. Ordem das formas de pagamento (configurável)

Hoje a lista é fixa no código (`PaymentsEditor.tsx`: Dinheiro, Pix, Cartão de
Crédito, Cartão de Débito, Transferência, Cheque, Pagamento a Prazo).

Nova configuração "Formas de pagamento" em Configurações: a empresa **ordena** as
formas (arrastar, ou setas), e a primeira vira a pré-selecionada da venda. Loja
que fecha tudo a prazo põe "Pagamento a Prazo" em primeiro; loja de varejo põe
Cartão. Vale para Pedido, OS, Orçamento e PDV.

Junto (mesma tela, quase sem custo extra): **poder esconder** a forma que a
empresa não usa. Some da lista de escolha, mas nunca de venda já gravada.

Guardar como lista de identificadores em `configuracoes/{tenantId}`; forma nova
criada depois entra no fim da lista sozinha (nunca some por não estar gravada).

### 6. Parcelas automáticas — e o botão "+ Dividir pagamento"

**O que passa a existir:** escolheu "Pagamento a Prazo" → informa **nº de parcelas**
e **intervalo em dias** → o sistema monta as parcelas sozinho: 3x com intervalo 30
= 30/60/90; 3x com intervalo 15 = 15/30/45. Valor dividido em centavos, sem sobra
(`splitCents`, já existe), cada parcela editável, e trava se a soma não fechar o
total — igual à Nota Avulsa, que já faz exatamente isso.

**O botão "+ Dividir pagamento"** (em `PaymentsEditor.tsx`, usado em Pedido de
Venda e OS) hoje serve para **pagar com mais de uma forma** (parte no Pix, parte
no cartão) — e é também o único jeito de montar 30/60/90 hoje, uma linha por vez,
na mão. Com as parcelas automáticas, esse segundo uso acaba.

**Decisão do dono (21/09): o botão vira opcional**, com um marcador em
Configurações ("Permitir dividir a venda em mais de uma forma de pagamento").
Empresa que não usa pagamento misto desliga e a tela fica limpa; quem usa mantém.
Mesmo padrão de `permitirDescontoPorItem`, que já existe e é lido com
`parsePermitirDescontoPorItem`.

Detalhes que valem para qualquer opção desse tipo: o marcador decide o que a tela
**oferece daqui pra frente**, nunca reescreve venda gravada — venda antiga com
duas formas continua abrindo, imprimindo e recebendo baixa normalmente. E o padrão
é **ligado**, para não sumir um campo que a empresa já usa sem ela pedir.

### 7. Contas a Pagar — abrir no que vence hoje

- **Ao abrir:** "Vencendo hoje", com **todos os fornecedores**, em lista única
  ordenada por vencimento — não agrupada. Hoje abre em "Em aberto", agrupado por
  fornecedor e ordenado por valor, que é o que embaralha.
- **Filtros:** Hoje · Esta semana · Este mês · Vencidas · Em aberto · Pagas ·
  Todas · **Período personalizado** (de/até). O painel de filtros
  (`PainelFiltros`) já existe e é usado em outras telas — mesmo visual.
- **Agrupar por fornecedor** continua disponível, como um botão de alternância,
  para quem quer ver o total por credor. Deixa de ser o único modo.
- A regra de "o que cai em cada filtro" vai em `filtroListaDomain.ts` (função pura,
  com teste) — é lá que já mora `passaNaSituacaoTitulo`.

### 8. Fornecedor do cadastro ao lançar despesa

O modal "Lançar Conta a Pagar" tem hoje um campo de texto livre "Descrição /
Fornecedor". Passa a ter:
- **Fornecedor**: busca no cadastro (nome ou código), mesmo autocomplete do
  cliente (`ClientAutocomplete` já é genérico), gravando `fornecedorId` e
  `fornecedorNome` como a entrada de XML faz;
- **Descrição**: campo próprio.

Fornecedor é opcional (aluguel e luz não têm). Com isso o agrupamento por
fornecedor passa a valer também para lançamento manual, e dá para filtrar por
fornecedor. Lançamento antigo continua como está.

### 9. Rota: uma despesa agrupada por motorista/veículo

**Resposta à pergunta do dono: não, não está no sistema.** Nada de rota ou
motorista foi implementado. Foi planejado em 09/09 (junto com Cheque e Minuta) e
só esses dois foram entregues. O plano antigo está em
`~/.claude/plans/polymorphic-coalescing-ocean.md`, seção 3, e continua valendo —
com uma correção importante vinda do detalhamento de hoje.

**O que o dono quer (e o plano antigo não deixava claro):** o lançamento é **um
só**, agrupado. Abre "Nova despesa de rota", escolhe **motorista** e **veículo**,
e numa tela só lança combustível + almoço + hospedagem + pedágio, cada um com seu
valor. Salva uma vez. Não é uma despesa por vez.

Desenho:
- `motoristas`: nome, telefone, CNH, ativo.
- Veículo: por enquanto texto livre (placa/modelo) — o módulo Veículos existente é
  de oficina, vinculado a cliente, é outro domínio. Se o dono tiver frota
  cadastrada, vira cadastro próprio.
- `rotas`: motorista, veículo, data, observação, total, e as despesas do dia
  (tipo, descrição, valor) dentro do mesmo lançamento.
- Cada despesa vira uma linha em `transacoes` (saída, categoria "DESPESAS DE
  ROTA"), para aparecer em Contas a Pagar e nos relatórios — mas o lançamento é um
  só, e a tela mostra a rota inteira com o total do dia.
- Relatório por motorista/período (quanto cada um gastou, em quê).

**Coleções novas ⇒ rules em dev e produção antes do front.**

**Decisão do dono (21/09): o lançamento é só pela loja, no ERP.** O motorista
entrega as notinhas e alguém da loja lança a rota. O motivo é do próprio dono:
despesa lançada no celular pelo motorista pode vir **sem comprovante** ou com
valor inflado, e ninguém confere depois. Lançar na loja obriga a notinha a passar
pela mão de quem confere.

Consequência prática no desenho: a tela de rota é de retaguarda, e o campo
"comprovante" (número/observação da notinha) faz sentido em cada despesa. O
lançamento pelo celular fica como fase 2, se um dia o dono quiser — e aí
provavelmente com foto do comprovante obrigatória.

### 10. Código do cliente no `/vendedor`

Mostrar "0123 · NOME DO CLIENTE" onde hoje aparece só o nome: lista de busca, card
do cliente escolhido, pop-up "Confirmar cliente", Consultar Cliente, detalhe de
pedido/troca/rascunho e as impressões do app. A busca por código já funciona
(`searchClients` casa nome **e** código) — falta só exibir.

### 11. Logo na NF-e

Ver o achado 2. Resumo: não dá para enviar pela API. Primeiro conferir o painel da
Spedy e o suporte. Confirmar também que é o DANFE (o PDF da nota) e não os
impressos do sistema — nesses a logo já sai.

### 12. Marcar todas as permissões

No modal de permissões: um seletor "Marcar todas" no topo (e um por grupo). Liga
tudo, e o dono desmarca o que não quer — foi exatamente o pedido. Respeita a busca
(se filtrou por "estoque", marca só as de estoque). Confirmação ao marcar todas,
porque liga também Equipe & Acessos, exclusões e liberação de desconto.

Observação: é uma foto do catálogo de hoje. Permissão criada depois não entra
sozinha — quem quer "tudo, sempre" usa o nível de acesso total, que já existe.

### 13. Desconto padrão por cliente

Campo `descontoPadraoPercentual` no cadastro do cliente. Ao escolher o cliente em
Pedido, Orçamento, PDV, OS e no app do vendedor, o desconto geral já vem
preenchido com o percentual dele, com o aviso "10% — desconto do cadastro do
cliente". O impresso mostra a mesma coisa.

**Hierarquia pedida:** cliente é o mais alto. Sem nada no cliente, segue como é
hoje. Como não existe nível de vendedor (achado 1), a hierarquia real fica:

1. **Cliente** (novo) — o dono já autorizou no cadastro;
2. **Produto** (`descontoMaximoPercentual`) — teto por item;
3. **Sistema** (limite da tela, com avisar/bloquear/senha).

**Regra do "passa ou não passa" — decidida pelo dono (21/09):**

- **Até o percentual do cliente, passa direto**, sem pedir senha nem avisar. O
  dono já autorizou aquilo no cadastro do cliente; pedir confirmação em toda venda
  seria atrapalhar o vendedor por uma decisão que já foi tomada.
- **Acima do percentual do cliente**, cai na regra de hoje conforme
  `modoLimiteDesconto`: avisa, bloqueia ou pede senha.
- **O teto do produto continua mandando.** Produto com desconto máximo 0 não
  recebe desconto nem para cliente com 10% — senão o campo do cadastro do produto
  vira decoração.

O nível "vendedor só pode dar 3%" **não entra agora** (ver achado 1).

**Atenção que vale registrar:** todos esses limites são conferidos **só na tela**.
O servidor não valida desconto. Pela regra "nada se altera pelo DevTools", um
limite que precise ser inviolável teria de ser validado no servidor — mudança
maior, decisão à parte.

## Ordem sugerida

1. **Onda A — pequenos, sem dúvida nenhuma:** 12 (marcar todas), 10 (código do
   cliente), 4 (continuar na entrada), 8 (fornecedor no lançamento), 7 (filtros de
   Contas a Pagar).
2. **Onda B — pagamento:** 5 (ordem das formas) + 6 (parcelas automáticas), que
   mexem no mesmo lugar.
3. **Onda C — entrada de nota:** 3 (transportadoras + CT-e), depois 2 (chave).
4. **Onda D — módulos grandes:** 13 (desconto por cliente), 9 (rota), 1 (boleto).
   O boleto por último, ou em paralelo assim que os layouts chegarem, porque
   depende de homologação do banco.
5. **11 (logo)** entra a qualquer momento — depende de resposta da Spedy, não de
   código.

## Cuidados

- **Coleções novas** (transportadoras, motoristas, rotas, e o que o boleto pedir)
  exigem publicar as rules em dev **e** produção **antes** do front.
- O item 13 acrescenta campo em `clientes`; conferir as rules de integridade do
  cadastro antes.
- Cliente em go-live com NF-e em produção: nada vai para produção sem o dono
  mandar.
- Itens 1, 3 e 9 mexem em dinheiro (título, custo, financeiro). Regra do projeto:
  centavos em inteiro, domínio puro com teste, e conferência em dev com dado real
  antes de subir.
