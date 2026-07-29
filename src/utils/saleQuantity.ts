/**
 * Regra unica de quantidade fracionada, aplicada em Pedido de Venda, OS
 * e Orcamento: so aceita quantidade nao inteira quando a unidade de
 * medida do produto esta marcada como fracionada no cadastro de
 * Unidades de Medida (unidadeMedidaFracionado === true). Sem essa flag,
 * a quantidade tem que ser um inteiro positivo.
 */
export const isValidSaleQuantity = (
  quantidade: number,
  unidadeMedidaFracionado: boolean | undefined,
): boolean => {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return false;
  if (unidadeMedidaFracionado === true) return true;
  return Number.isInteger(quantidade);
};
