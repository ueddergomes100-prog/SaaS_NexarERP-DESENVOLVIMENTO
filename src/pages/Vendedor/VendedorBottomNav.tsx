import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Package, Users, UserCircle } from 'lucide-react';

const ITENS = [
  { path: '/vendedor', label: 'Início', Icon: Home, match: (p: string) => p === '/vendedor' },
  { path: '/vendedor/pedidos', label: 'Pedidos', Icon: Package, match: (p: string) => p.startsWith('/vendedor/pedidos') },
  { path: '/vendedor/cliente', label: 'Clientes', Icon: Users, match: (p: string) => p.startsWith('/vendedor/cliente') },
  { path: '/vendedor/perfil', label: 'Perfil', Icon: UserCircle, match: (p: string) => p.startsWith('/vendedor/perfil') },
];

const VendedorBottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div
      style={{
        minHeight: '72px', flexShrink: 0, borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        // A cor da navbar precisa ir ate a borda real do celular -- se a
        // margem da barra de gestos ficasse no shell (fundo primario), em
        // vez de aqui, sobrava uma faixa de outra cor embaixo da barra.
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
      }}
    >
      {ITENS.map(({ path, label, Icon, match }) => {
        const ativo = match(location.pathname);
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none',
              cursor: 'pointer', color: ativo ? 'var(--brand-400)' : 'var(--text-muted)',
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: '10.5px', fontWeight: ativo ? 700 : 600 }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default VendedorBottomNav;
