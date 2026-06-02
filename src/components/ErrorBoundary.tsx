import React from 'react';

const CHUNK_RELOAD_KEY = 'nexus_chunk_reload_attempted';
const CHUNK_RELOAD_WINDOW_MS = 60000;

type ErrorBoundaryState = {
  hasError: boolean;
  error: unknown;
};

const isChunkLoadError = (error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error || '');
  const message = errorMessage.toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk') ||
    message.includes('chunkloaderror')
  );
};

const getReloadAttempt = () => {
  try {
    const reloadInfo = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    return reloadInfo ? JSON.parse(reloadInfo) : null;
  } catch {
    return null;
  }
};

export class ErrorBoundary extends React.Component<{children: React.ReactNode}, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: unknown) { return { hasError: true, error }; }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);

    const reloadAttempt = getReloadAttempt();
    const currentPath = window.location.pathname;
    const alreadyTriedRecently = reloadAttempt?.path === currentPath && Date.now() - Number(reloadAttempt?.time || 0) < CHUNK_RELOAD_WINDOW_MS;

    if (isChunkLoadError(error) && !alreadyTriedRecently) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, JSON.stringify({ path: currentPath, time: Date.now() }));
      window.location.reload();
      return;
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: '20px', color: 'var(--text-primary)', background: 'red', height: '100vh', overflow: 'auto'}}>
          <h2>Algo deu errado (Crash Detectado)</h2>
          <pre>{String(this.state.error || '')}</pre>
          <button onClick={() => window.location.reload()} style={{padding: '10px', marginTop: '20px'}}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
