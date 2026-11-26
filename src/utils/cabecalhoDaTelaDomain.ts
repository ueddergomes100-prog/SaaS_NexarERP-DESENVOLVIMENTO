/**
 * CABECALHO DA TELA SEM `:has()` (26/11/2026, queixa do dono: Safari do Mac
 * travando nas transicoes).
 *
 * O visual novo (visualDesktop.css) estilizava o cabecalho das telas que nao
 * usam `.page-header` com seletores `:has()`:
 *   .page-transition > div > div:first-child:has(> div > h1:first-child)  -> "bloco"
 *   .page-transition > div > div:first-child:has(> h1:first-child)        -> "titulo"
 * No Safari cada mudanca na tela obriga o motor a reconferir esses seletores;
 * medido no WebKit 18.2 com tres abas abertas: a troca de aba caia de 40 ms
 * para 25 ms sem eles. Agora a tela marca o cabecalho com dois atributos
 * (`data-cab-bloco` / `data-cab-titulo`) e o CSS olha so' o atributo.
 *
 * Mesma regra dos seletores antigos, um por um:
 *  - candidato: o PRIMEIRO filho (se for div) de cada div filha do .page-transition;
 *  - "bloco": tem uma div filha cujo primeiro filho e' um h1;
 *  - "titulo": o primeiro filho dele e' um h1.
 */

export const ATRIBUTO_CABECALHO_BLOCO = 'data-cab-bloco';
export const ATRIBUTO_CABECALHO_TITULO = 'data-cab-titulo';

/** O minimo de um elemento que a regra usa (testavel sem navegador). */
export interface ElementoDaTela {
  tagName: string;
  firstElementChild: ElementoDaTela | null;
  children: ArrayLike<ElementoDaTela>;
}

const eh = (el: ElementoDaTela | null | undefined, tag: string): boolean => Boolean(el) && String(el!.tagName).toUpperCase() === tag;

/** Que marcas o candidato recebe. */
export const marcasDoCabecalho = (el: ElementoDaTela): { bloco: boolean; titulo: boolean } => ({
  bloco: Array.from(el.children).some((filho) => eh(filho, 'DIV') && eh(filho.firstElementChild, 'H1')),
  titulo: eh(el.firstElementChild, 'H1'),
});

/** Os candidatos dentro do .page-transition (o `div:first-child` de cada `> div`). */
export const candidatosDoCabecalho = <T extends ElementoDaTela>(pageTransition: { children: ArrayLike<T> }): T[] => (
  Array.from(pageTransition.children)
    .filter((raiz) => eh(raiz, 'DIV'))
    .map((raiz) => raiz.firstElementChild as T | null)
    .filter((primeiro): primeiro is T => eh(primeiro, 'DIV'))
);
