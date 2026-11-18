import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/impressaoMaiuscula.css'
import './styles/seletor.css'
import './styles/seletorDeData.css'
import App from './App.tsx'
import { registerServiceWorker } from './registerServiceWorker'
// Guarda o "pode instalar" do navegador antes de qualquer tela montar.
import './utils/pedidoDeInstalacao'
import { iniciarTema } from './utils/tema'
import { iniciarSeletorDeData } from './utils/seletorDeDataUi'
import { iniciarCursorNaCaixaAlta } from './utils/cursorNaCaixaAlta'

// Tema (escuro/claro/automatico) vale para o sistema e para o app Vendas.
iniciarTema()
// Calendario do Hennder em todo <input type="date"> (no computador).
iniciarSeletorDeData()
// Campo em caixa alta nao joga mais o cursor para o fim ao digitar no meio do texto.
iniciarCursorNaCaixaAlta()

const PRELOAD_RELOAD_KEY = 'nexus_preload_reload_attempted';
const PRELOAD_RELOAD_WINDOW_MS = 60000;

window.addEventListener('vite:preloadError', (event) => {
  const currentPath = window.location.pathname;
  let reloadAttempt: { path?: string; time?: number } | null;

  try {
    const reloadInfo = sessionStorage.getItem(PRELOAD_RELOAD_KEY);
    reloadAttempt = reloadInfo ? JSON.parse(reloadInfo) : null;
  } catch {
    reloadAttempt = null;
  }

  const alreadyTriedRecently = reloadAttempt?.path === currentPath && Date.now() - Number(reloadAttempt?.time || 0) < PRELOAD_RELOAD_WINDOW_MS;
  if (alreadyTriedRecently) return;

  event.preventDefault();
  sessionStorage.setItem(PRELOAD_RELOAD_KEY, JSON.stringify({ path: currentPath, time: Date.now() }));
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker();
