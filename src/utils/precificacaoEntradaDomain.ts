import { margemMarkup, precoParaMargem } from './precificacaoDomain';

/*
 * PRECIFICAR NA ENTRADA DA NOTA (pedido do dono, 2026-09-24).
 *
 * O outro ERP mostra, na propria entrada, custo, lucro, markup, preco de venda
 * e venda minima, em varejo e atacado. Aqui: a pessoa ve o CUSTO REAL da
 * entrada (com frete, IPI, ST, desconto...) e define o preco ja pelo markup
 * ou pelo valor. Markup e' sobre o CUSTO (80% = custo x 1,80), o mesmo
 * formato do cadastro do produto.
 *
 * REGRA (a mesma da Precificacao): produto que JA tem preco nunca e'
 * reajustado sozinho; so' item novo (ou sem preco) acompanha o custo, ate' a
 * pessoa mexer no campo.
 */

/** Markup padrao de item novo: o que a importacao ja usava. */
export const MARKUP_PADRAO_ITEM_NOVO = 50;

const arredondar2 = (valor: number): number => Math.round((valor + Number.EPSILON) * 100) / 100;

export const numeroDaTela = (texto: string): number => {
  const numero = Number(String(texto ?? '').replace(',', '.'));
  return Number.isFinite(numero) ? numero : 0;
};

/** Preco que resulta de um markup (em %) sobre o custo. null se faltar custo ou markup invalido. */
export const precoPeloMarkup = (custo: number, markupTexto: string): number | null => {
  if (!(custo > 0) || String(markupTexto).trim() === '') return null;
  const markup = Number(String(markupTexto).replace(',', '.'));
  if (!Number.isFinite(markup) || markup <= -100) return null;
  return arredondar2(precoParaMargem(custo, markup));
};

/** Markup (em %, uma casa) que o preco tem sobre o custo. Vazio quando nao da para calcular. */
export const markupDoPreco = (preco: number, custo: number): string => (
  custo > 0 && preco > 0 ? margemMarkup(preco, custo).toFixed(1) : ''
);

export const precoPadraoDeItemNovo = (custo: number): number => (
  custo > 0 ? arredondar2(precoParaMargem(custo, MARKUP_PADRAO_ITEM_NOVO)) : 0
);

/** Preco minimo de venda dado o desconto maximo permitido (%). */
export const vendaMinima = (preco: number, descontoMaximoPercentual: number): number => (
  preco > 0 ? arredondar2(preco * (1 - Math.min(100, Math.max(0, descontoMaximoPercentual)) / 100)) : 0
);

export const lucroPorUnidade = (preco: number, custo: number): number => arredondar2(preco - custo);

export interface EntradaDeAvisoDePreco {
  custo: number;
  precoVarejo: number;
  atacadoAtivo: boolean;
  precoAtacado: number;
  descontoMaximoPercentual: number;
}

/** Avisos em portugues sobre o preco digitado (nao impedem: quem decide e' a pessoa). */
export const avisosDePreco = (entrada: EntradaDeAvisoDePreco): string[] => {
  const avisos: string[] = [];
  if (entrada.custo > 0 && entrada.precoVarejo > 0 && entrada.precoVarejo < entrada.custo) {
    avisos.push('O preço de venda está abaixo do custo: você venderia com prejuízo.');
  }
  if (entrada.descontoMaximoPercentual > 100 || entrada.descontoMaximoPercentual < 0) {
    avisos.push('O desconto máximo precisa estar entre 0% e 100%.');
  } else if (entrada.custo > 0 && entrada.precoVarejo > 0 && entrada.precoVarejo >= entrada.custo
    && vendaMinima(entrada.precoVarejo, entrada.descontoMaximoPercentual) < entrada.custo) {
    avisos.push('Com o desconto máximo, a venda mínima fica abaixo do custo.');
  }
  if (entrada.atacadoAtivo) {
    if (!(entrada.precoAtacado > 0)) avisos.push('Informe o preço de atacado ou desligue o atacado deste item.');
    else if (entrada.precoVarejo > 0 && entrada.precoAtacado > entrada.precoVarejo) avisos.push('O preço de atacado está maior que o de varejo.');
    else if (entrada.custo > 0 && entrada.precoAtacado < entrada.custo) avisos.push('O preço de atacado está abaixo do custo.');
  }
  return avisos;
};

/** Margem do MESMO preco antes e depois do custo novo, para o produto que ja tinha preco. */
export const variacaoDeMargem = (preco: number, custoAntes: number, custoDepois: number): { antes: number | null; depois: number | null } => ({
  antes: preco > 0 && custoAntes > 0 ? margemMarkup(preco, custoAntes) : null,
  depois: preco > 0 && custoDepois > 0 ? margemMarkup(preco, custoDepois) : null,
});
