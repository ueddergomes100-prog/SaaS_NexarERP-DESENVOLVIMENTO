/**
 * O app esta rodando pelo atalho instalado (standalone), e nao numa aba
 * normal do navegador? `navigator.standalone` e' a propriedade propria do
 * Safari no iOS; o media query cobre Android/Chrome e o desktop.
 * Usado pelo app do vendedor (/vendedor) e pela Frente de Caixa (/caixa).
 */
export const estaInstalado = (): boolean => (
  window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
);
