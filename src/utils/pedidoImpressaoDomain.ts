// Marca de "ja foi impresso" no pedido de venda (2026-09-23, pedido do dono:
// o sistema antigo tem uma coluna "Imp." que mostra isso de cara). So cobre
// o documento de venda (Recibo/Pré-venda) -- a Minuta de Entrega e' outro
// papel (lista de separacao), com o proprio historico na Conferencia.

export const MENSAGEM_SEGUNDA_VIA = 'Este pedido já foi impresso antes — esta é a 2ª via.';

export const MENSAGEM_SEGUNDA_VIA_MINUTA = 'A minuta deste pedido já foi impressa antes — esta é a 2ª via.';

export const mensagemSegundaViaMinutaLote = (quantidade: number): string => (
  quantidade === 1
    ? 'A minuta de 1 dos pedidos selecionados já tinha sido impressa antes.'
    : `A minuta de ${quantidade} dos pedidos selecionados já tinha sido impressa antes.`
);

export type ViasMinuta = 1 | 2;

/** Campos gravados no pedido quando a MINUTA e' impressa. Fica separado do
 *  `impresso` (Recibo/Pre-venda) pra a 2a via de um papel nao aparecer so'
 *  porque o outro ja' saiu -- a coluna "Imp." da lista acende com qualquer um. */
export const PEDIDO_CAMPO_MINUTA_IMPRESSA = 'minutaImpressa';

export const mensagemSegundaViaLote = (quantidade: number): string => (
  quantidade === 1
    ? '1 dos pedidos selecionados já tinha sido impresso antes — será a 2ª via.'
    : `${quantidade} dos pedidos selecionados já tinham sido impressos antes — serão a 2ª via.`
);
