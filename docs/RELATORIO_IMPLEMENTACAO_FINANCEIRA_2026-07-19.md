# Relatório de implementação financeira — 19/07/2026

## 1. Diagnóstico inicial

O sistema é uma SPA React/TypeScript com Vite. Os dados operacionais são gravados diretamente no Firestore; o servidor Express existente atende rotinas administrativas, backup e integrações, não o fechamento de vendas.

Antes desta implementação:

- venda a prazo criava uma transação pendente sem prazo ou vencimento obrigatório;
- cartão não persistia parcelas, taxa, líquido, adquirente ou previsão de recebimento;
- dinheiro e PIX apareciam juntos no caixa físico;
- os botões Hoje, Semana e Mês da dashboard não controlavam todas as consultas e métricas;
- a venda guardava apenas o usuário operador, sem um vendedor responsável explícito;
- comissão era recalculada nos relatórios com o percentual atual do usuário;
- o relatório de vendas tinha poucos filtros e não consolidava vendedor, recebimentos e pendências;
- baixas com crédito de devolução não eram atômicas nem sincronizavam os totais da venda;
- cancelamentos removiam a movimentação do caixa, sem um estorno financeiro rastreável.

Não existe entidade de filial nem sessão formal de abertura/fechamento de caixa. O isolamento existente é por `tenantId`. Também não existe fuso configurável por empresa; foi utilizado o fallback solicitado `America/Sao_Paulo`.

## 2. Alterações realizadas

### Venda e pagamentos

- prazo por quantidade de dias **ou** por data direta;
- vencimento futuro obrigatório e visualização da data calculada;
- múltiplas formas de pagamento com soma exata em centavos;
- dinheiro confirmado no caixa físico;
- PIX e transferência confirmados no fluxo digital;
- prazo, boleto e cartão pendentes até conciliação;
- cartão de débito sem parcelas;
- taxa de débito/à vista e tabela independente de crédito de 1x a 12x nas Configurações Avançadas;
- cartão de crédito com parcelas, distribuição determinística de centavos, taxa configurada por parcela, bruto, líquido e datas previstas;
- taxa e líquido não aparecem ao operador na finalização; ficam registrados como snapshot financeiro histórico;
- bandeira, operadora/adquirente e NSU/autorização opcionais, sem dados sensíveis do cartão;
- transações e conta a receber criadas atomicamente com a venda;
- chaves de idempotência e IDs determinísticos para pagamentos;
- vendedor responsável separado do usuário que executou a operação.

### Ordem de serviço e pagamentos

- a OS utiliza o mesmo editor e o mesmo domínio financeiro da venda;
- múltiplas formas, prazo, vencimento, cartões, parcelas, taxas e datas previstas seguem as mesmas validações;
- cada forma gera uma transação financeira individual e determinística ao finalizar a OS;
- dinheiro, recebimentos digitais e valores pendentes permanecem separados;
- a baixa e o uso parcial de crédito em Contas a Receber atualizam atomicamente os pagamentos e totais da OS;
- o cancelamento estorna individualmente pagamentos confirmados e cancela os pendentes.

### Dashboard

- Hoje, Semana e Mês controlam métricas, pagamentos e séries;
- semana inicia na segunda-feira;
- período selecionado persiste no navegador;
- cálculos usam calendário de São Paulo;
- foram incluídos valores a receber, comissões registradas e vendedor destaque do período;
- estados de carregamento, vazio e erro foram preservados.

### Relatórios

- filtros combináveis por período, vendedor, cliente, pagamento, condição, status, produto, categoria e faixa de valor;
- paginação, ordenação, limpeza de filtros e CSV;
- totais usam todos os registros filtrados, não apenas a página;
- consolidado por vendedor com vendas, cancelamentos, bruto, descontos, líquido, ticket, recebido, pendente, pagamentos e comissão;
- relatórios principal, impresso e CSV separam venda bruta, taxas de cartão e receita líquida;
- dashboard, contas a receber, caixa digital, DRE e impressão financeira usam o valor líquido das transações;
- registros devolvidos têm líquido, recebido e pendente limitados ao saldo efetivo da venda;
- venda original pode ser aberta pelo relatório, respeitando a proteção de rota e as regras Firestore.

### Comissão

- novas vendas recebem snapshot histórico no fechamento;
- o snapshot registra vendedor, base em centavos, percentual, valor e versão da regra;
- devolução reduz base e comissão;
- cancelamento zera e marca a comissão como cancelada;
- OS gera snapshot ao passar pela primeira vez para Finalizada;
- registros antigos continuam identificados como estimativa legada e não entram no total de comissão confirmada.

### Caixa e conciliação

- `movimentaCaixaFisico` separa dinheiro das demais formas;
- pagamento dividido leva ao caixa físico somente a parcela em dinheiro;
- recebimento posterior atualiza atomicamente transação e o documento de origem, venda ou OS;
- forma original e forma efetiva de recebimento são preservadas;
- crédito de devolução pode quitar ou abater parcialmente uma conta sem movimentar dinheiro;
- saldos de crédito, conta, pagamentos e totais da venda ou OS são atualizados na mesma transação;
- cancelamentos pagos criam saída de estorno determinística, preservando o histórico da entrada;
- devolução escolhida para o caixa cria saída em dinheiro; crédito ao cliente permanece fora do caixa físico;
- o saldo digital é exibido separadamente e considera entradas menos estornos digitais.

