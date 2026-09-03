/**
 * Estado do Pedido de Venda: o que e' venda faturada, o que ainda esta em
 * aberto e o que foi cancelado. Funcoes puras, sem Firestore.
 *
 * ---------------------------------------------------------------------------
 * O MODELO DE ESTADO
 * ---------------------------------------------------------------------------
 *
 * Um documento em `pedidos_venda` vive num de tres estados:
 *
 *   ABERTO      'Pré-venda'   -- gravado no balcao, ainda nao faturado
 *               'Em Análise'  -- veio do agente de WhatsApp, aguardando
 *                                confirmacao de alguem da loja
 *   FATURADO    'Finalizada'  -- virou venda de verdade
 *   CANCELADO   'Cancelada'
 *
 * Os DOIS estados abertos se comportam igual pro sistema: reservam estoque
 * sem dar baixa, nao geram lancamento financeiro nenhum, e NAO entram em
 * faturamento nem em caixa. A diferenca entre eles e' so a ORIGEM (quem
 * criou), que governa quais permissoes o usuario precisa ter -- ver
 * resolveOrigemPedido() abaixo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISSO EXISTE COMO MODULO SEPARADO
 * ---------------------------------------------------------------------------
 *
 * Antes da pre-venda, cada tela decidia sozinha o que era venda, quase sempre
 * escrevendo `status !== 'Cancelada'`. Isso ja estava ERRADO antes desta
 * feature: pedido 'Em Análise' do agente (que nunca gerou financeiro) era
 * contado como faturamento no relatorio de vendas e no dashboard. Com
 * pre-venda -- que o cliente usa o dia inteiro -- isso viraria receita
 * fantasma em escala.
 *
 * Entao a regra passa a morar aqui e todas as telas perguntam pro modulo:
 *
 *   contaComoFaturamento(status)  -> pode somar em receita/caixa/comissao?
 *   isPedidoAberto(status)        -> esta em aberto (reserva, nao fatura)?
 *
 * NUNCA volte a comparar status na tela. Um estado aberto novo (ex: um
 * segundo canal de pedido) so precisaria entrar em STATUS_PEDIDO_ABERTO
 * pra todo o sistema passar a trata-lo certo de uma vez.
 */

export const STATUS_PRE_VENDA = 'Pré-venda';
export const STATUS_EM_ANALISE = 'Em Análise';
export const STATUS_FINALIZADA = 'Finalizada';
export const STATUS_CANCELADA = 'Cancelada';

/** Todo estado em que o pedido existe mas ainda NAO e' venda. */
export const STATUS_PEDIDO_ABERTO: readonly string[] = [STATUS_PRE_VENDA, STATUS_EM_ANALISE];

/** Pedido gravado mas ainda nao faturado: reserva estoque, nao gera
 * financeiro, nao entra em relatorio de faturamento. */
export const isPedidoAberto = (status: unknown): boolean =>
  STATUS_PEDIDO_ABERTO.includes(String(status ?? '').trim());

export const isPedidoCancelado = (status: unknown): boolean =>
  String(status ?? '').trim() === STATUS_CANCELADA;

/**
 * Este pedido pode ser somado em faturamento, caixa, comissao e relatorio de
 * vendas?
 *
 * Deliberadamente escrito como "nao e' aberto E nao e' cancelado", nao como
 * "e' Finalizada": existem pedidos legados gravados com outros status (ex:
 * 'concluida') que sempre contaram como venda, e trocar isso por uma
 * comparacao positiva sumiria com faturamento historico do cliente.
 */
export const contaComoFaturamento = (status: unknown): boolean =>
  !isPedidoAberto(status) && !isPedidoCancelado(status);

export type OrigemPedido = 'balcao' | 'agente';

export interface PedidoComOrigem {
  status?: unknown;
  origem?: unknown;
}

/**
 * De onde o pedido veio. Governa QUAIS permissoes o usuario precisa ter:
 * quem pode mexer em pre-venda do balcao nao ganha automaticamente acesso a
 * pedido que chegou pelo WhatsApp, e vice-versa.
 *
 * Fallback historico: pedido 'Em Análise' gravado ANTES desta feature nao tem
 * o campo `origem` -- e o unico jeito de ele existir era o agente ter criado,
 * porque nenhuma tela do sistema gravava esse status. Por isso 'Em Análise'
 * sem origem = 'agente'. Qualquer outro caso sem origem e' do balcao.
 */
export const resolveOrigemPedido = (pedido: PedidoComOrigem | null | undefined): OrigemPedido => {
  const origem = String(pedido?.origem ?? '').trim();
  if (origem === 'agente' || origem === 'balcao') return origem;
  return String(pedido?.status ?? '').trim() === STATUS_EM_ANALISE ? 'agente' : 'balcao';
};

/** Config do tenant: `trabalhaComPreVenda` liga o botao "Gravar Pré-venda"
 * na tela de Pedido de Venda. Desligado = sistema se comporta exatamente
 * como antes desta feature (so "Finalizar Venda"). */
export const DEFAULT_TRABALHA_COM_PRE_VENDA = false;

export const parseTrabalhaComPreVenda = (value: unknown): boolean => value === true;

/** Config do tenant: permite alterar a forma de pagamento de uma venda ja
 * finalizada. Ver a hierarquia config -> permissao na Fatia 3. */
export const DEFAULT_ALTERAR_PAGAMENTO_VENDA_FINALIZADA = false;

export const parseAlterarPagamentoVendaFinalizada = (value: unknown): boolean => value === true;

/** Config do tenant: a empresa recebe pedido pelo agente digital (WhatsApp).
 * Desligado (padrao) = a aba "Pendentes" nem aparece na listagem de Pedidos
 * de Venda, ja que nunca vai existir pedido 'Em Análise' pra mostrar la. */
export const DEFAULT_AGENTE_DIGITAL_ATIVO = false;

export const parseAgenteDigitalAtivo = (value: unknown): boolean => value === true;
