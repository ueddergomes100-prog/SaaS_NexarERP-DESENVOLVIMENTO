/*
 * LISTA DESENHADA EM BLOCOS (24/11/2026, pedido do dono: "as telas grandes do
 * sistema pare de carregar todas informacoes").
 *
 * A tela continua com TODOS os registros na mao -- totais, cartoes, filtros,
 * "selecionar todos", relatorio e baixa em lote seguem valendo para a lista
 * inteira. O que muda e' so' quantas LINHAS a tabela desenha: um bloco de
 * cada vez, com "Mostrar mais" e "Mostrar tudo" no rodape.
 *
 * Por que: uma lista com 500 linhas custava ~160 ms de estilo e layout do
 * navegador toda vez que a aba voltava para a frente, e cada tecla na busca
 * redesenhava as 500. Com 100 linhas a tela responde na hora.
 *
 * Mesmo tamanho e mesmo texto que Pedidos de Venda, Clientes e Estoque ja'
 * usavam (LINHAS_POR_VEZ, 23/11/2026). Tela nova com lista que cresce com a
 * empresa: useLinhasEmBlocos + <MostrarMaisLinhas />.
 */

/** Quantas linhas a tabela desenha de cada vez. */
export const LINHAS_POR_BLOCO = 100;

/** As linhas que entram na tela: as primeiras `limite`. Lista que ja' cabe volta a mesma (sem copia). */
export const linhasDoBloco = <T>(linhas: readonly T[], limite: number): readonly T[] => (
  linhas.length > limite ? linhas.slice(0, Math.max(0, limite)) : linhas
);

/** Quantas linhas ficaram de fora da tela. */
export const linhasRestantes = (total: number, limite: number): number => Math.max(0, total - Math.max(0, limite));

/** O limite depois de um "Mostrar mais". */
export const proximoLimite = (limite: number, passo: number = LINHAS_POR_BLOCO): number => limite + Math.max(1, passo);

/** Texto do botao, igual ao das listas que ja' tinham o corte. */
export const textoMostrarMais = (restam: number): string => (
  restam === 1 ? 'Mostrar mais (1 restante)' : `Mostrar mais (${restam.toLocaleString('pt-BR')} restantes)`
);

/** "Mostrar tudo" so' aparece quando um clique em "Mostrar mais" nao traria o resto todo. */
export const ofereceMostrarTudo = (restam: number, passo: number = LINHAS_POR_BLOCO): boolean => restam > passo;
