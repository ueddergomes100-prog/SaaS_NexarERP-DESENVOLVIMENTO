# Treinamento — Romaneio de Entrega

Roteiro para apresentar o Romaneio de Entrega ao cliente. Escrito em 08/10/2026
a partir do código (`src/pages/Romaneios`, `src/services/romaneioService.ts`,
`src/utils/romaneioDomain.ts`) e da nota "Romaneio de Entrega" do vault.

## 1. O que o romaneio faz (e o que não faz)

O romaneio é a **rota de entrega**: junta pedidos já faturados, sai impresso
com o motorista, acompanha o que foi entregue ou não, e fecha o **acerto** do
motorista na volta (quilometragem, dinheiro recebido, vale, despesas).

O que ele **não** faz, de propósito:

- **Não fatura pedido.** Só entra na rota pedido com situação **Finalizada**.
- **Não dá baixa em título.** O valor que o motorista recebeu na porta do
  cliente é só registro para o acerto. A baixa continua em **Contas a Receber**.
- **Não existe "excluir romaneio".** Existe **Cancelar**, e só antes de
  qualquer entrega registrada (ver seção 5).

## 2. O que configurar antes de usar

### 2.1 Permissões (Configurações › Usuários)

- Dono e Admin já enxergam tudo.
- Funcionário que vai montar e fechar rota: permissão **Romaneio de Entrega**.
- Funcionário que vai cadastrar motorista e veículo: permissão
  **Rotas: Motoristas e Despesas de Viagem**.
- O botão **Configurar** (motivos e itens do acerto) aparece só para dono/Admin.

### 2.2 Motoristas (Operações › Motoristas)

Obrigatório ter pelo menos um. Campos: nome, telefone, CNH, observação.
Sem motorista a rota não libera.

### 2.3 Frota (Operações › Frota), opcional

Veículo com modelo, placa e **motorista padrão**. Ao escolher o motorista no
romaneio, o veículo padrão dele já vem preenchido. Veículo inativo não aparece.

### 2.4 Configurar romaneio (botão "Configurar", dentro de um romaneio)

Duas listas, válidas para a empresa inteira daí em diante:

**Motivos de não entrega** (padrão):
CLIENTE AUSENTE / FECHADO · CLIENTE RECUSOU · ENDEREÇO NÃO ENCONTRADO ·
SEM PAGAMENTO · MERCADORIA AVARIADA · FORA DO HORÁRIO DE RECEBIMENTO · OUTRO.

**Itens do acerto** (padrão), cada um com uma **natureza**:

| Item | Natureza | O que significa no acerto |
|---|---|---|
| VALE/ADIANTAMENTO | adiantamento | dinheiro que o motorista levou; **soma** no saldo |
| COMBUSTÍVEL, HOTEL, DIÁRIA, PEDÁGIO | despesa | gasto na estrada; **diminui** o saldo e pode virar lançamento no financeiro |
| PEDIDOS, PENDÊNCIAS, DEVOLUÇÃO | informativo | só anotação; não entra na conta |

Regras: nome com pelo menos 2 letras, sem repetir, e pelo menos um item em
cada lista. Para apagar um item use a lixeira ao lado dele.

### 2.5 O pedido tem de estar faturado

Na busca de pedidos só aparece pedido **Finalizado**. Pré-venda, orçamento,
pedido aberto ou cancelado não entram. Cada pedido fica **travado** na rota em
que está: não dá para colocar o mesmo pedido em duas rotas abertas.

## 3. Fluxo completo, passo a passo

Situações do romaneio: **Em montagem → Em rota → Fechado** (ou **Cancelado**).

### 3.1 Montar a rota (Em montagem)

1. Operações › **Romaneio de Entrega** › **Novo romaneio**. O número sai sozinho.
2. Cabeçalho: **Nome da rota** (livre, ex.: "Zona rural quarta"), **Motorista***,
   Veículo, **Data de saída***, Horário de saída, KM de saída, Observação.
3. **Adicionar pedidos**: ajuste o período "Faturados de / até", marque os
   pedidos e confirme. Pedido que já está em outra rota aparece travado, com o
   aviso de qual rota.
