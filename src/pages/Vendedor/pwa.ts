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

/**
 * "Sincronizar agora" do Perfil -- botao pra puxar a versao mais nova sem o
 * vendedor ter que remover o atalho da tela de inicio e adicionar de novo.
 *
 * O app instalado (standalone) no iOS as vezes segura uma copia antiga do
 * HTML/JS em cache por conta propria, mesmo com deploy novo no ar -- e'
 * limitacao do proprio Safari, nao falta de handler aqui (o sw.js do
 * sistema, por sinal, ja e' passthrough puro, ver public/sw.js). Este botao
 * derruba TODA fonte de cache que o navegador possa ter guardado (service
 * worker + Cache Storage) e recarrega com um parametro novo na URL --
 * query string diferente garante busca na rede, nunca a copia guardada.
 *
 * Nao mexe em localStorage/sessionStorage de proposito: sessao (login
 * persistente) e o CNPJ lembrado continuam do jeito que estavam.
 */
export const sincronizarApp = async (): Promise<void> => {
  try {
    if ('serviceWorker' in navigator) {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registros.map((registro) => registro.unregister()));
    }
    if ('caches' in window) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((chave) => caches.delete(chave)));
    }
  } finally {
    window.location.href = `${window.location.pathname}?sincronizado=${Date.now()}`;
  }
};
