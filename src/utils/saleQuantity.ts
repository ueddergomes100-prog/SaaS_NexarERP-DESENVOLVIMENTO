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

/**
 * O que a pessoa esta' digitando no campo de quantidade (25/11/2026, videos
 * da Jomarly). Antes o campo gravava a cada tecla: apagar o "1" para digitar
 * "20" virava zero e a tela travava com "nao aceita quantidade quebrada"; em
 * M3, "0,3" travava ja' no "0". Aqui so' sai numero quando a digitacao esta'
 * completa e acima de zero:
 *  - vazio, "0", "0,", "0,0", "1," (no meio da digitacao) -> null: o campo
 *    guarda o texto e nada muda no item;
 *  - "20", "0,3", "1.5" -> o numero (virgula ou ponto).
 * A regra de unidade (inteiro/casas) continua em isValidSaleQuantity, na tela.
 */
export const lerQuantidadeDigitada = (texto: string): number | null => {
  const limpo = String(texto ?? '').trim();
  if (!/^\d+([.,]\d+)?$/.test(limpo)) return null;
  const numero = Number(limpo.replace(',', '.'));
  return Number.isFinite(numero) && numero > 0 ? numero : null;
};
