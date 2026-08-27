/**
 * Registra o service worker so pra habilitar "Instalar app" no
 * Chrome/Edge -- ver public/sw.js pro porque dele nao cachear nada.
 *
 * So roda em producao (import.meta.env.PROD): no dev server o Vite ja
 * reescreve modulo a cada mudanca, e um service worker no meio disso
 * atrapalha o HMR sem trazer beneficio nenhum aqui.
 */
export const registerServiceWorker = (): void => {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Instalar app so vira indisponivel -- o sistema continua funcionando
      // normal no navegador. Nao precisa de showError, so registro pra
      // diagnostico.
      console.warn('Nao foi possivel registrar o service worker (instalar app ficara indisponivel):', error);
    });
  });
};
