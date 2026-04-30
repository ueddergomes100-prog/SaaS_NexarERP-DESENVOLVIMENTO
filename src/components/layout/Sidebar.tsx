import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Wrench, 
  Car, 
  Wallet, 
  TrendingUp, 
  Users, 
  Settings,
  Bell,
  Tags,
  Briefcase,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './Layout.css';

const Sidebar: React.FC = () => {
  const { logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isNavigatingHome, setIsNavigatingHome] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    setIsLoggingOut(true);
    setTimeout(() => {
      logout();
    }, 1500); // 1.5 seconds animation before actually logging out
  };

  const handleGoHome = () => {
    if (window.location.pathname === '/dashboard') return;
    setIsNavigatingHome(true);
    setTimeout(() => {
      navigate('/dashboard');
      setIsNavigatingHome(false);
    }, 800);
  };

  return (
    <aside className="sidebar">
      <div 
        className="sidebar-logo" 
        onClick={handleGoHome} 
        style={{ cursor: 'pointer' }}
        title="Ir para Dashboard"
      >
        <div className="logo-icon">N</div>
        <h2>Nexus ERP</h2>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group">
          <span className="nav-label">Visão Geral</span>
          <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </NavLink>
        </div>

        <div className="nav-group">
          <span className="nav-label">Mecânica</span>
          <NavLink to="/os" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Wrench size={20} />
            <span>Ordens de Serviço</span>
          </NavLink>
          <NavLink to="/estoque" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Car size={20} />
            <span>Estoque / Peças</span>
          </NavLink>
          <NavLink to="/servicos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Briefcase size={20} />
            <span>Serviços Mão de Obra</span>
          </NavLink>
        </div>

        <div className="nav-group">
          <span className="nav-label">Financeiro</span>
          <NavLink to="/financeiro/caixa" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Wallet size={20} />
            <span>Fluxo de Caixa</span>
          </NavLink>
          <NavLink to="/financeiro/faturamento" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <TrendingUp size={20} />
            <span>Faturamento</span>
          </NavLink>
        </div>

        <div className="nav-group">
          <span className="nav-label">Administrativo</span>
          <NavLink to="/clientes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Users size={20} />
            <span>Clientes</span>
          </NavLink>
          <NavLink to="/lembretes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Bell size={20} />
            <span>Lembretes CRM</span>
          </NavLink>
          <NavLink to="/configuracoes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Settings size={20} />
            <span>Configurações</span>
          </NavLink>
          <NavLink to="/categorias" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <Tags size={20} />
            <span>Categorias</span>
          </NavLink>
        </div>
      </nav>

      <div style={{ padding: '20px', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
        <button 
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            padding: '12px',
            backgroundColor: 'transparent',
            color: '#ef4444',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'background-color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <LogOut size={20} />
          <span>Sair do Sistema</span>
        </button>
      </div>

      {isLoggingOut && (
        <div className="logout-overlay">
          <div className="logout-logo-container">
            <div className="logo-icon animate-pulse-logo">N</div>
            <h2 className="animate-fade-in-up">Até logo!</h2>
          </div>
        </div>
      )}

      {isNavigatingHome && (
        <div className="logout-overlay" style={{ animationDuration: '0.2s', backgroundColor: 'rgba(10, 10, 11, 0.95)' }}>
          <div className="logout-logo-container">
            <div className="logo-icon animate-pulse-logo" style={{ animationDuration: '0.8s', width: '60px', height: '60px', fontSize: '28px' }}>N</div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
