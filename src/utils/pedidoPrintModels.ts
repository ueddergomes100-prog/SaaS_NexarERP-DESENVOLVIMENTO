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
  {
    id: 'pre-venda-simples',
    name: 'Pré-venda simplificada (modelo Jomarly)',
    description: 'O mesmo formato da pré-venda, sem marca, contrato e total de peças, com o nome do cliente em destaque e "Cód." no lugar de "Matric.".',
  },
] as const;

export type PedidoPrintModelId = (typeof PEDIDO_PRINT_MODELS)[number]['id'];

/*
 * MODELO DE IMPRESSAO DA FRENTE DE CAIXA (27/11/2026, pedido do dono: "tem gente que
 * nao tem a impressora fiscal pequena"). Configuracoes da filial: o cupom da bobina
 * (padrao) ou um dos modelos do Pedido de Venda. Vale para o cupom NAO fiscal da
 * venda (e a 2a via do F9); a NFC-e continua saindo pelo PDF da nota.
 */
export const MODELO_CUPOM_DO_CAIXA = 'cupom';
export const MODELOS_IMPRESSAO_CAIXA = [
  {
    id: MODELO_CUPOM_DO_CAIXA,
    name: 'Cupom (impressora pequena)',
    description: 'Cupom na impressora térmica de bobina (80 mm), como sempre foi.',
  },
  ...PEDIDO_PRINT_MODELS,
] as const;

export type ModeloImpressaoCaixaId = typeof MODELO_CUPOM_DO_CAIXA | PedidoPrintModelId;

/** O que esta' gravado em `modeloImpressaoCaixa`; sem nada (ou valor estranho), o cupom. */
export const modeloDeImpressaoDoCaixa = (config: { modeloImpressaoCaixa?: unknown } | null | undefined): ModeloImpressaoCaixaId => {
  const escolhido = String(config?.modeloImpressaoCaixa ?? '');
  return (MODELOS_IMPRESSAO_CAIXA.some((m) => m.id === escolhido) ? escolhido : MODELO_CUPOM_DO_CAIXA) as ModeloImpressaoCaixaId;
};
