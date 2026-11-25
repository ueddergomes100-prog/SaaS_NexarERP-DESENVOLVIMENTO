/**
 * TABELA DO TAMANHO DA JANELA (Embala Minas, item 3 -- decisao do dono em
 * 25/11/2026: "tabela do tamanho da janela").
 *
 * Em monitor pequeno (17" a 20": 1366x768, 1440x900, 1600x900) a tabela larga
 * empurrava a barra de rolagem lateral para o FIM da pagina: o usuario descia
 * para achar a barra, arrastava e subia de novo. Agora a tabela de lista ocupa a
 * altura que sobra na janela e rola por dentro, com o cabecalho fixo -- a barra
 * lateral fica sempre no rodape da parte visivel.
 *
 * Regra pura aqui; quem aplica na tela e' `useTabelaNaJanela` (layout).
 */

/** Abaixo desta largura (celular) a tabela fica como era: a pagina rola inteira. */
export const LARGURA_MINIMA_PARA_TABELA_NA_JANELA = 768;

/**
 * Abaixo disto a tabela nao cabe "embaixo dos filtros" de um jeito util. Tela com
 * muita coisa em cima (filtros abertos, cartoes de totais) num monitor de 768 de
 * altura: a tabela passa a ter a altura da janela inteira -- a pessoa rola a pagina
 * um pouco, a tabela encosta no alto e a barra lateral fica no rodape.
 */
export const ALTURA_MINIMA_DA_TABELA = 200;

/** Respiro entre o fim da tabela e o fim da janela. */
export const FOLGA_NO_RODAPE = 16;

export const usaTabelaNaJanela = (larguraDaJanela: number): boolean => (
  Number.isFinite(larguraDaJanela) && larguraDaJanela >= LARGURA_MINIMA_PARA_TABELA_NA_JANELA
);

/**
 * Altura maxima da caixa da tabela para ela terminar no rodape da parte visivel.
 *
 * - `alturaVisivel`: altura da area que rola (a pagina, sem o menu e o topo);
 * - `topoDaTabela`: onde a tabela comeca dentro dessa area, contando do topo do
 *   conteudo (nao muda quando a pagina rola);
 * - `respiroInferior`: o que fica ABAIXO da tabela ate' o fim da area (rodape da
 *   lista, botao "carregar mais", espaco interno da pagina) -- tambem precisa
 *   caber, senao a pagina ainda rola um pouco.
 *
 * Devolve `null` quando nao da' para medir (area escondida, aba fechada): quem
 * aplica deixa a tabela como esta'.
 */
export const alturaDaTabelaNaJanela = ({
  alturaVisivel,
  topoDaTabela,
  respiroInferior = 0,
}: {
  alturaVisivel: number;
  topoDaTabela: number;
  respiroInferior?: number;
}): number | null => {
  if (!Number.isFinite(alturaVisivel) || !Number.isFinite(topoDaTabela) || alturaVisivel <= 0) return null;
  const respiro = Number.isFinite(respiroInferior) && respiroInferior > 0 ? respiroInferior : 0;
  const cabe = Math.floor(alturaVisivel - Math.max(0, topoDaTabela) - respiro - FOLGA_NO_RODAPE);
  if (cabe >= ALTURA_MINIMA_DA_TABELA) return cabe;
  const janelaInteira = Math.floor(alturaVisivel - respiro - FOLGA_NO_RODAPE);
  return Math.max(ALTURA_MINIMA_DA_TABELA, janelaInteira);
};
