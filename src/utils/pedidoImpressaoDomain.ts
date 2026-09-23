// Marca de "ja foi impresso" no pedido de venda (2026-09-23, pedido do dono:
// o sistema antigo tem uma coluna "Imp." que mostra isso de cara). So cobre
// o documento de venda (Recibo/Pré-venda) -- a Minuta de Entrega e' outro
// papel (lista de separacao), com o proprio historico na Conferencia.

export const MENSAGEM_SEGUNDA_VIA = 'Este pedido já foi impresso antes — esta é a 2ª via.';

export const mensagemSegundaViaLote = (quantidade: number): string => (
  quantidade === 1
    ? '1 dos pedidos selecionados já tinha sido impresso antes — será a 2ª via.'
    : `${quantidade} dos pedidos selecionados já tinham sido impressos antes — serão a 2ª via.`
);