4. Ordem de entrega: setas **Subir/Descer**, **Ordenar por cidade**, ou
   **Tirar da rota** (lixeira) para remover um pedido.
5. **Salvar** quantas vezes quiser. Em montagem tudo pode ser mudado.
6. **Imprimir**: abre o PDF do romaneio para o motorista (Imprimir / Salvar PDF).

### 3.2 Liberar para entrega

Botão **Liberar para entrega** (verde). O sistema exige: motorista escolhido,
data de saída informada e pelo menos um pedido. Confirme na janela.

A partir daqui a rota está **Em rota**: não dá mais para trocar o motorista nem
adicionar ou tirar pedidos. Veículo, data/horário/KM de saída e observação
ainda podem ser corrigidos com **Salvar**.

### 3.3 Registrar cada entrega (Em rota)

Na coluna **Entrega** de cada pedido, clique em **Registrar**:

- **Entregue**: **Quem recebeu*** (nome), documento (RG/CPF) de quem recebeu,
  **Motorista recebeu (R$)** e **Como** (Dinheiro, Cheque, Pix, Cartão, Boleto),
  observação. Se informou valor, o "Como" é obrigatório.
- **Não entregue**: **Motivo*** (lista configurada) e observação.

Lembre o cliente: o valor recebido **não baixa o título**. Ele serve para o
acerto e para a conferência; a baixa é feita em Contas a Receber.

Errou? Enquanto a rota não for fechada, o botão do pedido vira **Alterar**:
abra, corrija, ou use **Voltar a pendente** para desfazer o registro.

### 3.4 Retorno e acerto (Em rota)

Cartão **Retorno e acerto**, embaixo da lista:

- **KM de chegada** e **Horário de chegada** (KM de chegada não pode ser menor
  que o de saída).
- Linhas do acerto, uma por item configurado: valor e descrição. Deixe em branco
  o que não houve; só linha com valor maior que zero é gravada.
- **Saldo a prestar** (destaque roxo): recebido nas entregas + vale/adiantamento − despesas.
  É o que o motorista tem de devolver para a loja.
- **Observação do acerto**.
- Caixa **"Lançar as despesas no financeiro"** (vem marcada): cada item de
  natureza *despesa* vira um lançamento **Pago** na categoria
  **DESPESAS DE ROTA**, com a data da saída, ligado ao motorista e ao veículo.
  Não mexe no caixa físico da loja (o motorista pagou na estrada). Esses
  lançamentos aparecem em **Rotas e Despesas** e em **Custo por Veículo**.

**Salvar** guarda tudo isso sem fechar ("Dados da rota salvos").

### 3.5 Fechar acerto

Botão **Fechar acerto** (verde). O sistema exige que **toda entrega tenha
desfecho** (entregue ou não entregue). Se faltar, a mensagem lista os pedidos
pendentes. A janela de confirmação mostra quantas entregues, quantas não
entregues e quantas despesas vão para o financeiro.

Depois de fechado:

- A rota fica **Fechada**: não edita mais nada, só **Imprimir**.
- Pedido **entregue** fica preso a essa rota.
- Pedido **não entregue** volta a ficar livre e pode entrar no próximo romaneio.

## 4. Edição: o que pode mudar em cada situação

| Situação | Pode mudar | Não pode |
|---|---|---|
| Em montagem | tudo: motorista, veículo, datas, KM, pedidos, ordem, observação | — |
| Em rota | veículo, data/horário/KM de saída, observação, registro das entregas, retorno e acerto | motorista, adicionar ou tirar pedido |
| Fechado | nada (só Imprimir) | tudo |
| Cancelado | nada (só Imprimir) | tudo |

Atenção na hora de ensinar: **rota fechada não reabre**. Pedido marcado como
entregue por engano fica preso àquela rota, e despesa lançada errada se corrige
no Financeiro. Por isso a confirmação antes de fechar mostra o resumo: peça
para o cliente ler antes de confirmar.

## 5. Cancelar (não existe excluir)

- Botão **Cancelar** (vermelho) aparece só enquanto **nenhuma** entrega foi
  registrada: em montagem, ou em rota com todas ainda pendentes.
- Cancelar libera todos os pedidos para outra rota e guarda o romaneio na aba
  **Cancelado** (fica no histórico, não some).
