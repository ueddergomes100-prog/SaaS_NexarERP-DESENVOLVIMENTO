/**
 * Modelos de impressao do ORCAMENTO (23/11/2026, pedido do dono: "2 modelos
 * tipo os de pedido de venda, mas com cara de orcamento"). O escolhido em
 * Configuracoes vale para imprimir E para o PDF enviado ao cliente.
 */
export const DEFAULT_ORCAMENTO_PRINT_MODEL = 'padrao';

export const ORCAMENTO_PRINT_MODELS = [
  {
    id: 'padrao',
    name: 'Modelo padrão',
    description: 'Folha A4 com dados da empresa e do cliente, serviços e peças em tabelas separadas, condições comerciais e assinaturas.',
  },
  {
    id: 'meia-folha',
    name: 'Meia folha',
    description: 'Orçamento compacto em meia folha (A5 paisagem), no mesmo visual do pedido em meia folha, com validade e "de acordo" do cliente.',
  },
  {
    id: 'simples',
    name: 'Orçamento simplificado (modelo DAV)',
    description: 'No formato da pré-venda simplificada: quadro da empresa com logo, cliente em destaque, itens com código, totais e validade no pé da folha.',
  },
] as const;

export type OrcamentoPrintModelId = (typeof ORCAMENTO_PRINT_MODELS)[number]['id'];

export const modeloDeImpressaoDoOrcamento = (config: { modeloImpressaoOrcamento?: unknown } | null | undefined): OrcamentoPrintModelId => {
  const escolhido = String(config?.modeloImpressaoOrcamento ?? '');
  return (ORCAMENTO_PRINT_MODELS.some((m) => m.id === escolhido) ? escolhido : DEFAULT_ORCAMENTO_PRINT_MODEL) as OrcamentoPrintModelId;
};

/** Data limite da validade: emissao + dias (AAAA-MM-DD em horario local). Vazio sem data. */
export const validadeAte = (emissao: Date | null, dias: unknown): Date | null => {
  if (!emissao || Number.isNaN(emissao.getTime())) return null;
  const n = Number.parseInt(String(dias ?? ''), 10);
  const total = Number.isFinite(n) && n > 0 ? n : 15;
  const fim = new Date(emissao.getFullYear(), emissao.getMonth(), emissao.getDate() + total);
  return fim;
};
