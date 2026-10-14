import { STATUS_EM_ANALISE, isPedidoAberto, isPedidoCancelado } from './preVendaDomain';

/**
 * COR DO "CHIP" DE STATUS (design de 14/10/2026).
 *
 * As listas mostram o status como uma pilula colorida (.hd-chip, em
 * visualDesktop.css). A cor sai daqui, nunca da tela, para o mesmo status ter
 * a mesma cor no Dashboard, na lista de Pedidos de Venda e no Pedido.
 * O que e' aberto/cancelado continua decidido em preVendaDomain.ts.
 */

export type TomChip = 'verde' | 'ambar' | 'verm' | 'azul' | 'violeta' | 'cinza';

/** Pre-venda azul, pedido do agente (Em Analise) violeta, cancelado cinza; venda faturada (inclusive status legado) verde. */
export const tomDoStatusPedido = (status: unknown): TomChip => {
  if (isPedidoCancelado(status)) return 'cinza';
  if (String(status ?? '').trim() === STATUS_EM_ANALISE) return 'violeta';
  if (isPedidoAberto(status)) return 'azul';
  return 'verde';
};

/** Contador de pendencia: zerado fica cinza (nada a fazer); com algo, a cor do alerta. */
export const tomDoContador = (quantidade: number, tomComPendencia: TomChip): TomChip => (
  quantidade > 0 ? tomComPendencia : 'cinza'
);
