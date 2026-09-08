// Precificacao: comparar a margem de HOJE com a margem do dia em que o
// preco de venda foi definido.
//
// REGRA DE PRODUTO (decisao do dono, 2026-09-08): o sistema NUNCA reajusta
// preco sozinho. Comprou mais caro? O preco de venda fica exatamente onde
// esta -- o sistema so AVISA que a margem mudou, e quem decide aumentar (ou
// aceitar a margem menor) e' a pessoa. Por isso este arquivo so calcula e
// compara; nao existe nenhuma funcao aqui que "corrija" preco.
//
// A base da comparacao e' um FATO gravado no produto
// (`custoNaUltimaPrecificacao`): quanto custava a mercadoria no dia em que
// aquele preco de venda foi definido. Guardar o custo, e nao a margem
// pretendida, deixa a mensagem concreta e conferivel: "quando voce definiu
// R$ 79,20, o custo era R$ 44,00".

export type DirecaoMargem = 'subiu' | 'caiu' | 'manteve';

export interface ComparacaoMargem {
  /** Markup % que o preco tinha no dia em que foi definido. */
  margemAnterior: number;
  /** Markup % que o mesmo preco tem com o custo de hoje. */
  margemAtual: number;
  direcao: DirecaoMargem;
  /** margemAtual - margemAnterior, em PONTOS percentuais. */
  diferencaPontos: number;
}

/** Margem no formato que o sistema ja usava no cadastro do produto: markup
 * sobre o CUSTO (80% = custo x 1,80), nao margem sobre a venda. */
export const margemMarkup = (precoVenda: number, custo: number): number => (
  custo > 0 ? ((precoVenda - custo) / custo) * 100 : 0
);

/** Preco que devolve uma margem desejada, dado o custo atual. Existe pro
 * botao "voltar para a margem de X%" -- acao que a PESSOA clica, nunca
 * aplicada automaticamente. */
export const precoParaMargem = (custo: number, margemPercentual: number): number => (
  custo * (1 + margemPercentual / 100)
);

/** Tolerancia pra nao acusar "margem mudou" por diferenca de arredondamento
 * de centavo (ex: custo 44,00 -> 44,004). */
const TOLERANCIA_PONTOS = 0.05;

/**
 * Compara a margem de hoje com a do dia da precificacao. Devolve `null`
 * quando a comparacao nao faz sentido -- produto sem preco, sem custo, ou
 * precificado antes deste recurso existir (sem base gravada). Nesse caso a
 * tela simplesmente nao mostra aviso nenhum, em vez de inventar um numero.
 */
export const compararMargem = (
  precoVenda: number,
  custoNaUltimaPrecificacao: number | null | undefined,
  custoAtual: number,
): ComparacaoMargem | null => {
  const custoBase = Number(custoNaUltimaPrecificacao);
  if (!(custoBase > 0) || !(custoAtual > 0) || !(precoVenda > 0)) return null;

  const margemAnterior = margemMarkup(precoVenda, custoBase);
  const margemAtual = margemMarkup(precoVenda, custoAtual);
  const diferencaPontos = margemAtual - margemAnterior;
  const direcao: DirecaoMargem = Math.abs(diferencaPontos) < TOLERANCIA_PONTOS
    ? 'manteve'
    : (diferencaPontos > 0 ? 'subiu' : 'caiu');

  return { margemAnterior, margemAtual, direcao, diferencaPontos };
};
