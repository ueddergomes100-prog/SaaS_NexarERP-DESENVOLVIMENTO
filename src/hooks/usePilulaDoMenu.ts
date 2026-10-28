import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * PILULA DO MENU (28/10/2026, video de referencia do dono).
 *
 * Um destaque so' por menu, atras do item ativo. Ao trocar de tela ele estica
 * do item antigo ate' o novo e encolhe no novo, em vez de piscar de um item
 * para o outro. So' visual: a navegacao nao espera a animacao.
 *
 * O container precisa de `position: relative` e o item ativo da classe
 * `active`. Grupo do menu abrindo/fechando (transicao de altura) reposiciona a
 * pilula sem animar; item ativo escondido (grupo fechado) apaga a pilula.
 */
const DURACAO_MS = 380;
const CURVA = 'cubic-bezier(.65,0,.35,1)';
// Longe demais, esticar ate' o item novo vira uma barra do tamanho do menu.
const ESTICAR_ATE_PX = 160;

interface Caixa { top: number; left: number; width: number; height: number }

const semMovimento = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const usePilulaDoMenu = <T extends HTMLElement>(seletorItens: string, chave: unknown) => {
  const containerRef = useRef<T | null>(null);
  const pilulaRef = useRef<HTMLSpanElement | null>(null);
  const anterior = useRef<Caixa | null>(null);
  const ultimoContainer = useRef<HTMLElement | null>(null);

  const medir = useCallback((): Caixa | null => {
    const container = containerRef.current;
    if (!container) return null;
    const item = container.querySelector<HTMLElement>(`${seletorItens}.active`);
    if (!item) return null;
    const fechado = item.closest('.nexus-nav-items');
    if (fechado && !fechado.classList.contains('open')) return null;
    const c = container.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.height < 4) return null;
    return {
      top: r.top - c.top + container.scrollTop,
      left: r.left - c.left + container.scrollLeft,
      width: r.width,
      height: r.height,
    };
  }, [seletorItens]);

  const aplicar = useCallback((caixa: Caixa | null) => {
    const pilula = pilulaRef.current;
    if (!pilula) return;
    if (!caixa) {
      pilula.style.opacity = '0';
      return;
    }
    pilula.style.opacity = '1';
    pilula.style.top = `${caixa.top}px`;
    pilula.style.left = `${caixa.left}px`;
    pilula.style.width = `${caixa.width}px`;
    pilula.style.height = `${caixa.height}px`;
  }, []);

  // Troca de tela: estica do antigo ao novo.
  useLayoutEffect(() => {
    const pilula = pilulaRef.current;
    const nova = medir();
    // Menu que acabou de aparecer (recolhido x aberto): sem caixa antiga para esticar.
    const mesmoMenu = ultimoContainer.current === containerRef.current;
    ultimoContainer.current = containerRef.current;
    const velha = mesmoMenu ? anterior.current : null;
    anterior.current = nova;
    aplicar(nova);
    if (!pilula || !nova || !velha || semMovimento()) return;
    if (Math.abs(velha.top - nova.top) < 1 && Math.abs(velha.left - nova.left) < 1) return;

    const inicio = Math.min(velha.top, nova.top);
    const fim = Math.max(velha.top + velha.height, nova.top + nova.height);
    const meio = fim - inicio <= ESTICAR_ATE_PX
      ? { top: inicio, height: fim - inicio }
      : (() => {
        const altura = Math.max(velha.height, nova.height) * 2.2;
        const centro = (velha.top + nova.top + nova.height) / 2;
        return { top: centro - altura / 2, height: altura };
      })();
    pilula.animate([
      { top: `${velha.top}px`, height: `${velha.height}px`, left: `${velha.left}px`, width: `${velha.width}px` },
      { top: `${meio.top}px`, height: `${meio.height}px`, offset: 0.5 },
      { top: `${nova.top}px`, height: `${nova.height}px`, left: `${nova.left}px`, width: `${nova.width}px` },
    ], { duration: DURACAO_MS, easing: CURVA });
  }, [chave, medir, aplicar]);

  // Grupo abrindo/fechando ou menu mudando de tamanho: acompanha sem animar.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let quadro = 0;
    let emTransicao = 0;
    const seguir = () => {
      const caixa = medir();
      anterior.current = caixa;
      aplicar(caixa);
      if (emTransicao > 0) quadro = requestAnimationFrame(seguir);
    };
    // So' a transicao de altura dos grupos (hover e cor nao mexem na posicao).
    const deAltura = (e: TransitionEvent) => e.propertyName === 'grid-template-rows';
    const comecou = (e: TransitionEvent) => {
      if (!deAltura(e)) return;
      emTransicao += 1;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(seguir);
    };
    const terminou = (e: TransitionEvent) => {
      if (!deAltura(e)) return;
      emTransicao = Math.max(0, emTransicao - 1);
      if (emTransicao === 0) { cancelAnimationFrame(quadro); seguir(); }
    };
    container.addEventListener('transitionrun', comecou);
    container.addEventListener('transitionend', terminou);
    container.addEventListener('transitioncancel', terminou);
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => seguir()) : null;
    observador?.observe(container);
    return () => {
      cancelAnimationFrame(quadro);
      container.removeEventListener('transitionrun', comecou);
      container.removeEventListener('transitionend', terminou);
      container.removeEventListener('transitioncancel', terminou);
      observador?.disconnect();
    };
    // `chave` entra para religar quando o container e' montado de novo (menu recolhido x aberto).
  }, [medir, aplicar, chave]);

  return { containerRef, pilulaRef };
};
