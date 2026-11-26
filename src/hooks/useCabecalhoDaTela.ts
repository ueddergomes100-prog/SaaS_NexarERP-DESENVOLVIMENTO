import { useLayoutEffect, type RefObject } from 'react';
import { ATRIBUTO_CABECALHO_BLOCO, ATRIBUTO_CABECALHO_TITULO, candidatosDoCabecalho, marcasDoCabecalho } from '../utils/cabecalhoDaTelaDomain';

/**
 * Marca o cabecalho da tela (data-cab-bloco / data-cab-titulo) para o visual
 * novo sem `:has()` -- regra e o porque em utils/cabecalhoDaTelaDomain.ts.
 * Remarca quando a tela troca o que mostra (carregando -> lista, por exemplo).
 */
export const useCabecalhoDaTela = (ref: RefObject<HTMLElement | null>): void => {
  useLayoutEffect(() => {
    const pageTransition = ref.current;
    if (!pageTransition) return undefined;
    const marcados = new Set<Element>();
    const marcar = () => {
      const agora = new Set<Element>();
      candidatosDoCabecalho<Element>(pageTransition).forEach((el) => {
        const { bloco, titulo } = marcasDoCabecalho(el);
        if (bloco !== el.hasAttribute(ATRIBUTO_CABECALHO_BLOCO)) el.toggleAttribute(ATRIBUTO_CABECALHO_BLOCO, bloco);
        if (titulo !== el.hasAttribute(ATRIBUTO_CABECALHO_TITULO)) el.toggleAttribute(ATRIBUTO_CABECALHO_TITULO, titulo);
        if (bloco || titulo) agora.add(el);
      });
      // Quem deixou de ser cabecalho (a tela trocou de estrutura) perde a marca.
      marcados.forEach((el) => {
        if (!agora.has(el)) { el.removeAttribute(ATRIBUTO_CABECALHO_BLOCO); el.removeAttribute(ATRIBUTO_CABECALHO_TITULO); }
      });
      marcados.clear();
      agora.forEach((el) => marcados.add(el));
    };
    marcar();
    // So' a estrutura (filhos), nunca atributos: marcar nao dispara o observador de novo.
    const observador = new MutationObserver(marcar);
    observador.observe(pageTransition, { childList: true, subtree: true });
    return () => observador.disconnect();
  }, [ref]);
};
