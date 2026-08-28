export const DEFAULT_PEDIDO_PRINT_MODEL = 'padrao';

export const PEDIDO_PRINT_MODELS = [
  {
    id: 'padrao',
    name: 'Modelo padrão',
    description: 'Recibo completo em folha A4, com dados do cliente e assinaturas.',
  },
  {
    id: 'meia-folha',
    name: 'Meia folha',
    description: 'Pedido de venda compacto em meia folha (A5 paisagem), com parcelas e situação do pedido.',
  },
] as const;

export type PedidoPrintModelId = (typeof PEDIDO_PRINT_MODELS)[number]['id'];
