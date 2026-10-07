# Plano — Configurações por filial: Parâmetros, Mensagens, Numeração e Emissão por documento

Proposta de 07/10/2026, a partir das 13 telas do "Cadastro de Filial" e das 4 do "Controles do Sistema" do Integra que o dono mandou. **Não é cópia do Integra**: o dono mostrou a hierarquia de um sistema multifilial e marcou quatro grupos de funções que o nosso ainda não tem.

## 1. Decisões do dono (07/10)

- **Cada filial segue independente.** Não haverá camada "Configurações do grupo": a filial nasce com a cópia das Configurações da matriz e depois cada uma ajusta a sua. (Perguntado e respondido: "Não, cada filial independente".)
- **Ordem:** os quatro grupos primeiro, em Configurações (que já é por filial).
- **Documentos a criar** em "Emissão por documento": recibo de pagamento, promissória, carnê de parcelas e duplicata.
- Nada de ECF, formulário razão, layout de DANFE (é da Spedy) nem estoque compartilhado.

## 2. O que já existe e sai da lista

Identidade e endereço com IBGE, regime tributário, pré-venda com reserva, flags de emissão fiscal, exigir vendedor, conferência com quantidade, unidades de medida, venda sem estoque e momento da baixa, minuta e sua ordem, busca de produto, formas de pagamento visíveis, **limite de desconto no PDV, na OS e no orçamento** (com aprovação), prazos do crediário (`diasCrediario`), parcelas e taxas de cartão, preço à vista, logo, termo de garantia da OS, observações padrão do pedido, limite de crédito do cliente, numeração automática por filial (`contadores/{filial}/sequencias/*`), cidade/ISS da NFS-e, e-mail das notas.

## 3. Fases

### Fase A — Parâmetros de venda (≈ 4 dias)

Bloco novo em Configurações → "Parâmetros de venda", por filial. Cada parâmetro tem um ponto de uso claro; nenhum muda regra existente, só preenche o que hoje é fixo ou não existe.

| Parâmetro | Onde entra | Hoje |
|---|---|---|
| Validade padrão do orçamento (dias) | Orçamento novo já vem com ela | fixo em 15 |
| Vencimento padrão da venda a prazo | Pedido/OS/PDV pré-selecionam o 1º prazo do crediário | a pessoa escolhe sempre |
| Forma de pagamento padrão | Pedido/OS/PDV abrem com ela marcada | nenhuma |
| Bloquear venda a prazo para cliente em atraso (dias de atraso + carência) | Pedido, OS e PDV: ao escolher "a prazo", o servidor confere o maior atraso do cliente no grupo (mesma consulta do limite de crédito) | não existe |
| Juros ao mês e multa do crediário (%) | Contas a Receber: baixa em atraso sugere o acréscimo calculado, editável | só no boleto |
| Prazo para devolução (dias) | Devolução de venda: avisa ou bloqueia depois do prazo (escolha: avisar / bloquear) | não existe |

Regra do CLAUDE.md: parâmetro em branco = comportamento de hoje; mensagem de bloqueio em português dizendo o que fazer.

### Fase B — Mensagens por documento (≈ 2 dias)

Bloco "Mensagens padrão" em Configurações, por filial, um texto para cada documento: **recibo**, **minuta de entrega**, **orçamento** (rodapé), **nota fiscal** (vai nas informações complementares, antes do texto do Simples), **ficha do cliente**, **carnê/promissória** (fase D). Pedido e OS continuam onde estão. Cada impressão passa a ler o texto da filial.

### Fase C — Numeração dos documentos (≈ 2 dias)

Tela "Numeração" em Configurações (só dono/administrador), por filial: lista cada sequência com o **último número usado** e o **próximo**, e deixa **ajustar para cima** (nunca para trás — o servidor confere e registra no log quem mudou). Sequências: pedido de venda, OS, orçamento, ordem de produção, romaneio, transferência, troca, condicional, nota avulsa. A numeração da NF-e/NFC-e continua na Spedy (já tem tela). Serve para a migração de outro ERP (cliente que estava no pedido 75.713 continua dali).

### Fase D — Emissão por documento (≈ 6 dias)

Bloco "Documentos ao vender e ao receber", por filial. Para cada documento: **Perguntar / Sempre / Nunca** e **número de vias**.

| Documento | Quando | Conteúdo |
|---|---|---|
| Recibo de pagamento | ao receber uma parcela ou uma venda à vista (Contas a Receber e fim da venda) | emitente, pagador, valor por extenso, referência (venda/parcela), forma de pagamento, mensagem padrão, assinatura |
| Promissória | ao finalizar venda a prazo no crediário, uma por parcela | modelo legal da nota promissória (valor, vencimento, emitente, beneficiário, praça), numerada N/total |
| Carnê de parcelas | ao finalizar venda a prazo | folha com todas as parcelas, canhoto destacável por parcela, mensagem padrão |
| Duplicata | ao finalizar venda a prazo para empresa (CNPJ) | duplicata mercantil (número = número da venda/parcela, fatura, vencimento, aceite) |

Todos em PDF pela mesma base do boleto e do DANFE (`jsPDF`), abrindo na tela para imprimir ou salvar, como todo relatório do sistema. Também fica disponível depois, na venda e em Contas a Receber ("Imprimir → Recibo / Promissória / Carnê / Duplicata").

### Total: ≈ 14 dias úteis, em branch própria, testado no dev antes de juntar.

## 4. Fora deste plano (anotado, sem data)

CNAE e mês/ano de atividade; atacado e varejo; reserva de estoque no orçamento; aviso de estoque mínimo na venda; bloquear pré-venda no romaneio; montagem de produtos; frete padrão da NF; conta bancária padrão por documento; checagem campo a campo do cadastro do cliente (avisar/bloquear); valor máximo de venda sem CPF na NFC-e; fidelidade por crédito; custo real com alíquotas; MDF-e; FUNRURAL; SPED (contabilista, substituto tributário por UF, apuração) — o SPED já está na fila antiga do plano de evolução.

## 5. Situação em 07/10/2026 (noite)

As quatro fases foram implementadas e testadas no dev (matriz 10) na branch `config-filial`:

- **Fase A** `fd1f627` + `fe2146f` — Parâmetros de venda (`parametrosVendaDomain.ts`): validade do orçamento, bloqueio a prazo por atraso (Pedido e OS), juros/multa na baixa (lançamento próprio no servidor, estorno casado), prazo de devolução.
- **Fase B** `ef837e7` — Mensagens padrão por documento (`mensagensPadraoDomain.ts`): recibo, minuta, orçamento, nota fiscal (infCpl), carnê/promissória.
- **Fase C** `7af66be` — Numeração dos documentos (`numeracaoDomain.ts`, `server/services/numeracao.js`, `/api/numeracao`): ver e adiantar o próximo número, nunca voltar, com auditoria.
- **Fase D** — Documentos ao vender e ao receber (`documentosCobrancaDomain.ts`, `documentosCobrancaPdf.ts`, tela `DocumentosCobranca.tsx` em `/pedidos-venda/documentos/:id`): recibo de pagamento, promissória, carnê e duplicata em PDF; regra Não emitir / Perguntar / Sempre + vias por filial (`configuracoes.emissaoDocumentos`); gancho no fim da venda a prazo, botão em Mais ações e recibo em Contas a Receber (automático pela regra e manual na linha).

Falta: juntar `config-filial` no `main` depois do push de produção das 19h (filiais), enviar para `dev`, e o dono decidir quando vai para produção.
