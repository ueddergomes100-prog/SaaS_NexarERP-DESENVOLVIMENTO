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
        <div style={{
          minHeight: '100vh',
          padding: '32px',
          color: 'var(--text-primary)',
          background: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '28px',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: '22px' }}>Não foi possível carregar esta tela</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Recarregue a página. Se o problema continuar, acione o suporte com o horário em que ocorreu.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: '22px',
                padding: '10px 18px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'var(--accent-purple)',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 700
              }}
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
