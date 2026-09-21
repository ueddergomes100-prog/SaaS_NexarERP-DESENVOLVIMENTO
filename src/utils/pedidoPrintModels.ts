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
  {
    id: 'pre-venda',
    name: 'Pré-venda (modelo Sol Natus)',
    description: 'Folha A4 no formato da pré-venda do sistema antigo: quadro da empresa, dados do cliente, itens com matrícula e marca, totais e rodapé com usuário e hora.',
  },
] as const;

export type PedidoPrintModelId = (typeof PEDIDO_PRINT_MODELS)[number]['id'];
