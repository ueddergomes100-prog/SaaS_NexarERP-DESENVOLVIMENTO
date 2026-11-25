import { useEffect } from 'react';
import { alturaDaTabelaNaJanela, usaTabelaNaJanela } from '../../utils/tabelaNaJanelaDomain';
import './tabelaNaJanela.css';

/*
 * TABELA DO TAMANHO DA JANELA (Embala Minas, item 3, 25/11/2026).
 *
 * Toda caixa de tabela marcada com o atributo `data-tabela-janela` ganha altura
 * maxima igual ao que sobra da parte visivel da pagina (regra em
 * utils/tabelaNaJanelaDomain.ts) e rola por dentro, com o cabecalho fixo
 * (tabelaNaJanela.css). Assim a barra de rolagem lateral da tabela larga fica
 * sempre a' vista no rodape, em vez de no fim da pagina.
 *
 * Tela de lista nova: basta por `data-tabela-janela` na div que envolve a
 * <table>. No celular (largura < 768) nada muda.
 */

const SELETOR = '[data-tabela-janela]';

const px = (valor: string | null | undefined): number => parseFloat(valor || '0') || 0;

/**
 * Quanto ocupa o que vem DEPOIS da tabela ate' o fim da pagina (rodape da lista,
 * "carregar mais", margens e espacos internos dos cartoes e da area). Soma so' o
 * que existe de fato: o bloco que envolve a pagina pode esticar ate' o fim da
 * janela, e esse vazio nao conta.
 */
const alturaDepoisDaCaixa = (caixa: HTMLElement, area: HTMLElement, fimDaCaixa: number): number => {
  let fim = fimDaCaixa;
  let el: HTMLElement = caixa;
  while (el.parentElement && el !== area && el.parentElement !== area) {
    const pai = el.parentElement;
    fim += px(getComputedStyle(el).marginBottom);
    for (let irmao = el.nextElementSibling; irmao; irmao = irmao.nextElementSibling) {
      const ret = irmao.getBoundingClientRect();
      if (ret.width === 0 && ret.height === 0) continue;
      const estilo = getComputedStyle(irmao);
      if (estilo.position === 'absolute' || estilo.position === 'fixed') continue;
      fim = Math.max(fim, ret.bottom + px(estilo.marginBottom));
    }
    const estiloPai = getComputedStyle(pai);
    fim += px(estiloPai.paddingBottom) + px(estiloPai.borderBottomWidth);
    el = pai;
  }
  fim += px(getComputedStyle(el).marginBottom);
  return Math.max(0, fim - fimDaCaixa) + px(getComputedStyle(area).paddingBottom);
};

const areaQueRola = (el: HTMLElement): HTMLElement | null => el.closest<HTMLElement>('.page-content');

const ajustar = (caixa: HTMLElement) => {
  const area = areaQueRola(caixa);
  if (!area || !usaTabelaNaJanela(window.innerWidth)) {
    caixa.style.removeProperty('max-height');
    caixa.removeAttribute('data-tabela-janela-ativa');
    return;
  }
  // Aba escondida: nao mede (daria zero); ajusta quando a aba voltar.
  if (area.clientHeight === 0 || caixa.offsetParent === null) return;
  const retCaixa = caixa.getBoundingClientRect();
  const depois = alturaDepoisDaCaixa(caixa, area, retCaixa.bottom);
  const altura = alturaDaTabelaNaJanela({
    alturaVisivel: area.clientHeight,
    topoDaTabela: retCaixa.top - area.getBoundingClientRect().top + area.scrollTop,
    respiroInferior: depois,
  });
  if (altura === null) return;
  const valor = `${altura}px`;
  if (caixa.style.maxHeight !== valor) caixa.style.maxHeight = valor;
  if (!caixa.hasAttribute('data-tabela-janela-ativa')) caixa.setAttribute('data-tabela-janela-ativa', '');
};

export const useTabelaNaJanela = (): void => {
  useEffect(() => {
    let quadro = 0;
    const observadas = new WeakSet<Element>();
    const tamanho = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => agendar())
      : null;

    const varrer = () => {
      quadro = 0;
      document.querySelectorAll<HTMLElement>(SELETOR).forEach((caixa) => {
        const area = areaQueRola(caixa);
        // Mudou o tamanho da pagina ou do que vem antes da tabela (filtros que abrem,
        // totais que carregam): mede de novo.
        if (tamanho && area?.firstElementChild && !observadas.has(area.firstElementChild)) {
          observadas.add(area.firstElementChild);
          tamanho.observe(area.firstElementChild);
        }
        if (tamanho && area && !observadas.has(area)) {
          observadas.add(area);
          tamanho.observe(area);
        }
        ajustar(caixa);
      });
    };
    function agendar() { if (!quadro) quadro = requestAnimationFrame(varrer); }

    const mudancas = new MutationObserver(agendar);
    mudancas.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', agendar);
    agendar();
    return () => {
      mudancas.disconnect();
      tamanho?.disconnect();
      window.removeEventListener('resize', agendar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);
};
