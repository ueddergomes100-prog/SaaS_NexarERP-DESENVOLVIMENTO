import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Package, Users, UserCircle, Wrench } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PERMISSAO_APP, podeTelaDoApp, podeUsarOsNoApp } from './vendedorPermissoes';

interface ItemDaBarra {
  path: string;
  label: string;
  Icon: typeof Home;
  match: (p: string) => boolean;
  /** Item so' para quem tem a permissao (a barra nao mostra o que a pessoa nao pode abrir). */
  so?: 'os' | string;
}

const ITENS: ItemDaBarra[] = [
  { path: '/vendedor', label: 'Início', Icon: Home, match: (p: string) => p === '/vendedor' },
  { path: '/vendedor/pedidos', label: 'Pedidos', Icon: Package, match: (p: string) => p.startsWith('/vendedor/pedidos'), so: PERMISSAO_APP.pedido },
  // Atalho da OS (pedido do dono, 13/10/2026): mesma regra do cartao da tela inicial.
  { path: '/vendedor/os', label: 'OS', Icon: Wrench, match: (p: string) => p.startsWith('/vendedor/os'), so: 'os' },
  { path: '/vendedor/cliente', label: 'Clientes', Icon: Users, match: (p: string) => p.startsWith('/vendedor/cliente'), so: PERMISSAO_APP.clientes },
  { path: '/vendedor/perfil', label: 'Perfil', Icon: UserCircle, match: (p: string) => p.startsWith('/vendedor/perfil') },
];

/*
 * Barra de baixo (vendedorVisual.css, .app-nav). A cor da barra vai ate' a borda
 * real do celular: a margem da barra de gestos (env safe-area-inset-bottom) mora
 * no padding dela, nao no shell -- senao sobrava uma faixa de outra cor embaixo.
 */
const VendedorBottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { userRole, isOwner, userPermissions } = useAuth();
  const podeOs = podeUsarOsNoApp(userRole, isOwner, userPermissions);
  // Bloco "Aplicativo mobile" (26/10/2026): Pedidos e Clientes tambem tem chave.
  const itens = ITENS.filter((item) => (!item.so ? true : item.so === 'os' ? podeOs : podeTelaDoApp(item.so, userRole, isOwner, userPermissions)));

  return (
    <nav className="app-nav">
      {itens.map(({ path, label, Icon, match }) => {
        const ativo = match(location.pathname);
        return (
          <button
            key={path}
            type="button"
            className="app-nav__item"
            aria-current={ativo ? 'page' : undefined}
            onClick={() => navigate(path)}
          >
            <span className="app-nav__pilula"><Icon size={21} strokeWidth={ativo ? 2.3 : 2} /></span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default VendedorBottomNav;
