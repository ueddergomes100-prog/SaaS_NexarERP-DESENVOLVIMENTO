/*
 * MODO COMPACTO AUTOMATICO (28/11/2026, decisao do dono).
 *
 * No PC de 19-20" com a escala do Windows em 125%, a janela tem uns 1.100
 * pontos de largura (no Mac, 1.440): as tabelas nao cabiam e aparecia a
 * barrinha de rolar para o lado. Com a janela estreita, a AREA DO CONTEUDO
 * fica um pouco menor (zoom do CSS, como apertar Ctrl e -); o menu e a barra
 * do topo ficam como estao. Cada pessoa pode desligar no Perfil.
 *
 * Quem posiciona coisas medindo a tela (menus, filtros de coluna, busca de
 * produto, largura das colunas, altura da tabela) converte com
 * `zoomDoElemento`: getBoundingClientRect vem na medida da tela, e o estilo
 * de quem esta' dentro do conteudo reduzido e' multiplicado pelo zoom.
 */

export type PreferenciaCompacto = 'auto' | 'normal' | 'compacto';

export const CHAVE_PREFERENCIA_COMPACTO = 'hennder.tamanhoDaTela';
/** Abaixo disto (largura da janela, em pontos) o automatico reduz o conteudo. */
export const LARGURA_PARA_COMPACTO = 1300;
/** Quanto o conteudo fica do tamanho normal no modo compacto. */
export const ZOOM_COMPACTO = 0.85;

export const ROTULO_PREFERENCIA_COMPACTO: Record<PreferenciaCompacto, string> = {
  auto: 'Automático (reduz em telas menores)',
  normal: 'Normal (sempre do tamanho padrão)',
  compacto: 'Compacto (sempre um pouco menor)',
};

export const lerPreferenciaCompacto = (valor: unknown): PreferenciaCompacto => (
  valor === 'normal' || valor === 'compacto' ? valor : 'auto'
);

/** A tela fica compacta agora? */
export const telaCompacta = (preferencia: PreferenciaCompacto, larguraDaJanela: number): boolean => {
  if (preferencia === 'normal') return false;
  if (preferencia === 'compacto') return true;
  return Number.isFinite(larguraDaJanela) && larguraDaJanela > 0 && larguraDaJanela < LARGURA_PARA_COMPACTO;
};

/** Zoom efetivo do elemento (1 fora do conteudo reduzido ou em navegador sem `currentCSSZoom`). */
export const zoomDoElemento = (el: Element | null | undefined): number => {
  const z = el ? Number((el as Element & { currentCSSZoom?: number }).currentCSSZoom) : 1;
  return Number.isFinite(z) && z > 0 ? z : 1;
};
