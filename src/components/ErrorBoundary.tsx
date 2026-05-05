import React from 'react';
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, info: any) { console.error('ErrorBoundary caught:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding: '20px', color: 'white', background: 'red', height: '100vh', overflow: 'auto'}}>
          <h2>Algo deu errado (Crash Detectado)</h2>
          <pre>{this.state.error?.toString()}</pre>
          <button onClick={() => window.location.reload()} style={{padding: '10px', marginTop: '20px'}}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}
