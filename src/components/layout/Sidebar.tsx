import React, { useState, useEffect } from 'react';
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
  UserCog,
  FileText,
  ShoppingCart,
  BarChart2,
  PieChart,
  ChevronRight,
  Receipt,
  Calendar,
  Inbox,
  Clock,
  DollarSign,
  Package,
  Printer,
  RotateCcw,
  Scale,
  ShieldAlert
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import './Layout.css';

const Sidebar: React.FC = () => {
  const { logout, userRole, userPermissions } = useAuth();
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
      cadastros: true,
      comercial: true,
      mecanica: true,
      crm: true,
      financeiro: true,
      fiscal: true,
      administrativo: true,
      configuracoes: true
    };
  });

  useEffect(() => {
    const onTriggerLogout = () => {
      handleLogout();
    };
    window.addEventListener('trigger-logout', onTriggerLogout);
    return () => window.removeEventListener('trigger-logout', onTriggerLogout);
  }, []);

  const groupRoutes = {
    visaoGeral: ['/dashboard'],
    cadastros: ['/clientes', '/usuarios', '/veiculos', '/estoque', '/servicos', '/categorias', '/unidades-medida'],
    comercial: ['/pedidos-venda', '/orcamentos', '/vendas/devolucoes', '/relatorios-vendas'],
    mecanica: ['/os', '/relatorios-mecanica'],
    crm: ['/crm/agenda', '/crm/lembretes'],
    financeiro: ['/financeiro/caixa', '/financeiro/contas-receber', '/financeiro/contas-pagar', '/financeiro/faturamento', '/financeiro/comissoes'],
    fiscal: ['/fiscal/nfe', '/fiscal/entrada-nfe'],
    administrativo: ['/relatorios-diversos', '/logs-sistema'],
    configuracoes: ['/configuracoes']
  };

  const isGroupActive = (group: keyof typeof groupRoutes) => {
    if (!groupRoutes[group]) return false;
    return groupRoutes[group].some(route => location.pathname.startsWith(route));
  };

  const isExpanded = (group: string) => {
    if (expandAll) return true;
    return expandedGroups[group] || isGroupActive(group as keyof typeof groupRoutes);
  };

  const toggleGroup = (group: string) => {
    if (isGroupActive(group as keyof typeof groupRoutes)) return; 
    const newExpanded = { ...expandedGroups, [group]: !expandedGroups[group] };
    setExpandedGroups(newExpanded);
    localStorage.setItem('nexus_sidebar_groups', JSON.stringify(newExpanded));
  };

  const handleLogout = () => {
    setIsLoggingOut(true);
    setTimeout(() => {
      logout();
    }, 1500); 
  };

  const handleGoHome = () => {
    if (window.location.pathname === '/dashboard') return;
    setIsNavigatingHome(true);
    setTimeout(() => {
      navigate('/dashboard');
      setIsNavigatingHome(false);
    }, 800);
  };

  const hasCadastrosPermission = userRole === 'Admin' || ['cadastros.clientes', 'cadastros.estoque', 'cadastros.servicos', 'cadastros.categorias', 'cadastros.unidades_medida', 'administrativo.equipe'].some(p => userPermissions?.includes(p));
  const hasComercialPermission = userRole === 'Admin' || ['vendas.pedidos', 'vendas.orcamentos', 'vendas.devolucao', 'vendas.relatorios'].some(p => userPermissions?.includes(p));
  const hasMecanicaPermission = userRole === 'Admin' || ['mecanica.os', 'mecanica.relatorios'].some(p => userPermissions?.includes(p));
  const hasCrmPermission = userRole === 'Admin' || ['crm.agenda', 'crm.alertas'].some(p => userPermissions?.includes(p));
  const hasFinanceiroPermission = userRole === 'Admin' || ['financeiro.caixa', 'financeiro.receber', 'financeiro.pagar', 'financeiro.faturamento', 'financeiro.comissoes'].some(p => userPermissions?.includes(p));
  const hasFiscalPermission = userRole === 'Admin' || ['fiscal.emitir', 'fiscal.entrada'].some(p => userPermissions?.includes(p));
  const hasAdministrativoPermission = userRole === 'Admin' || userPermissions?.includes('administrativo.logs');
  const hasConfiguracoesPermission = userRole === 'Admin' || userPermissions?.includes('administrativo.config');

  return (
    <>
      <div 
        className="mobile-sidebar-overlay" 
        onClick={() => document.body.classList.remove('mobile-sidebar-open')}
      ></div>
      <aside className="sidebar">
        <div 
          className="sidebar-logo" 
          onClick={handleGoHome} 
          style={{ cursor: 'pointer' }}
          title={userRole === 'SuperAdmin' ? "Ir para Painel SaaS" : "Ir para Dashboard"}
        >
          <div className="logo-icon">N</div>
          <h2>Nexar ERP</h2>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '8px', opacity: isGroupActive('visaoGeral') ? 1 : 0.7 }}>
              <span>{userRole === 'SuperAdmin' ? 'SaaS Control' : 'Visão Geral'}</span>
            </div>
            {userRole === 'SuperAdmin' ? (
              <>
                <NavLink to="/superadmin" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                  <LayoutDashboard size={20} />
                  <span>Painel de Vendas SaaS</span>
                </NavLink>
                <NavLink to="/superadmin" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                  <Users size={20} />
                  <span>Carteira de Clientes</span>
                </NavLink>
              </>
            ) : (
              <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                <LayoutDashboard size={20} />
                <span>Dashboard da Oficina</span>
              </NavLink>
            )}
          </div>

          {userRole !== 'SuperAdmin' && (
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
                  backgroundColor: 'var(--text-primary)', 
                  borderRadius: '50%', 
                  transition: 'left 0.3s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }} />
              </div>
            </div>
          )}

          {userRole !== 'SuperAdmin' && (
            <>
              {hasCadastrosPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('cadastros') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('cadastros')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Cadastros</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('cadastros') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('cadastros') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.clientes')) && (
                        <NavLink to="/clientes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Users size={20} />
                          <span>Clientes</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('administrativo.equipe')) && (
                        <NavLink to="/usuarios" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <UserCog size={20} />
                          <span>Usuários</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.clientes')) && (
                        <NavLink to="/veiculos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Car size={20} />
                          <span>Veículos</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.estoque')) && (
                        <NavLink to="/estoque" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Package size={20} />
                          <span>Estoque / Peças</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.servicos')) && (
                        <NavLink to="/servicos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Briefcase size={20} />
                          <span>Cadastro de Serviços</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.categorias')) && (
                        <NavLink to="/categorias" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Tags size={20} />
                          <span>Categorias</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('cadastros.unidades_medida')) && (
                        <NavLink to="/unidades-medida" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Scale size={20} />
                          <span>Unidades de Medida</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasComercialPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('comercial') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('comercial')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Comercial</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('comercial') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('comercial') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('vendas.pedidos')) && (
                        <NavLink to="/pedidos-venda" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <ShoppingCart size={20} />
                          <span>Pedido de Vendas</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('vendas.orcamentos')) && (
                        <NavLink to="/orcamentos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <FileText size={20} />
                          <span>Orçamentos</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('vendas.devolucao')) && (
                        <NavLink to="/vendas/devolucoes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <RotateCcw size={20} />
                          <span>Devolução de Venda</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('vendas.relatorios')) && (
                        <NavLink to="/relatorios-vendas" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <BarChart2 size={20} />
                          <span>Relatório de Vendas</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasMecanicaPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('mecanica') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('mecanica')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Mecânica / Serviços</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('mecanica') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('mecanica') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('mecanica.os')) && (
                        <NavLink to="/os" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Wrench size={20} />
                          <span>Ordens de Serviço</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('mecanica.relatorios')) && (
                        <NavLink to="/relatorios-mecanica" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <PieChart size={20} />
                          <span>Relatório de Serviços</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasCrmPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('crm') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('crm')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>CRM & Agenda</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('crm') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('crm') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('crm.agenda')) && (
                        <NavLink to="/crm/agenda" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Calendar size={20} />
                          <span>Agendamentos</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('crm.alertas')) && (
                        <NavLink to="/crm/lembretes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Bell size={20} />
                          <span>Alertas de Retorno</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasFinanceiroPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('financeiro') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('financeiro')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Financeiro</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('financeiro') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('financeiro') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('financeiro.caixa')) && (
                        <NavLink to="/financeiro/caixa" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Wallet size={20} />
                          <span>Fluxo de Caixa</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('financeiro.receber')) && (
                        <NavLink to="/financeiro/contas-receber" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Clock size={20} />
                          <span>Contas a Receber</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('financeiro.pagar')) && (
                        <NavLink to="/financeiro/contas-pagar" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Receipt size={20} />
                          <span>Contas a Pagar</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('financeiro.faturamento')) && (
                        <NavLink to="/financeiro/faturamento" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <TrendingUp size={20} />
                          <span>Faturamento</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('financeiro.comissoes')) && (
                        <NavLink to="/financeiro/comissoes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <DollarSign size={20} />
                          <span>Comissões a Pagar</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasFiscalPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('fiscal') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('fiscal')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>Fiscal</span>
                      <span className="dev-badge pulse-badge">Em desenvolvimento</span>
                    </div>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('fiscal') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('fiscal') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('fiscal.emitir')) && (
                        <NavLink to="/fiscal/nfe" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Receipt size={20} />
                          <span>Emitir Nota Fiscal</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('fiscal.entrada')) && (
                        <NavLink to="/fiscal/entrada-nfe" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Inbox size={20} />
                          <span>Entrada de XML</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasAdministrativoPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('administrativo') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('administrativo')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Administrativo</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('administrativo') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('administrativo') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {userRole === 'Admin' && (
                        <NavLink to="/relatorios-diversos" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Printer size={20} />
                          <span>Relatórios Diversos</span>
                        </NavLink>
                      )}
                      {(userRole === 'Admin' || userPermissions?.includes('administrativo.logs')) && (
                        <NavLink to="/logs-sistema" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <ShieldAlert size={20} />
                          <span>Logs do Sistema</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {hasConfiguracoesPermission && (
                <div className="nav-group">
                  <div 
                    className={`nav-label ${isGroupActive('configuracoes') ? 'active-group' : ''}`}
                    onClick={() => !expandAll && toggleGroup('configuracoes')}
                    style={{ cursor: expandAll ? 'default' : 'pointer' }}
                  >
                    <span>Configurações</span>
                    {!expandAll && (
                      <ChevronRight 
                        size={14} 
                        className={`group-arrow-indicator ${isExpanded('configuracoes') ? 'open' : ''}`} 
                      />
                    )}
                  </div>
                  <div className={`nav-group-items ${isExpanded('configuracoes') ? 'open' : ''}`}>
                    <div className="nav-group-items-inner">
                      {(userRole === 'Admin' || userPermissions?.includes('administrativo.config')) && (
                        <NavLink to="/configuracoes" className={({isActive}) => isActive ? 'nav-item active' : 'nav-item'}>
                          <Settings size={20} />
                          <span>Configurações Gerais</span>
                        </NavLink>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
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
    </>
  );
};

export default Sidebar;
