/**
 * TOTAL DIGITADO VIRA DESCONTO (pedido do cliente, 15/10/2026).
 *
 * Na hora da venda o vendedor fecha um valor redondo com o cliente: a venda
 * deu R$ 1.000,00, ele digita 850 e os R$ 150,00 vao sozinhos para o desconto
 * GERAL, em reais. Nada mais muda: o limite de desconto da empresa, a senha de
 * aprovacao e o desconto do cadastro do cliente continuam conferindo o desconto
 * resultante, exatamente como se ele tivesse sido digitado no campo de desconto.
 *
 * Regra (tudo em centavos):
 *   desconto geral = (itens - descontos dos itens) + frete + encargos - total digitado
 * O total digitado substitui o desconto geral que estava no campo (nao soma).
 * Nao da para cobrar MAIS que o total sem desconto (isso e' mudar preco) nem
 * descontar mais que os itens (frete e encargos nao recebem desconto).
 */

const formatarReais = (centavos: number): string => (
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
);

/**
 * Valor digitado pelo vendedor -> centavos. Aceita "850", "850,5", "1.000,00",
 * "R$ 1.000,00" e "1000.50". Devolve NaN quando nao e' um valor.
 */
export const centavosDoValorDigitado = (texto: string): number => {
  let limpo = String(texto ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!limpo) return Number.NaN;
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  // "1.000" / "12.500" sem virgula: ponto de milhar, nao decimal.
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) limpo = limpo.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return Number.NaN;
  return Math.round(Number(limpo) * 100);
};

export type ResultadoTotalDigitado = { ok: true; descontoCents: number } | { ok: false; erro: string };

export const descontoParaOTotalDigitado = (a: {
  /** Itens menos os descontos dos itens (a base do desconto geral). */
  subtotalCents: number;
  /** Frete + encargos (nao recebem desconto). */
  acrescimosCents: number;
  totalDigitadoCents: number;
}): ResultadoTotalDigitado => {
  if (!Number.isFinite(a.totalDigitadoCents) || a.totalDigitadoCents < 0) {
    return { ok: false, erro: 'Digite o total da venda em reais, por exemplo 850 ou 850,00.' };
  }
  const subtotal = Math.max(0, Math.round(a.subtotalCents));
  const acrescimos = Math.max(0, Math.round(a.acrescimosCents));
  const cheio = subtotal + acrescimos;
  if (a.totalDigitadoCents > cheio) {
    return {
      ok: false,
      erro: `O total digitado (${formatarReais(a.totalDigitadoCents)}) é maior que o total sem desconto (${formatarReais(cheio)}). Para cobrar mais, ajuste o preço dos itens.`,
    };
  }
  const desconto = cheio - a.totalDigitadoCents;
  if (desconto > subtotal) {
    return {
      ok: false,
      erro: `O total não pode ficar abaixo de ${formatarReais(acrescimos)}: frete e encargos não recebem desconto.`,
    };
  }
  return { ok: true, descontoCents: desconto };
};
