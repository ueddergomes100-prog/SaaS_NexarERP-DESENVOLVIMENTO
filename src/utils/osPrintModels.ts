export const DEFAULT_OS_PRINT_MODEL = 'padrao';

export const OS_PRINT_MODELS = [
  {
    id: 'padrao',
    name: 'Modelo padrão',
    description: 'Recibo compacto atual, com cliente, veículo, itens e assinaturas.',
  },
  {
    id: 'personalizado-01',
    name: 'Personalizado 01',
    description: 'Modelo técnico completo, com atendimento, execução, materiais e pagamento.',
  },
] as const;

export type OsPrintModelId = (typeof OS_PRINT_MODELS)[number]['id'];
