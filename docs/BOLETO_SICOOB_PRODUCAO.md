# Boleto Sicoob — como emitir em produção (Sol Life) e o que ainda precisa ser confirmado

Atualizado em 2026-09-25.

## O que o sistema faz hoje

1. **Financeiro → Bancos → (banco Sicoob) → "Emite boleto por este banco"**: agência, conta, dígito da conta, código do cliente/beneficiário (opcional), CNPJ e nome do cedente, instrução de protesto, multa %, juros % ao mês, prazo padrão, **próximo nosso número** e **próxima remessa**.
2. **Venda/OS com forma "Boleto"** (à vista de parcelas: N boletos) cria o título em Contas a Receber "aguardando emissão".
3. **Financeiro → Boletos → Emitir**: reserva o nosso número (contador atômico, nunca repete), calcula código de barras e linha digitável, grava no título.
4. **Imprimir** (novo, 25/09): PDF com recibo do pagador + ficha de compensação (linha digitável e código de barras ITF), aberto na tela com Imprimir/Salvar.
5. **Gerar remessa**: arquivo CNAB 240 do Sicoob (layout já **aceito pelo banco em 24/09** segundo o dono). Só sai se o cliente tiver CPF/CNPJ, CEP, cidade e UF.
6. **Importar retorno**: lê o CNAB 400 que o Sicoob devolve. Só a ocorrência **06 com valor pago** dá baixa sozinha (título fica Paga, data do pagamento = data da ocorrência, valor pago creditado no banco); 02 e 11 só informam; qualquer outra vai para conferência manual.

Testado no dev em 25/09 com dados de teste: emitir → imprimir → remessa (título vai para "Em remessa") → retorno sintético com liquidação → título "Paga" e banco creditado.

## Correção de 25/09 no código de barras (leia antes de emitir em produção)

O **campo livre** do código de barras estava montado fora da especificação pública do Sicoob (nosso número em 10 posições e parcela em 1). Passou a ser:

`carteira(1) + cooperativa(4) + modalidade(2) + código do cliente(7) + nosso número(7) + DV(1) + parcela(3, "001")`

- **Código do cliente**: se o campo do banco ficar vazio, usa **conta + dígito** (Sol Life: 51215 + 0 → `0512150`). Se o boleto impresso pelo Sicoob mostrar outro código em "Agência / Código do Beneficiário", digite esse código no banco.
- O nosso número passa a ter no máximo 7 dígitos (até 9.999.999).
- **Não existe ainda teste contra um boleto real do Sicoob.** O que fecha o assunto: a **linha digitável de um boleto impresso pelo sistema antigo** de um título que também está numa remessa (ex.: nosso número 1200, vencimento 06/10/2026, R$ 525,53, "JURACY DOS SANTOS ARAUJO"). Com ela o teste passa a comparar o código de barras inteiro.
- Títulos emitidos **antes** desta correção têm o código antigo gravado; a tela "Ver" e o PDF recalculam na hora, então saem certos. O que foi enviado ao banco (remessa) não muda, porque a remessa não leva o código de barras.

## Checklist para o primeiro boleto real da Sol Life (produção)

1. Publicar as `firestore.rules` em produção (o dono faz) e esperar o deploy do front.
2. Bancos → Sicoob: agência **3049**, conta **51215**, dígito **0**, CNPJ do cedente, nome do cedente (como no sistema antigo), multa 2 %, juros 10 % a.m., instrução (até 40 caracteres).
3. **Próximo nosso número**: maior que o último usado no sistema antigo **e** em qualquer remessa já enviada (no retorno de 23/09 o maior foi 1330 — conferir se o arquivo de 24/09 usou números maiores).
4. **Próxima remessa**: seguinte ao último arquivo enviado ao banco.
5. Cliente do teste com CPF/CNPJ, CEP, cidade e UF completos.
6. Emitir um boleto de valor baixo, **Imprimir**, **Gerar remessa**, enviar ao Sicoob, conferir no retorno a ocorrência 02 (entrada confirmada) e só então pagar pela linha digitável (app do banco).
7. Depois do pagamento, baixar o retorno do dia seguinte e **Importar retorno**: a ocorrência 06 dá a baixa.

## Pontos em aberto

- Confirmar o código de barras com um boleto real (acima).
- Layout do retorno: só a ocorrência 06 foi vista com pagamento; a 04 com valor pago segue em conferência manual até o significado ser confirmado com o banco.
- O layout da remessa parte de um arquivo real da Sol Life; outra empresa cedente ou outro convênio pede nova homologação.
