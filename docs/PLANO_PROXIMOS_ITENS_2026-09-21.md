# Plano — 13 itens pedidos em 21/09/2026

**Situação:** só planejamento. Nada disto foi implementado. Cada item abaixo diz o
que existe hoje (lido no código), o que muda, o que falta o usuário decidir e o
tamanho do trabalho (P = horas, M = ~1 dia, G = vários dias).

## Resumo

| # | Item | Onde mexe | Hoje | Tam. | Depende de |
|---|------|-----------|------|------|-----------|
| 1 | Boleto (2 modelos) | Vendas / Contas a Receber | "Boleto" é só um rótulo de forma de pagamento, nada gera nem imprime boleto | ? | **os 2 modelos que o usuário vai mandar** |
| 2 | Buscar XML pela chave | Entrada de Notas | só aceita arquivo XML | G | plano Spedy com "Notas recebidas" + decisão sobre manifestar |
| 3 | Frete dentro da nota de entrada | Entrada de Notas | frete do XML (`vFrete`) é ignorado no custo | M | decisão: frete vai pro custo? |
| 4 | Ficar na tela de entrada ao finalizar | Entrada de Notas | `navigate('/estoque')` no fim | P | — |
| 5 | Forma de pagamento padrão = Boleto (primeiro da lista) | Entrada de Notas | a entrada não pergunta forma de pagamento | P | junto com o 6 |
| 6 | Dividir pagamentos pelo nº de parcelas | Entrada de Notas | 1 título por duplicata, ou 1 título em +30 dias | M | reaproveita a Nota Avulsa |
| 7 | Contas a Pagar: o que vence no dia, por vencimento | Contas a Pagar | filtro Situação sem "vence hoje"; grupos ordenados por valor | P/M | decisão de layout |
| 8 | Fornecedor do cadastro no lançamento | Contas a Pagar | campo de texto livre "Descrição / Fornecedor" | P/M | — |
| 9 | Controle de rota / motoristas | módulo novo | **nunca implementado** (só planejado em 09/09) | G | perguntas abaixo |
| 10 | Código do cliente no `/vendedor` | App do vendedor | o código existe e a busca já casa por ele, mas nenhuma tela mostra | P | — |
| 11 | Logo na emissão da NF-e | DANFE (Spedy) | a API da Spedy **não tem campo de logo** | ? | conferir painel/suporte da Spedy |
| 12 | Botão "marcar todas" as permissões | Cadastro de usuário | só liga uma a uma | P | — |
| 13 | Desconto por cliente | Cadastro de cliente + telas de venda | não existe | M/G | regras abaixo |

## Achados que mudam o plano

1. **Spedy não tem logo na API.** O OpenAPI só expõe `danfePrintLayout`
   (`default` | `simplified`). O DANFE é gerado por eles. A logo do ERP
   (Configurações → Logotipo da Empresa) hoje só sai nos impressos do próprio ERP.
2. **XML pela chave existe na Spedy, mas com condições.** `GET
   /v1/inbound-product-invoices?accessKey=` acha a nota; o XML **completo** só é
   liberado depois da **manifestação do destinatário** (registro na SEFAZ em nome
   da empresa). Antes disso o download traz só o resumo, que não serve para dar
   entrada. A SEFAZ retém 90 dias e só distribui notas emitidas contra o CNPJ da
   empresa. O recurso "Notas recebidas" precisa estar no plano da Spedy e ligado
   nas configurações da empresa. É a pendência "Notas Recebidas Spedy" (item 11
   da Seção 9 de `PLANO_EVOLUCAO_NEXAR.md`), agora pedida pelo usuário.
3. **A Nota Avulsa já tem o que os itens 3, 5 e 6 pedem**: frete rateado entre os
   itens (`ratearValorPorPesos`), divisão em parcelas em centavos (`splitCents`),
   parcelas editáveis com bloqueio quando a soma não fecha. Em vez de copiar,
   extrair para um trecho compartilhado e usar nas duas telas.
4. **O custo do produto é sobrescrito a cada entrada** (`precoCusto =
   valorUnitario`, sem custo médio). Frete no custo muda o último custo — e a
   Tela de Precificação já avisa quando a margem muda (nunca reajusta preço).
