import { useEffect } from 'react';
import {
  chaveDaColuna,
  colunaAjustavel,
  lerLarguraGuardada,
  limitarLargura,
} from '../../utils/colunasAjustaveisDomain';

/*
 * COLUNAS AJUSTAVEIS EM TODAS AS TABELAS (pedido do dono, 21/10/2026).
 *
 * Em vez de mexer tela por tela (~100 telas com tabela), o layout procura toda
 * <table> com <thead> e poe, na borda direita de cada coluna, uma alca (a mesma
 * "setinha" da coluna Cliente dos Pedidos de Venda): arrastar alarga/estreita,
 * dois cliques voltam ao tamanho padrao, setas do teclado tambem. Tela nova com
 * tabela ganha sozinha. A largura fica guardada NESTE computador por tela e coluna
 * (regra em utils/colunasAjustaveisDomain.ts).
 *
 * Tabela que nao deve ter (impressao, tabela montada de outro jeito): marcar com
 * o atributo data-sem-ajuste. Coluna que ja' tem alca propria (role=separator)
 * fica como esta'.
 */

const MARCA = 'alcaColuna';
const ICONE = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" x2="22" y1="12" y2="12"/></svg>';

const lerArmazenado = (chave: string): number | null => {
  try { return lerLarguraGuardada(window.localStorage.getItem(chave)); } catch { return null; }
};
const gravarArmazenado = (chave: string, px: number | null) => {
  try {
    if (px === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, String(px));
  } catch {
    // Sem armazenamento (janela anonima): vale enquanto a tela estiver aberta.
  }
};

/** Titulo da tela onde a tabela esta' (janela/modal: o titulo dela). */
const tituloDaTela = (tabela: HTMLTableElement): string => {
  const modal = tabela.closest('[role="dialog"], .swal2-popup, .modal, .modal-content');
  const escopo = modal ?? tabela.closest('.page-content') ?? document.body;
  const titulo = escopo.querySelector('h1, h2, h3, .swal2-title');
  return titulo?.textContent ?? '';
};

const aplicarLargura = (th: HTMLTableCellElement, px: number | null) => {
  if (px === null) {
    th.style.width = th.dataset.larguraOriginal ?? '';
    th.style.minWidth = th.dataset.minimaOriginal ?? '';
    return;
  }
  th.style.width = `${px}px`;
  th.style.minWidth = `${px}px`;
};

const prepararColuna = (th: HTMLTableCellElement, chave: string) => {
  th.dataset[MARCA] = '1';
  th.dataset.larguraOriginal = th.style.width;
  th.dataset.minimaOriginal = th.style.minWidth;
  if (getComputedStyle(th).position === 'static') th.style.position = 'relative';

  const alca = document.createElement('span');
  alca.className = 'alca-coluna';
  alca.setAttribute('role', 'separator');
  alca.setAttribute('aria-orientation', 'vertical');
  alca.tabIndex = 0;
  alca.title = 'Arraste para alargar ou estreitar a coluna. Dois cliques voltam ao tamanho padrão.';
  alca.innerHTML = ICONE;

  let inicio: { x: number; largura: number } | null = null;
  const definir = (px: number) => {
    const valor = limitarLargura(px);
    aplicarLargura(th, valor);
    return valor;
  };
  alca.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    alca.setPointerCapture(e.pointerId);
    inicio = { x: e.clientX, largura: th.getBoundingClientRect().width };
    alca.classList.add('arrastando');
  });
  alca.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    definir(inicio.largura + (e.clientX - inicio.x));
  });
  const soltar = (e: PointerEvent) => {
    if (!inicio) return;
    if (alca.hasPointerCapture(e.pointerId)) alca.releasePointerCapture(e.pointerId);
    inicio = null;
    alca.classList.remove('arrastando');
    gravarArmazenado(chave, limitarLargura(th.getBoundingClientRect().width));
  };
  alca.addEventListener('pointerup', soltar);
  alca.addEventListener('pointercancel', soltar);
  // Clique na alca nao ordena a coluna nem abre o filtro do cabecalho.
  alca.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  alca.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    aplicarLargura(th, null);
    gravarArmazenado(chave, null);
  });
  alca.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const atual = th.getBoundingClientRect().width;
    gravarArmazenado(chave, definir(atual + (e.key === 'ArrowRight' ? 20 : -20)));
  });

  th.appendChild(alca);
  const guardada = lerArmazenado(chave);
  if (guardada !== null) aplicarLargura(th, guardada);
};

const prepararTabela = (tabela: HTMLTableElement) => {
  if (tabela.hasAttribute('data-sem-ajuste') || tabela.closest('[data-sem-ajuste]')) return;
  const linha = tabela.tHead?.rows[0];
  if (!linha) return;
  const celulas = Array.from(linha.cells);
  const pendentes = celulas.filter((c) => !c.dataset[MARCA]);
  if (pendentes.length === 0) return;
  const cabecalhos = celulas.map((c) => (c.textContent ?? ''));
  const tela = tituloDaTela(tabela);
  celulas.forEach((th, indice) => {
    if (th.dataset[MARCA]) return;
    if (th.querySelector('[role="separator"]')) { th.dataset[MARCA] = 'propria'; return; }
    const soCaixinha = Boolean(th.querySelector('input[type="checkbox"]')) && !(th.textContent ?? '').trim();
    if (!colunaAjustavel({ indice, total: celulas.length, colSpan: th.colSpan, texto: cabecalhos[indice], soCaixinha })) {
      th.dataset[MARCA] = 'nao';
      return;
    }
    prepararColuna(th as HTMLTableCellElement, chaveDaColuna(tela, cabecalhos, indice));
  });
};

export const useColunasAjustaveis = (): void => {
  useEffect(() => {
    let quadro = 0;
    const varrer = () => {
      quadro = 0;
      document.querySelectorAll<HTMLTableElement>('.app-layout-wrapper table, [role="dialog"] table, .swal2-popup table')
        .forEach(prepararTabela);
    };
    const agendar = () => { if (!quadro) quadro = requestAnimationFrame(varrer); };
    const observador = new MutationObserver(agendar);
    observador.observe(document.body, { childList: true, subtree: true });
    agendar();
    return () => {
      observador.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);
};
