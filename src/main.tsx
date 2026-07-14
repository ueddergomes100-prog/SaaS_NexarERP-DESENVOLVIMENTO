import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
