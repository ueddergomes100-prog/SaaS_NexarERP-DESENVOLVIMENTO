/**
 * Regra unica de quantidade fracionada, aplicada em Pedido de Venda, OS,
 * Orcamento e PDV: so aceita quantidade nao inteira quando
 * unidadeMedidaFracionado === true -- flag que, no cadastro do produto
 * (EstoqueForm.tsx), so fica true quando o produto tem "Produto
 * fracionado" marcado E a Unidade de Medida selecionada tem "Fracionada"
 * marcado (as duas, nao uma ou outra). Sem essa flag, a quantidade tem
 * que ser um inteiro positivo.
 *
 * `casasDecimais`, quando informado, bloqueia quantidade com mais casas
 * decimais do que a unidade permite (ex: KG com casasDecimais=3 aceita
 * 1.234 mas nao 1.2345). Omitido/undefined = sem limite de casas.
 */
export const isValidSaleQuantity = (
  quantidade: number,
  unidadeMedidaFracionado: boolean | undefined,
  casasDecimais?: number,
): boolean => {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return false;
  if (unidadeMedidaFracionado !== true) return Number.isInteger(quantidade);
  if (!casasDecimais || casasDecimais <= 0) return true;
  const factor = 10 ** casasDecimais;
  return Math.abs(quantidade * factor - Math.round(quantidade * factor)) < 1e-6;
};