- Depois de qualquer entrega registrada **não cancela mais**. O caminho é
  marcar o que não foi entregue e **Fechar acerto**.
- Romaneio novo que ainda não foi salvo nem tem número: é só fechar a aba.

## 6. A lista e o relatório

- Abas **Em montagem / Em rota / Fechado / Cancelado / Todos**, com contagem.
- Colunas: Rota, Saída, Motorista, Veículo, Entregas, Valor, Situação.
- **Filtros**: motorista e período de saída.
- **Mais opções › Relatório**: PDF dos últimos 30 dias, ou do período filtrado.

## 7. Como conversa com o resto do sistema

- **Pedidos de Venda**: fature antes; só Finalizado entra na rota.
- **Contas a Receber**: onde se dá baixa no que o motorista recebeu.
- **Rotas e Despesas**: tela de viagem avulsa (sem pedidos). Continua servindo
  para viagem que não é entrega; as despesas do romaneio aparecem lá.
- **Custo por Veículo**: soma as despesas de rota por veículo.
- **Financeiro**: categoria DESPESAS DE ROTA, lançamentos já pagos.

## 8. Roteiro sugerido para a apresentação (40 min)

1. (5 min) Mostrar Motoristas e Frota; cadastrar o motorista real do cliente.
2. (5 min) Abrir um romaneio e **Configurar**: revisar motivos e itens do acerto
   com o cliente, tirar o que ele não usa.
3. (10 min) Montar uma rota de verdade com 2 ou 3 pedidos faturados, ordenar,
   imprimir, liberar.
4. (10 min) Registrar uma entrega com valor recebido e uma não entrega; mostrar
   que o título continua aberto em Contas a Receber.
5. (5 min) Retorno e acerto, caixa das despesas, fechar; ver o lançamento no
   Financeiro e o pedido não entregue livre na próxima rota.
6. (5 min) Perguntas frequentes abaixo.

## 9. Perguntas frequentes

- **O pedido não aparece para adicionar.** Ele não está Finalizado, está fora
  do período do filtro, ou já está em outra rota aberta.
- **Não consigo liberar.** Falta motorista, data de saída ou pedido.
- **Não consigo fechar.** Tem entrega sem desfecho, ou KM de chegada menor que
  o de saída.
- **Não consigo cancelar.** Já tem entrega registrada: feche o acerto.
- **O valor recebido não baixou o título.** Certo, é só registro. Baixa em
  Contas a Receber.
- **O botão Configurar não aparece.** Só dono e Admin configuram.
- **As despesas não foram para o financeiro.** A caixa estava desmarcada, o
  valor ficou zero, ou o item é de natureza adiantamento/informativo.
- **Marquei entregue errado e fechei.** Não reabre. Conferir o resumo antes de
  confirmar o fechamento.

## 10. No app do motorista (app Vendas)

Desde 08/10/2026 o motorista registra as entregas pelo celular, dentro do app
Vendas. O escritório continua montando, liberando e fechando a rota.

- **Permissão**: no usuário, marque **Entregas no app (motorista)**. Marque
  também **Este funcionário é motorista** para a rota aparecer em "Minhas
  rotas" (dono e gestor veem todas).
- **Fluxo no celular**: Início › **Entregas** › toca na rota › aba **Faltam
  entregar** › toca em **Registrar**. Entregue: quem recebeu e documento.
  Não entregue: motivo da lista configurada. Recebeu R$ e como.
- **Valor diferente do pedido**: se o motorista digitar um valor maior ou
  menor que o do pedido, o app exige uma explicação (pagamento parcial,
  abatimento de outra nota). Essa explicação aparece para o escritório na
  linha da entrega, na confirmação de fechar e na impressão.
- **Canhoto**: foto opcional, uma por entrega. Sobe sozinha quando houver
  sinal.
- **Sem sinal**: tudo o que o motorista registra fica no aparelho e sobe
  quando a rede voltar. Se o escritório fechar a rota antes disso, o registro
  atrasado é recusado, por isso feche só depois que o motorista voltou.
- **Mapa e telefone**: cada entrega tem os botões Mapa (abre o Google Maps no
  endereço do cliente) e Ligar.