5. **Limite de desconto só existe na tela.** Produto (`descontoMaximoPercentual`)
   e limite de Configurações são conferidos no front; o servidor não valida
   desconto. O desconto por cliente herdaria isso. Se a regra tiver de ser
   inviolável (regra "nada altera pelo DevTools"), o desconto teria de ser
   validado no servidor — mudança bem maior, que precisa de decisão à parte.
6. **Cheque e Minuta do plano de 09/09 foram entregues** (`3be6f46`, `680b241`,
   `350e093`). **Controle de rota/motoristas não** — segue só no plano
   (`polymorphic-coalescing-ocean.md`, seção 3).

## Detalhe por item

### 1. Boleto — aguardando os modelos
Hoje não existe documento de boleto. Antes de desenhar, preciso saber, olhando os
2 modelos: (a) é boleto **bancário registrado** (linha digitável, código de barras,
exige banco/CNAB ou provedor de cobrança, com custo e homologação) ou um documento
**impresso tipo carnê/fatura** sem registro? (b) quem recebe: cliente numa venda,
ou é o boleto que a empresa paga ao fornecedor? (c) sai onde: ao finalizar venda
com forma Boleto, ou por título em Contas a Receber?

### 2. Buscar XML pela chave
- Campo "Chave de acesso (44 dígitos)" + "Buscar" no topo da Entrada de Notas;
  upload de arquivo continua como alternativa.
- Servidor (`/api/entrada-nfe/buscar`, mesma chave Spedy do tenant via
  `spedyAcesso.js`): valida os 44 dígitos e o dígito verificador; consulta a nota;
  se `isComplete`, baixa o XML e devolve para o **mesmo parser** da tela — o resto
  da conferência/importação não muda.
