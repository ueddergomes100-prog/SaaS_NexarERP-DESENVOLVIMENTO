/** O app esta rodando pelo atalho da tela de inicio (standalone), e nao numa
 *  aba normal do navegador? `navigator.standalone` e' a propriedade propria
 *  do Safari no iOS; o media query cobre Android/Chrome. */
export const estaInstalado = (): boolean => (
  window.matchMedia('(display-mode: standalone)').matches
  || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
);

/** Caminho do arquivo HTML real do app do vendedor -- o unico com o <head>
 *  certo (manifest/icone proprios). Ver VendedorInstalar.tsx pro porque. */
export const CAMINHO_INSTALACAO = '/vendedor.html';
