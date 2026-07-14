import React from 'react';
import { Loader2 } from 'lucide-react';

const PageLoader: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '70vh',
      backgroundColor: 'transparent',
      gap: '16px'
    }}>
      <div style={{
        padding: '24px',
        borderRadius: '16px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-neon)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
      }}>
        <Loader2 size={32} className="spin-animation" style={{ color: 'var(--accent-purple)' }} />
        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
          Carregando módulo...
        </span>
      </div>
    </div>
  );
};

export default PageLoader;
