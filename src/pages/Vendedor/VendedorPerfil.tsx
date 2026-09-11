import React from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';

const VendedorPerfil: React.FC = () => {
  const { userNome, currentUser, logout } = useAuth();
  const nome = userNome || currentUser?.displayName || 'Vendedor';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Perfil" />

      <div style={{ flex: 1, padding: '24px 20px' }}>
        <div style={{ borderRadius: '18px', padding: '24px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '18px', backgroundColor: 'var(--brand-600)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700 }}>
            {nome.trim().charAt(0).toUpperCase() || 'V'}
          </div>
          <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)', textAlign: 'center' }}>{nome}</div>

          <button
            type="button"
            onClick={() => void logout()}
            style={{
              marginTop: '10px', width: '100%', height: '48px', borderRadius: '14px', border: '1px solid rgba(239,68,68,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: 700,
              color: '#f87171', cursor: 'pointer', backgroundColor: 'rgba(239,68,68,0.10)',
            }}
          >
            <LogOut size={18} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
};

export default VendedorPerfil;
