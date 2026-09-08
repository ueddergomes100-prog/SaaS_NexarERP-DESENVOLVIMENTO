// Nota Avulsa: compra manual de mercadoria sem XML fiscal, pra empresa que
// nao faz analise fiscal na entrada (ver item 2 do pedido do dono, e a
// ressalva em fiscalDomain.ts sobre isso ficar FORA do gate de
// controlaFiscal -- e a ferramenta pra quem nao controla fiscal).
//
// Mesma dupla ativa/cancelada de tudo que passou a nao ter mais exclusao
// fisica -- nunca existe deleteDoc pra notas_avulsas.

import { toCents } from './financeDomain';

export const STATUS_NOTA_AVULSA_ATIVA = 'ativa';
export const STATUS_NOTA_AVULSA_CANCELADA = 'cancelada';

export type StatusNotaAvulsa = typeof STATUS_NOTA_AVULSA_ATIVA | typeof STATUS_NOTA_AVULSA_CANCELADA;

export type FormaPagamentoNotaAvulsa = 'a_vista' | 'pendente';

export interface NotaAvulsaItem {
  produtoId: string;
  produtoNome: string;
  /** Quantidade na unidade escolhida na compra (KG, ou SC quando o produto
   * tem embalagem e a empresa recebeu em saco). E tambem a base do calculo
   * financeiro (quantidade x precoCusto), nunca convertida. */
  quantidade: number;
  precoCusto: number;
  precoVenda: number;
  /** Presentes so quando a compra foi lancada numa embalagem (nao na
   * unidade base do produto) -- ausentes preserva todo item gravado antes
   * desta feature. */
  embalagemId?: string;
  unidadeSigla?: string;
  fatorConversao?: number;
  /** Quantidade convertida pra unidade base do estoque -- e o numero que de
   * fato soma/subtrai em `estoque.quantidade` na criacao/cancelamento da
   * nota, nunca `quantidade` direto quando ha embalagem. */
  quantidadeBase?: number;
  /** Parte do frete/desconto da nota (rateado por valor, ver
   * ratearValorPorPesos) absorvida por este item -- presentes so quando a
   * nota teve frete/desconto preenchido. Guardados em reais, na unidade do
   * item (nao convertidos pela embalagem, igual precoCusto). */
  freteRateado?: number;
  descontoRateado?: number;
}

/** Um item so entra na nota com produto escolhido, quantidade e custo
 * maiores que zero -- preco de venda pode ficar 0 (produto que a empresa
 * decide precificar depois, no cadastro). */
export const itemNotaAvulsaValido = (item: NotaAvulsaItem): boolean => (
  Boolean(item.produtoId)
  && item.quantidade > 0
  && item.precoCusto > 0
);

export const calcularValorTotalNotaAvulsa = (itens: NotaAvulsaItem[]): number => (
  itens.reduce((total, item) => total + item.quantidade * item.precoCusto, 0)
);

/** Quantidade que efetivamente entra (ou sai, no cancelamento) do estoque --
 * sempre na unidade base. Item sem embalagem nunca teve `quantidadeBase`
 * gravado, e cai em `quantidade` direto -- o comportamento de sempre. */
export const quantidadeEstoqueNotaAvulsaItem = (item: NotaAvulsaItem): number => (
  item.quantidadeBase ?? item.quantidade
);

/** Custo unitario REAL do item (o CMV): o que foi pago por unidade mais a
 * parte do frete, menos a parte do desconto, que couberam a ele. Fica na
 * MESMA unidade em que a compra foi lancada (por saco, se comprou em saco)
 * -- a conversao pra unidade base do estoque acontece depois, dividindo
 * pelo fator da embalagem.
 *
 * Uma funcao so pra tela e pro save usarem a mesma conta: e' este numero
 * que aparece na coluna "CMV Unit." da Nota Avulsa e que vira o
 * `precoCusto` do produto. */
export const custoUnitarioComRateio = (item: NotaAvulsaItem): number => {
  if (!(item.quantidade > 0)) return item.precoCusto;
  const ajuste = (item.freteRateado || 0) - (item.descontoRateado || 0);
  return item.precoCusto + ajuste / item.quantidade;
};

/** Distribui um valor (frete ou desconto da nota) entre pesos -- o valor de
 * cada item (quantidade x custo) -- proporcional a cada peso. Trabalha em
 * centavos e usa o metodo do maior resto: a soma das partes bate SEMPRE
 * exata com o total (nunca sobra nem falta 1 centavo por arredondamento), e
 * o centavo de sobra vai pro item com a maior parte fracionaria, nao sempre
 * pro mesmo (ex: sempre o ultimo).
 *
 * `pesos` vazio ou com soma <= 0 (nao deveria acontecer -- item valido
 * exige quantidade e custo > 0 -- mas defensivo) devolve tudo zero em vez
 * de dividir por zero. */
export const ratearValorPorPesos = (valorTotalRatear: number, pesos: number[]): number[] => {
  const somaPesos = pesos.reduce((soma, peso) => soma + Math.max(0, peso), 0);
  if (somaPesos <= 0 || pesos.length === 0) return pesos.map(() => 0);

  const totalCentavos = toCents(valorTotalRatear);
  const brutos = pesos.map((peso) => (totalCentavos * Math.max(0, peso)) / somaPesos);
  const bases = brutos.map((valor) => Math.floor(valor));
  let faltam = totalCentavos - bases.reduce((soma, valor) => soma + valor, 0);

  const ordemPorResto = brutos
    .map((valor, index) => ({ index, resto: valor - bases[index] }))
    .sort((a, b) => b.resto - a.resto);

  const centavosFinais = [...bases];
  for (let k = 0; k < ordemPorResto.length && faltam > 0; k++) {
    centavosFinais[ordemPorResto[k].index] += 1;
    faltam--;
  }
  return centavosFinais.map((centavos) => centavos / 100);
};
