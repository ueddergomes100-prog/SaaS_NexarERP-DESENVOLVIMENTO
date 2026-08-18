import React from 'react';
import hennderIcon from '../../assets/hennder-icon.svg';

interface BootSplashProps {
  /** Texto principal. Default cobre o caso mais comum (entrada no sistema). */
  titulo?: string;
  /** Linha secundaria, em monospace. */
  legenda?: string;
}

/**
 * Splash de tela cheia usado na transicao "login -> sistema".
 *
 * Existe como componente compartilhado de proposito: e' renderizado em tres
 * momentos seguidos (AuthPage logo apos autenticar, ProtectedRoute enquanto o
 * AuthContext resolve perfil/tenant, e como fallback do Suspense do miolo do
 * app). Como o visual e' identico nos tres, a troca de componente no meio da
 * navegacao passa despercebida -- antes cada etapa tinha um visual proprio
 * (splash -> "N" pulsante -> "Carregando modulo..."), o que dava a sensacao
 * de travada mesmo quando era rapido.
 *
 * A barra e' INDETERMINADA (vai e volta), nao uma barra de progresso que
 * enche ate 100%: como o componente remonta entre AuthPage e ProtectedRoute,
 * uma barra determinada reiniciaria visivelmente do zero no meio da
 * transicao, denunciando o corte.
 */
const BootSplash: React.FC<BootSplashProps> = ({
  titulo = 'Iniciando Ambiente',
  legenda = 'CARREGANDO MÓDULOS...',
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-label={titulo}
    style={{
      height: '100vh', width: '100vw',
      backgroundColor: 'var(--bg-primary)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      position: 'fixed', top: 0, left: 0, zIndex: 9999,
      backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.14) 0%, transparent 52%)',
      animation: 'bootSplashFadeIn 0.3s ease-out',
    }}
  >
    <div style={{ position: 'relative', width: '110px', height: '110px', marginBottom: '40px' }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: 'conic-gradient(from 0deg, var(--accent-blue), var(--accent-purple), var(--accent-blue))',
        boxShadow: '0 0 30px 2px rgba(139, 92, 246, 0.35)',
        animation: 'bootSplashRingSpin 1.1s linear infinite',
      }} />
      <div style={{ position: 'absolute', inset: '8px', borderRadius: '50%', backgroundColor: 'var(--bg-primary)' }} />
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img
          src={hennderIcon}
          alt=""
          style={{
            width: '56px', height: '56px', objectFit: 'contain',
            filter: 'drop-shadow(0 0 10px rgba(139, 92, 246, 0.35))',
            animation: 'bootSplashLogoPulse 2s ease-in-out infinite',
          }}
        />
      </div>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <h2 style={{ color: 'var(--text-primary)', fontSize: '24px', fontWeight: 600, letterSpacing: '1px', margin: 0 }}>
        {titulo}
      </h2>

      <div style={{ width: '240px', height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          width: '40%', height: '100%',
          background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
          borderRadius: '4px',
          animation: 'bootSplashBarSlide 1.4s ease-in-out infinite',
        }} />
      </div>

      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', fontFamily: 'monospace', letterSpacing: '2px', margin: 0, animation: 'bootSplashBlink 1.5s infinite' }}>
        {legenda}
      </p>
    </div>

    <style>
      {`
        @keyframes bootSplashFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes bootSplashRingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes bootSplashLogoPulse {
          0%, 100% { transform: scale(1); opacity: 0.92; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes bootSplashBarSlide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        @keyframes bootSplashBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] img,
          [role="status"] div { animation: none !important; }
        }
      `}
    </style>
  </div>
);

export default BootSplash;