## 3. Banco de dados

O Firestore continua usando as coleções existentes:

- `pedidos_venda`;
- `transacoes`;
- `usuarios`;
- `ordens_de_servico`;
- `devolucoes_venda`;
- `creditos_cliente`;
- `configuracoes`;
- `estoque`.

Principais campos compatíveis adicionados:

- valores monetários `*Centavos`;
- `pagamentos`;
- `condicaoPagamento`;
- `prazoDias`;
- `dataVencimento`;
- `dataPrevistaRecebimento`;
- `cartao`;
- `totalTaxasPagamento` e `totalTaxasPagamentoCentavos`;
- `totalLiquidoFinanceiro` e `totalLiquidoFinanceiroCentavos`;
- `valorBruto`, `valorTaxa` e `valorLiquido` nas transações;
- `vendedorId` e `vendedorNome`;
- `comissao`;
- `naturezaFinanceira`;
- `movimentaCaixaFisico`;
- `idempotencyKey`;
- campos de origem e estorno.

Não houve renomeação nem remoção destrutiva. As consultas novas usam `tenantId`, sem exigir índice composto adicional.

A migração está em `server/scripts/migrate-financial-domain.js`. Ela:

- exige `--tenant`;
- é somente simulação por padrão;
- grava apenas com `--apply`;
- é idempotente pelo marcador `financialDomainMigrationV1`;
- registra os campos que adicionou;
- permite rollback com `--rollback`;
- não cria comissão histórica para dados antigos.

A migração **não foi executada**.

## 4. Testes e validações

Comandos validados:

- `node scripts/run-finance-domain-tests.mjs`: 13 testes, 13 aprovados;
- `tsc -b --pretty false`: aprovado;
- `eslint .`: aprovado sem erros; 70 avisos preexistentes fora do escopo;
- `node --check server/scripts/migrate-financial-domain.js`: aprovado;
- `vite build`: aprovado, 2.700 módulos transformados;
- preview de produção: HTTP 200;
- tela de login e redirecionamento de rota protegida: aprovados, sem erro no console.

Cenários unitários cobertos:

- prazo de 30 dias;
- vencimento por data direta;
- bloqueio sem vencimento;
- débito sem parcelamento;
- crédito com parcelas, taxa e arredondamento;
- taxa exata configurada de 1x a 12x;
- cálculo de bruto, taxa e líquido, inclusive em saldo parcial;
- limite de parcelas;
- pagamento dividido;
- baixa parcial por crédito e recebimento posterior;
- snapshot, devolução e cancelamento de comissão;
- períodos Hoje, Semana e Mês no fuso de São Paulo;
- classificação do caixa físico.

Não foram executados testes integrados contra Firestore real, pois não há emulador configurado e nenhuma credencial de ambiente de teste foi utilizada. As telas autenticadas também não foram preenchidas no navegador por falta de uma sessão de teste.

## 5. Regra de comissão encontrada

### Venda de produtos

- configuração por usuário: `recebeComissaoPecas` e `comissaoPercentualPecas`;
- base: subtotal dos itens depois dos descontos dos itens, sem frete e encargos;
- geração: no fechamento atômico da venda;
- histórico: percentual e valor ficam no snapshot da venda;
- devolução: reduz a base atual;
- cancelamento: zera o valor e marca `cancelada`.

### Ordem de serviço

- serviços: `recebeComissaoServicos` e `comissaoPercentualServicos`;
- peças: `recebeComissaoPecas` e `comissaoPercentualPecas`;
- geração: primeira transição para `Finalizada`;
- cancelamento: snapshot marcado como cancelado.

Não existe fluxo de pagamento da comissão; `pagaEm` é exibido quando existir, mas nenhuma regra nova de pagamento foi inventada.

## 6. Fluxo de caixa

- entra no caixa físico: dinheiro confirmado;
- não entra no caixa físico: PIX, transferência, cartão, prazo e crédito do cliente;
- venda dividida: somente a parte em dinheiro;
- venda a prazo: nenhuma entrada na venda; o recebimento posterior entra no caixa apenas se a forma efetiva for dinheiro;
- cancelamento: saída de estorno com chave determinística;
- devolução em dinheiro: saída física;
- reprocessamento: transações Firestore, bloqueios de submissão e IDs/chaves determinísticos evitam duplicidade.

## 7. Pendências de regra de negócio

### Abertura e fechamento de caixa

Não existe estrutura de sessão de caixa, operador, filial, saldo inicial, contagem e diferença.

Alternativas:

1. manter o livro-caixa físico atual, já separado por natureza financeira;
2. criar sessões de caixa por operador;
3. criar sessões por operador e filial.

Recomendação: definir primeiro se haverá filial. Depois, implementar sessão por operador e filial com bloqueio após fechamento.

### Percentual histórico de registros antigos

O banco não guarda qual percentual valia no passado.

Alternativas:

1. manter estimativa separada usando a configuração atual;
2. importar percentuais históricos de uma fonte externa;
3. declarar comissão antiga como não auditável.

Recomendação: manter a estimativa visualmente separada e nunca somá-la como comissão confirmada até existir uma fonte histórica.

### Liquidação automática de cartão

O sistema não possui integração de conciliação com adquirente.

Alternativas:

1. manter conciliação manual;
2. importar arquivo da adquirente;
3. integrar API de adquirente.

Recomendação: manter manual nesta versão e avaliar integração somente depois de definir as operadoras utilizadas.
