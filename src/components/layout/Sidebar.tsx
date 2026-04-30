import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
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
  LogOut,
  FileText,
  ShoppingCart,
  BarChart2,
  PieChart,
  ChevronDown,
  ChevronRight,
  Receipt
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './Layout.css';

const Sidebar: React.FC = () => {
  const { logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isNavigatingHome, setIsNavigatingHome] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const [expandAll, setExpandAll] = useState(() => {
    const saved = localStorage.getItem('nexus_sidebar_expand_all');
    return saved === 'true';
  });

  const handleExpandAllToggle = () => {
    const newVal = !expandAll;
    setExpandAll(newVal);
    localStorage.setItem('nexus_sidebar_expand_all', String(newVal));
    window.dispatchEvent(new Event('sidebar-state-change'));
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('nexus_sidebar_groups');
    return saved ? JSON.parse(saved) : {
      visaoGeral: true,
      vendas: true,
      mecanica: true,
      fiscal: true,
      cadastros: true,
      financeiro: true,
      ferramentas: true,
      admin: true
    };
  });

  const groupRoutes = {
    visaoGeral: ['/dashboard'],
    vendas: ['/pedidos-venda', '/orcamentos', '/relatorios-vendas'],
    mecanica: ['/os', '/relatorios-mecanica'],
    fiscal: ['/fiscal/nfe'],
    cadastros: ['/clientes', '/estoque', '/servicos', '/categorias'],
    financeiro: ['/financeiro/caixa', '/financeiro/faturamento'],
    ferramentas: ['/lembretes'],
    admin: ['/configuracoes']
  };

  const isGroupActive = (group: keyof typeof groupRoutes) => {
    return groupRoutes[group].some(route => location.pathname.startsWith(route));
  };

  const isExpanded = (group: string) => {
    if (expandAll) return true;
    return expandedGroups[group] || isGroupActive(group as keyof typeof groupRoutes);
  };

  const toggleGroup = (group: string) => {
    if (isGroupActive(group as keyof typeof groupRoutes)) return; // Prevent collapse if active
    const newExpanded = { ...expandedGroups, [group]: !expandedGroups[group] };
    setExpandedGroups(newExpanded);
    localStorage.setItem('nexus_sidebar_groups', JSON.stringify(newExpanded));
  };

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
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '8px', opacity: isGroupActive('visaoGeral') ? 1 : 0.7 }}>
            <span>Visão Geral</span>
          </div>
          <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </NavLink>
        </div>

        {/* Chavinha Expandir Tudo */}
        <div className="expand-toggle-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 16px 8px', marginBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Expandir todos os blocos</span>
          <div 
            onClick={handleExpandAllToggle}
            style={{ 
              position: 'relative', 
              width: '32px', 
              height: '18px', 
              backgroundColor: expandAll ? 'var(--accent-purple)' : 'var(--bg-tertiary)', 
              borderRadius: '10px', 
              transition: 'background-color 0.3s',
              cursor: 'pointer',
              border: '1px solid var(--border-color)'
            }}
          >
            <div style={{ 
              position: 'absolute', 
              top: '0px', 
              left: expandAll ? '14px' : '0px', 
              width: '16px', 
              height: '16px', 
              backgroundColor: '#fff', 
              borderRadius: '50%', 
              transition: 'left 0.3s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }} />
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('cadastros')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('cadastros') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('cadastros')}>
            <span>Cadastros</span>
            {!expandAll && (isExpanded('cadastros') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('cadastros') && (
            <>
              <NavLink to="/clientes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Users size={20} />
                <span>Clientes</span>
              </NavLink>
              <NavLink to="/estoque" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Car size={20} />
                <span>Estoque / Peças</span>
              </NavLink>
              <NavLink to="/servicos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Briefcase size={20} />
                <span>Cadastro de Serviços</span>
              </NavLink>
              <NavLink to="/categorias" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Tags size={20} />
                <span>Categorias</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('vendas')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('vendas') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('vendas')}>
            <span>Vendas</span>
            {!expandAll && (isExpanded('vendas') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('vendas') && (
            <>
              <NavLink to="/pedidos-venda" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <ShoppingCart size={20} />
                <span>Pedido de Vendas</span>
              </NavLink>
              <NavLink to="/orcamentos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <FileText size={20} />
                <span>Orçamentos</span>
              </NavLink>
              <NavLink to="/relatorios-vendas" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <BarChart2 size={20} />
                <span>Relatórios</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('mecanica')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('mecanica') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('mecanica')}>
            <span>Mecânica</span>
            {!expandAll && (isExpanded('mecanica') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('mecanica') && (
            <>
              <NavLink to="/os" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Wrench size={20} />
                <span>Ordens de Serviço</span>
              </NavLink>
              <NavLink to="/relatorios-mecanica" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <PieChart size={20} />
                <span>Relatórios</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('fiscal')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('fiscal') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('fiscal')}>
            <span>Fiscal</span>
            {!expandAll && (isExpanded('fiscal') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('fiscal') && (
            <>
              <NavLink to="/fiscal/nfe" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Receipt size={20} />
                <span>Emitir Nota Fiscal</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('financeiro')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('financeiro') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('financeiro')}>
            <span>Financeiro</span>
            {!expandAll && (isExpanded('financeiro') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('financeiro') && (
            <>
              <NavLink to="/financeiro/caixa" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Wallet size={20} />
                <span>Fluxo de Caixa</span>
              </NavLink>
              <NavLink to="/financeiro/faturamento" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <TrendingUp size={20} />
                <span>Faturamento</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('ferramentas')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('ferramentas') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('ferramentas')}>
            <span>Ferramentas</span>
            {!expandAll && (isExpanded('ferramentas') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('ferramentas') && (
            <>
              <NavLink to="/lembretes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Bell size={20} />
                <span>Lembretes CRM</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="nav-group">
          <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: (expandAll || isGroupActive('admin')) ? 'default' : 'pointer', paddingRight: '8px', opacity: isGroupActive('admin') ? 1 : 0.7 }} onClick={() => !expandAll && toggleGroup('admin')}>
            <span>Administrativo</span>
            {!expandAll && (isExpanded('admin') ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </div>
          {isExpanded('admin') && (
            <>
              <NavLink to="/configuracoes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <Settings size={20} />
                <span>Configurações</span>
              </NavLink>
            </>
          )}
        </div>
      </nav>

      <div style={{ padding: '20px', borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
        <button 
          className="logout-btn"
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
          <span className="logout-text">Sair do Sistema</span>
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
