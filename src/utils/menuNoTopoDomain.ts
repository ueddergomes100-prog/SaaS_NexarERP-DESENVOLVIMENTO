/**
 * MENU NO TOPO OU NA LATERAL (Embala Minas, item 4 -- 25/11/2026).
 *
 * Cada usuario escolhe, no menu do usuario (canto de cima), se o menu fica na
 * lateral (como sempre foi) ou no topo, junto da busca. Decisoes do dono:
 * modelo 1 "Cartao com grupos" (os grupos que cabem ficam a' vista, o resto em
 * "Mais"), nas cores e no jeito do sistema de hoje, e a escolha fica guardada
 * NESTE computador (como a largura das colunas) -- nao no cadastro.
 */

export type PosicaoDoMenu = 'lateral' | 'topo';

/**
 * Abaixo desta largura o menu volta para a lateral mesmo com "topo" escolhido:
 * nao cabem grupos suficientes na barra e o celular usa a gaveta lateral.
 */
export const LARGURA_MINIMA_MENU_NO_TOPO = 1100;

/** Evento que avisa as outras partes da tela (barra de cima e menu) da troca. */
export const EVENTO_POSICAO_DO_MENU = 'hennder:posicao-do-menu';

/** Chave do armazenamento deste computador, por usuario. */
export const chavePosicaoDoMenu = (uid: string | null | undefined): string => (
  `hennder:menu-posicao:${uid || 'sem-usuario'}`
);

/** Valor guardado -> posicao. Qualquer coisa que nao seja "topo" e' lateral (o de sempre). */
export const lerPosicaoDoMenu = (valor: string | null | undefined): PosicaoDoMenu => (
  valor === 'topo' ? 'topo' : 'lateral'
);

export const menuFicaNoTopo = (posicao: PosicaoDoMenu, larguraDaJanela: number): boolean => (
  posicao === 'topo' && Number.isFinite(larguraDaJanela) && larguraDaJanela >= LARGURA_MINIMA_MENU_NO_TOPO
);

/**
 * Quantos grupos (na ordem do menu) ficam a' vista na barra. Se todos cabem, todos;
 * senao, os que cabem junto com o botao "Mais" (que leva o resto).
 */
export const gruposQueCabem = (larguras: number[], espaco: number, larguraDoMais: number): number => {
  if (!Number.isFinite(espaco) || espaco <= 0) return 0;
  const validas = larguras.map((l) => (Number.isFinite(l) && l > 0 ? l : 0));
  const total = validas.reduce((soma, l) => soma + l, 0);
  if (total <= espaco) return validas.length;
  const disponivel = espaco - (Number.isFinite(larguraDoMais) && larguraDoMais > 0 ? larguraDoMais : 0);
  let soma = 0;
  let cabem = 0;
  for (const largura of validas) {
    if (soma + largura > disponivel) break;
    soma += largura;
    cabem += 1;
  }
  return cabem;
};