- Nota achada mas sem XML completo: **pedir confirmação** ("registrar Ciência da
  Operação na SEFAZ?") antes de manifestar — é ato fiscal, não é automático.
  Depois espera o XML chegar (segundos) e segue.
- Nota não achada: pedir sincronização (a Spedy limita a frequência; responde
  `Retry-After`) e avisar "ainda não chegou, tente em N minutos". Passou de 90
  dias ou é de outro CNPJ: orientar a usar o arquivo XML.
- Permissão `fiscal.entrada`; a chave da Spedy nunca sai do servidor.

### 3. Frete na nota de entrada
Campo "Frete (R$)" na conferência, já preenchido com o `vFrete` do XML quando
houver (editável), rateado pelo valor dos itens e somado ao custo de cada item —
mesmo comportamento da Nota Avulsa. O total a pagar considera o frete.
Pergunta: o frete vem **dentro** da nota do fornecedor, ou é cobrado à parte por
uma transportadora (CT-e)? No segundo caso a opção é gerar um título próprio para
a transportadora em vez de somar no título do fornecedor.

### 4. Continuar na entrada
Tirar o `navigate('/estoque')` do fim do salvar; a tela já se limpa (`handleRemoverFile`).
O aviso de sucesso ganha atalhos "Ver histórico" e "Ver produtos".

### 5 e 6. Pagamento da entrada
Novo bloco "Pagamento" na conferência: forma (Boleto primeiro e pré-selecionada;
depois Pix, Transferência, Dinheiro, Cheque…), nº de parcelas e 1º vencimento.
Divisão igual em centavos, parcelas editáveis, bloqueio se a soma não fechar.
Padrões: se o XML traz duplicatas, o nº de parcelas e os vencimentos vêm delas;
senão 1 parcela em +30 dias (como hoje). A forma escolhida é gravada no título
(`formaPagamento`) — a baixa em Contas a Pagar já pré-seleciona essa forma.

### 7. Contas a Pagar — o que vence no dia
- Situação ganha "Vencem hoje" e "A vencer" (a lógica é pura, em
  `filtroListaDomain.ts`, com testes).
- Ordenar por vencimento crescente. Hoje os grupos por fornecedor ordenam por
  valor, o que esconde a ordem cronológica. Proposta: alternador
  "Agrupar por fornecedor" / "Lista por vencimento"; ao escolher "Vencem hoje" a
  tela usa a lista por vencimento.

### 8. Fornecedor no lançamento
Trocar o texto livre por escolha no cadastro de fornecedores (busca por nome/código,
reaproveitando o `ClientAutocomplete`, que já é genérico), gravando `fornecedorId` e
`fornecedorNome` como a entrada de XML faz — o agrupamento por fornecedor passa a
valer para lançamento manual. "Descrição" vira campo separado. Fornecedor opcional
(aluguel e luz não têm). Filtro por fornecedor na lista. Lançamentos antigos ficam
como estão.

### 9. Controle de rota / motoristas
Nunca foi feito. O desenho do plano de 09/09 continua válido: `motoristas`,
`rotas`, subcoleção `rotas/{id}/despesas`, cada despesa espelhada em `transacoes`
(saída, categoria DESPESAS DE ROTA). **Coleção nova ⇒ publicar as rules em dev e
produção antes do front.** Ideia nova: o motorista lançar a despesa pelo próprio
celular, no app `/vendedor` (login por código+PIN e PWA já prontos).
Perguntas: o motorista é um usuário com login? Só despesas, ou também a lista de
entregas do dia e km? Há adiantamento de viagem e acerto de contas?

### 10. Código do cliente no `/vendedor`
Mostrar "0123 · NOME" onde hoje aparece só o nome: lista de busca, card do cliente
escolhido, pop-up "Confirmar cliente", Consultar Cliente, detalhe de pedido/troca/
rascunho e as impressões do app. A busca por código já funciona.

### 11. Logo na NF-e
Não há como enviar a logo pela API da Spedy. Caminhos, nesta ordem: (a) ver no
painel da Spedy (Minha empresa) se existe cadastro de logotipo — se existir, é
configuração manual, uma vez por CNPJ, sem código; (b) perguntar ao suporte da
Spedy se há endpoint não documentado; (c) só se os dois falharem, gerar o próprio
DANFE a partir do XML (grande, e o layout é regulado). Confirmar também que é o
DANFE (PDF da nota) e não os impressos de venda.

### 12. Marcar todas as permissões
Botões "Marcar todas" / "Desmarcar todas" no modal de permissões (e um por grupo),
atuando sobre o que está listado (respeita a busca). Confirmação ao marcar todas,
porque liga também Equipe & Acessos, exclusões e liberação de desconto. É uma
foto do catálogo de hoje: permissão criada depois precisa ser marcada de novo
(quem quer "tudo, sempre" usa o nível de acesso total, que já existe).

### 13. Desconto por cliente
Proposta: campo `descontoPadraoPercentual` no cadastro do cliente. Ao escolher o
cliente em Pedido, Orçamento, PDV, OS e app do vendedor, o **desconto geral** já
vem preenchido com esse percentual. Hierarquia, no espírito da comissão
(produto > vendedor > sistema): o limite do produto continua mandando (produto
com desconto máximo 0 não recebe); o operador pode alterar dentro das regras que já
existem (avisar/bloquear/senha). O impresso mostra "Desconto do cliente X%".
Perguntas: vale para todos os produtos ou por categoria/marca? É automático ou só
sugerido? O operador pode tirar/alterar? Vendedor externo também recebe? (e ver o
achado 5 sobre validação só na tela).

## Ordem sugerida

1. **Onda A — pequenos e sem dúvida:** 12, 10, 4, 7, 8.
2. **Onda B — entrada de nota (mexe no mesmo trecho):** 5+6+3 juntos, depois 2.
   Grava estoque, custo e financeiro: exige testes de domínio (centavos, rateio)
   e conferência em dev com XML real.
3. **Onda C — dependem do usuário:** 1 (modelos), 11 (Spedy), 13 (regras), 9
   (respostas).

## Cuidados

- Ondas A e B não criam coleção nova (sem rules novas). O item 9 cria.
- Item 13 acrescenta campo em `clientes`; conferir as rules de `clientes`
  (integridade do cadastro) antes.
- O cliente em go-live está com NF-e em produção: nada disto deve ir para produção
  sem o usuário mandar, e o item 2 só depois de confirmar o plano "Notas recebidas".
