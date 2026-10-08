import React, { useState } from 'react';
import { LogOut, Moon, RefreshCw, SquarePlus, Sun, SunMoon } from 'lucide-react';
import { usePreferenciaTema } from '../../hooks/usePreferenciaTema';
import { DESCRICAO_TEMA, PREFERENCIAS_TEMA, ROTULO_TEMA, type PreferenciaTema } from '../../utils/temaDomain';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import { CAMINHO_INSTALACAO, estaInstalado, sincronizarApp } from './pwa';

const VendedorPerfil: React.FC = () => {
  const { userNome, currentUser, logout } = useAuth();
  const nome = userNome || currentUser?.displayName || 'Vendedor';
  const podeInstalar = !estaInstalado();
  const [sincronizando, setSincronizando] = useState(false);

  const handleSincronizar = () => {
    setSincronizando(true);
    void sincronizarApp();
  };

  const { preferencia: temaPreferido, escolher: escolherTema } = usePreferenciaTema();
  const iconeDoTema: Record<PreferenciaTema, React.ReactNode> = { dark: <Moon size={18} />, light: <Sun size={18} />, auto: <SunMoon size={18} /> };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Perfil" />

      <div style={{ flex: 1, padding: '24px 20px' }}>
        <div style={{ borderRadius: '18px', padding: '24px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '18px', backgroundColor: 'var(--brand-600)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700 }}>
            {nome.trim().charAt(0).toUpperCase() || 'V'}
          </div>
          <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>{nome}</div>

          {podeInstalar && (
            <button
              type="button"
              // Navegacao REAL (nao React Router): so' um carregamento de
              // verdade do /vendedor.html traz o <head> certo do app, que e'
              // o que o iPhone le ao adicionar a tela de inicio.
              onClick={() => window.location.assign(CAMINHO_INSTALACAO)}
              style={{
                marginTop: '10px', width: '100%', height: '48px', borderRadius: '14px', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
                color: '#fff', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
              }}
            >
              <SquarePlus size={18} /> Instalar na tela de início
            </button>
          )}

          <button
            type="button"
            onClick={handleSincronizar}
            disabled={sincronizando}
            style={{
              marginTop: '10px', width: '100%', height: '48px', borderRadius: '14px', border: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
              color: 'var(--text-primary)', cursor: sincronizando ? 'default' : 'pointer', backgroundColor: 'var(--bg-tertiary)',
              opacity: sincronizando ? 0.7 : 1,
            }}
          >
            <RefreshCw size={18} className={sincronizando ? 'spin-icon' : undefined} />
            {sincronizando ? 'Sincronizando...' : 'Sincronizar agora'}
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            style={{
              marginTop: '2px', width: '100%', height: '48px', borderRadius: '14px', border: '1px solid rgba(239,68,68,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700,
              color: '#f87171', cursor: 'pointer', backgroundColor: 'rgba(239,68,68,0.10)',
            }}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>

        {/* Aparencia: a mesma preferencia do sistema (utils/temaDomain.ts). */}
        <div style={{ marginTop: '14px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Aparência</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {PREFERENCIAS_TEMA.map((opcao) => (
              <button
                key={opcao}
                type="button"
                onClick={() => escolherTema(opcao)}
                aria-pressed={temaPreferido === opcao}
                style={{
                  flex: 1, height: '58px', borderRadius: '12px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  fontSize: '13px', fontWeight: 700,
                  border: `2px solid ${temaPreferido === opcao ? 'var(--brand-500)' : 'var(--border-color)'}`,
                  backgroundColor: temaPreferido === opcao ? 'rgba(139, 92, 246, 0.14)' : 'var(--bg-tertiary)',
                  color: temaPreferido === opcao ? 'var(--brand-400)' : 'var(--text-primary)',
                }}
              >
                {iconeDoTema[opcao]} {ROTULO_TEMA[opcao]}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>{DESCRICAO_TEMA[temaPreferido]}</div>
        </div>
      </div>
    </div>
  );
};

export default VendedorPerfil;
