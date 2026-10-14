import { useEffect } from 'react';

/*
 * FAIXA VIOLETA DO TOPO (design de 14/10/2026, ver visualDesktop.css).
 *
 * A faixa comeca atras da barra do topo e das abas e continua atras do titulo
 * da pagina, terminando um pouco ABAIXO dele -- e' isso que faz os primeiros
 * cartoes "subirem" por cima do violeta, como nas previas aprovadas pelo dono.
 *
 * Cada tela tem um titulo de altura diferente (subtitulo maior, botoes que
 * quebram linha...), entao a altura nao pode ser fixa: aqui ela e' medida na
 * tela aberta e vai para a variavel --faixa-altura do .page-content. Tela sem
 * titulo reconhecido (estado vazio, tela que monta o topo do proprio jeito)
 * fica com 0: sem faixa, para nunca deixar texto escuro em cima do violeta.
 */

/** Quanto da faixa passa por baixo do primeiro cartao depois do titulo. */
const SOBREPOSICAO_PX = 64;
/** Sem cartao logo abaixo do titulo, a faixa termina com esta folga (e nunca por cima do bloco seguinte). */
const FOLGA_SEM_CARTAO_PX = 24;
/** Fileira de botoes (abas Em andamento/Finalizadas...) mais alta que isso nao e' fileira, e' conteudo. */
const ALTURA_MAX_FILEIRA_PX = 72;
const PROFUNDIDADE_MAX = 4;

const TAGS_DE_CONTROLE = /^(BUTTON|A|INPUT|SELECT|LABEL)$/;

const visivel = (el: Element): boolean => {
  const estilo = getComputedStyle(el);
  if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
  if (estilo.position === 'absolute' || estilo.position === 'fixed') return false;
  return el.getBoundingClientRect().height > 0;
};

const temFundo = (el: Element): boolean => {
  const estilo = getComputedStyle(el);
  if (estilo.backgroundImage && estilo.backgroundImage !== 'none') return true;
  const cor = estilo.backgroundColor;
  return !!cor && cor !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(cor);
};

const temTextoSolto = (el: Element): boolean => (
  Array.from(el.childNodes).some((no) => no.nodeType === Node.TEXT_NODE && !!no.textContent?.trim())
);

/**
 * Fileira so' de botoes com fundo proprio (as abas da tela de OS, por
 * exemplo): fica legivel em cima do violeta, entao a faixa passa por tras
 * dela inteira em vez de corta-la no meio.
 */
const soBotoesComFundo = (el: Element, profundidade = 0): boolean => {
  if (profundidade > PROFUNDIDADE_MAX || temTextoSolto(el)) return false;
  const filhos = Array.from(el.children).filter(visivel);
  if (!filhos.length) return false;
  return filhos.every((filho) => (
    TAGS_DE_CONTROLE.test(filho.tagName) || filho.getAttribute('role') === 'tab'
      ? temFundo(filho)
      : !temFundo(filho) && soBotoesComFundo(filho, profundidade + 1)
  ));
};

const ehFileiraDeBotoes = (el: Element): boolean => (
  el.getBoundingClientRect().height <= ALTURA_MAX_FILEIRA_PX && !temFundo(el) && soBotoesComFundo(el)
);

/** O primeiro cartao (bloco com fundo proprio) no comeco do bloco -- e' nele que a faixa "entra". */
const primeiroCartao = (el: Element, profundidade = 0): HTMLElement | null => {
  if (profundidade > PROFUNDIDADE_MAX) return null;
  if (temFundo(el)) return TAGS_DE_CONTROLE.test(el.tagName) ? null : el as HTMLElement;
  // Texto solto antes do cartao (um rotulo, um aviso) ficaria escuro no violeta.
  if (temTextoSolto(el)) return null;
  const primeiro = Array.from(el.children).find(visivel);
  return primeiro ? primeiroCartao(primeiro, profundidade + 1) : null;
};

const proximoVisivel = (el: Element): Element | null => {
  let atual = el.nextElementSibling;
  while (atual && !visivel(atual)) atual = atual.nextElementSibling;
  return atual;
};

/**
 * Onde a faixa termina, medido do topo da area rolavel da pagina:
 * - pula as fileiras de botoes logo abaixo do titulo (ficam dentro da faixa);
 * - se o proximo bloco comeca com um cartao, a faixa entra SOBREPOSICAO_PX nele;
 * - senao, termina logo abaixo do titulo, sem encostar no que vem depois.
 */
const fimDaFaixa = (topo: HTMLElement, origem: number): number => {
  let base = topo.getBoundingClientRect().bottom;
  let proximo = proximoVisivel(topo);
  while (proximo && ehFileiraDeBotoes(proximo)) {
    base = proximo.getBoundingClientRect().bottom;
    proximo = proximoVisivel(proximo);
  }
  const cartao = proximo ? primeiroCartao(proximo) : null;
  if (cartao) {
    const caixa = cartao.getBoundingClientRect();
    return caixa.top + Math.min(SOBREPOSICAO_PX, caixa.height / 2) - origem;
  }
  const limite = proximo ? proximo.getBoundingClientRect().top : Infinity;
  return Math.min(base + FOLGA_SEM_CARTAO_PX, limite) - origem;
};

const SELETOR_TOPO_CLASSICO = '.page-header, .dashboard-topline';

/** O primeiro bloco da pagina que tem o <h1> (telas que montam o topo sem a classe .page-header). */
const ehTopoPorH1 = (el: Element): boolean => {
  try {
    return el.matches(':has(> div > h1:first-child), :has(> h1:first-child)');
  } catch {
    // navegador sem :has() -- confere na mao
    const primeiro = el.firstElementChild;
    return !!primeiro && (primeiro.tagName === 'H1' || primeiro.firstElementChild?.tagName === 'H1');
  }
};

const acharTopo = (paginaVisivel: HTMLElement): HTMLElement | null => {
  const classico = paginaVisivel.querySelector<HTMLElement>(SELETOR_TOPO_CLASSICO);
  if (classico) return classico;
  const raiz = paginaVisivel.querySelector<HTMLElement>(':scope > .page-transition > div');
  const primeiro = raiz?.firstElementChild as HTMLElement | null | undefined;
  return primeiro && primeiro.tagName === 'DIV' && ehTopoPorH1(primeiro) ? primeiro : null;
};

export const useFaixaDoTopo = (): void => {
  useEffect(() => {
    const raizLayout = document.querySelector('.app-layout-wrapper');
    if (!raizLayout) return undefined;
    let quadro = 0;

    const medir = () => {
      quadro = 0;
      raizLayout.querySelectorAll<HTMLElement>('.page-content').forEach((pagina) => {
        if (!pagina.getClientRects().length) return; // aba escondida
        const topo = acharTopo(pagina);
        let altura = 0;
        if (topo) {
          const origem = pagina.getBoundingClientRect().top - pagina.scrollTop;
          altura = Math.max(0, Math.round(fimDaFaixa(topo, origem)));
        }
        const valor = `${altura}px`;
        if (pagina.style.getPropertyValue('--faixa-altura') !== valor) pagina.style.setProperty('--faixa-altura', valor);
      });
    };
    const agendar = () => {
      if (!quadro) quadro = requestAnimationFrame(medir);
    };

    // Mudou a tela, abriu/fechou aba, carregou o conteudo, quebrou linha: mede de novo (1x por quadro).
    const observador = new MutationObserver(agendar);
    observador.observe(raizLayout, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', agendar);
    agendar();

    return () => {
      observador.disconnect();
      window.removeEventListener('resize', agendar);
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);
};
