/**
 * QUAIS NOTAS APARECEM NA TELA DE NOTAS FISCAIS (2026-09-21).
 *
 * Pedido do usuario: nota cancelada some da tela. Uma nota "cancelada" pode
 * ser de dois tipos, e cada um tem uma regra propria:
 *
 *  1. Cancelada de verdade (status `canceled`, cancelamento aceito pela
 *     SEFAZ/prefeitura) -- fim de vida, sai da lista.
 *  2. Nota que NAO chegou a valer (rejeitada, denegada, na fila, criada...) de
 *     um pedido/pre-venda que foi CANCELADO -- e' lixo de um pedido que nao
 *     existe mais, sai da lista.
 *
 * O que NUNCA some: nota AUTORIZADA, mesmo de pedido cancelado. Ela e'
 * documento fiscal valido na SEFAZ e so' deixa de valer com o cancelamento
 * fiscal (botao "Cancelar" da propria nota). Esconde-la faria a empresa
 * esquecer uma nota ativa.
 *
 * Quem precisar conferir o historico liga "Mostrar canceladas".
 */

export interface NotaParaVisibilidade {
  status?: string;
  pedidoId?: string | null;
}

/** A Spedy grafa `canceled`; aceita a grafia britanica por seguranca. */
export const notaCancelada = (status: string | undefined): boolean => (
  status === 'canceled' || status === 'cancelled'
);

export const notaDeveAparecer = (
  nota: NotaParaVisibilidade,
  pedidosCanceladosIds: ReadonlySet<string>,
  mostrarCanceladas: boolean,
): boolean => {
  if (mostrarCanceladas) return true;
  if (notaCancelada(nota.status)) return false;
  const pedidoCancelado = Boolean(nota.pedidoId) && pedidosCanceladosIds.has(String(nota.pedidoId));
  if (pedidoCancelado && nota.status !== 'authorized') return false;
  return true;
};

/**
 * Nota so' pode ser emitida a partir de PEDIDO: pre-venda ainda nao e'
 * venda (o estoque so' esta separado), entao a nota espera ela virar pedido.
 * Devolve a mensagem em portugues quando o pedido nao pode virar nota, ou
 * null quando pode.
 */
export const motivoPedidoNaoEmiteNota = (status: string | undefined): string | null => {
  if (status === 'Finalizada') return null;
  if (status === 'Pré-venda') {
    return 'Esta é uma pré-venda. A nota fiscal só pode ser emitida depois que ela virar pedido: abra a pré-venda em Pedidos de Venda e finalize a venda primeiro.';
  }
  if (status === 'Cancelada') {
    return 'Este pedido foi cancelado e não pode gerar nota fiscal.';
  }
  if (status === 'Em Análise') {
    return 'Este pedido ainda está em análise. A nota fiscal só pode ser emitida depois que ele for finalizado.';
  }
  return 'Este pedido ainda não foi finalizado. A nota fiscal só pode ser emitida a partir de um pedido finalizado.';
};
