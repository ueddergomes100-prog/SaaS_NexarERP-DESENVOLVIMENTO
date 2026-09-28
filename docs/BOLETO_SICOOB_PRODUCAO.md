# Boleto Sicoob — como emitir em produção (Sol Life)

Atualizado em 2026-09-28.

**O código de barras está confirmado.** Em 2026-09-28 o dono trouxe um boleto real da Sol Life
impresso pelo Sicoob (nosso número 918-4, vencimento 24/08/2026, R$ 677,97) e o código de barras
calculado pelo sistema bateu **dígito a dígito** com o do boleto — fator de vencimento, valor,
campo livre inteiro e DV geral. Ver o teste `codigo de barras bate digito a digito com boleto real
impresso pelo Sicoob` em `tests/boletoCnabDomain.test.ts`.

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

- **Código do cliente — ATENÇÃO, isto é obrigatório configurar pra Sol Life**: o boleto real conferido em 28/09 mostra "Agência/Código Beneficiário: 3049/131877-2" — ou seja, o código do cliente da Sol Life no Sicoob é **131877-2**, e **não** é derivado da conta (51215-0 dá `0512150`, que é diferente e errado). O fallback conta+DV só existe pra convênio que usa a própria conta como código de beneficiário — não é o caso daqui. **No cadastro do banco (Financeiro → Bancos → Sicoob), o campo "Código do cliente" tem que estar preenchido com `1318772`** antes de emitir qualquer boleto real.
- O nosso número passa a ter no máximo 7 dígitos (até 9.999.999).
- **Confirmado contra boleto real do Sicoob em 2026-09-28** (ver nota no topo do arquivo). Títulos emitidos **antes** desta correção (25/09) têm o código antigo gravado; a tela "Ver" e o PDF recalculam na hora, então saem certos. O que foi enviado ao banco (remessa) não muda, porque a remessa não leva o código de barras.

## Checklist para o primeiro boleto real da Sol Life (produção)

1. Publicar as `firestore.rules` em produção (o dono faz) e esperar o deploy do front.
2. Bancos → Sicoob: agência **3049**, conta **51215**, dígito **0**, **código do cliente `1318772`** (obrigatório, ver acima), CNPJ do cedente, nome do cedente (como no sistema antigo), multa 2 %, juros 10 % a.m., instrução (até 40 caracteres).
3. **Próximo nosso número**: maior que o último usado no sistema antigo **e** em qualquer remessa já enviada (no retorno de 23/09 o maior foi 1330 — conferir se o arquivo de 24/09 usou números maiores).
4. **Próxima remessa**: seguinte ao último arquivo enviado ao banco.
5. Cliente do teste com CPF/CNPJ, CEP, cidade e UF completos.
6. Emitir um boleto de valor baixo, **Imprimir**, **Gerar remessa**, enviar ao Sicoob, conferir no retorno a ocorrência 02 (entrada confirmada) e só então pagar pela linha digitável (app do banco).
7. Depois do pagamento, baixar o retorno do dia seguinte e **Importar retorno**: a ocorrência 06 dá a baixa.

## Pontos em aberto

- Layout do retorno: só a ocorrência 06 foi vista com pagamento; a 04 com valor pago segue em conferência manual até o significado ser confirmado com o banco.
- O layout da remessa parte de um arquivo real da Sol Life; outra empresa cedente ou outro convênio pede nova homologação.
