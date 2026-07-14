import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart2,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  Car,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  DollarSign,
  Factory,
  FileText,
  Inbox,
  LayoutDashboard,
  Link2,
  LogOut,
  Package,
  PieChart,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wrench,
  Clock
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { isTenantManagerRole } from '../../utils/roles';
import './Layout.css';

type NavItem = {
  label: string;
  to: string;
  icon: React.ElementType;
  badge?: string;
  module?: string;
  permission?: string;
  managerOnly?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ElementType;
  tone: string;
  items: NavItem[];
  roadmap?: boolean;
};

const Sidebar: React.FC = () => {
  const {
    logout,
    userRole,
    userPermissions,
    blockedModules,
    isOwner,
    isPlatformAdmin,
    currentUser,
    selectedTenant
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isNavigatingHome, setIsNavigatingHome] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [miniSidebar, setMiniSidebar] = useState(() => localStorage.getItem('nexus_mini_sidebar') === 'true');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('nexus_sidebar_groups');
    return saved ? JSON.parse(saved) : {
      principal: true,
      comercial: true,
      mecanica: true,
      cadastros: false,
      financeiro: false,
      fiscal: false,
      relacionamento: false,
      administrativo: false,
      configuracoes: false,
      comprasDev: false,
      ecommerceDev: false,
      operacoesDev: false
    };
  });

  const hasFullAccess = isOwner || isTenantManagerRole(userRole) || isPlatformAdmin;
  const isBlocked = useCallback((module?: string) => Boolean(module && blockedModules?.includes(module)), [blockedModules]);
  const canAccess = useCallback((item: NavItem) => {
    if (isBlocked(item.module)) return false;
    if (item.managerOnly && !hasFullAccess) return false;
    return hasFullAccess || !item.permission || userPermissions?.includes(item.permission);
  }, [hasFullAccess, isBlocked, userPermissions]);

  const groups = useMemo<NavGroup[]>(() => [
    {
      id: 'principal',
      label: 'Principal',
      icon: LayoutDashboard,
      tone: '#2d8cff',
      items: [
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, module: 'dashboard.empresa' }
      ]
    },
    {
      id: 'comercial',
      label: 'Comercial',
      icon: ShoppingCart,
      tone: '#8b5cf6',
      items: [
        { label: 'Pedidos de Venda', to: '/pedidos-venda', icon: ShoppingCart, module: 'comercial.pedidos', permission: 'vendas.pedidos' },
        { label: 'Orçamentos', to: '/orcamentos', icon: FileText, module: 'comercial.orcamentos', permission: 'vendas.orcamentos' },
        { label: 'Devolução de Venda', to: '/vendas/devolucoes', icon: RotateCcw, module: 'comercial.devolucoes', permission: 'vendas.devolucao' },
        { label: 'Relatório de Vendas', to: '/relatorios-vendas', icon: BarChart2, module: 'comercial.relatorios', permission: 'vendas.relatorios' }
      ]
    },
    {
      id: 'mecanica',
      label: 'Mecânica',
      icon: Wrench,
      tone: '#3b82f6',
      items: [
        { label: 'Ordens de Serviço', to: '/os', icon: Wrench, module: 'mecanica.os', permission: 'mecanica.os' },
        { label: 'Agendamentos', to: '/crm/agenda', icon: Calendar, module: 'crm.agenda', permission: 'crm.agenda', badge: 'Agenda' },
        { label: 'Relatório de Serviços', to: '/relatorios-mecanica', icon: PieChart, module: 'mecanica.relatorios', permission: 'mecanica.relatorios' }
      ]
    },
    {
      id: 'cadastros',
      label: 'Cadastros',
      icon: Users,
      tone: '#22c55e',
      items: [
        { label: 'Clientes', to: '/clientes', icon: Users, module: 'cadastros.clientes', permission: 'cadastros.clientes' },
        { label: 'Veículos', to: '/veiculos', icon: Car, module: 'cadastros.veiculos', permission: 'cadastros.clientes' },
        { label: 'Estoque / Produtos', to: '/estoque', icon: Package, module: 'cadastros.estoque', permission: 'cadastros.estoque' },
        { label: 'Serviços', to: '/servicos', icon: Briefcase, module: 'cadastros.servicos', permission: 'cadastros.servicos' },
        { label: 'Categorias', to: '/categorias', icon: Tags, module: 'cadastros.categorias', permission: 'cadastros.categorias' },
        { label: 'Unidades de Medida', to: '/unidades-medida', icon: Scale, module: 'cadastros.unidades_medida', permission: 'cadastros.unidades_medida' },
        { label: 'Usuários', to: '/usuarios', icon: UserCog, module: 'cadastros.usuarios', permission: 'administrativo.equipe' }
      ]
    },
    {
      id: 'financeiro',
      label: 'Financeiro',
      icon: Wallet,
      tone: '#facc15',
      items: [
        { label: 'Fluxo de Caixa', to: '/financeiro/caixa', icon: Wallet, module: 'financeiro.caixa', permission: 'financeiro.caixa' },
        { label: 'Contas a Receber', to: '/financeiro/contas-receber', icon: Clock, module: 'financeiro.receber', permission: 'financeiro.receber' },
        { label: 'Contas a Pagar', to: '/financeiro/contas-pagar', icon: Receipt, module: 'financeiro.pagar', permission: 'financeiro.pagar' },
        { label: 'Faturamento', to: '/financeiro/faturamento', icon: BarChart2, module: 'financeiro.faturamento', permission: 'financeiro.faturamento' },
        { label: 'Comissões a Pagar', to: '/financeiro/comissoes', icon: DollarSign, module: 'financeiro.comissoes', permission: 'financeiro.comissoes' }
      ]
    },
    {
      id: 'fiscal',
      label: 'Fiscal',
      icon: Receipt,
      tone: '#22d3ee',
      items: [
        { label: 'Emitir Nota Fiscal', to: '/fiscal/nfe', icon: Receipt, module: 'fiscal.nfe', permission: 'fiscal.emitir' },
        { label: 'Entrada de XML', to: '/fiscal/entrada-nfe', icon: Inbox, module: 'fiscal.entrada_nfe', permission: 'fiscal.entrada' }
      ]
    },
    {
      id: 'relacionamento',
      label: 'Relacionamento',
      icon: Bell,
      tone: '#fb7185',
      items: [
        { label: 'Alertas de Retorno', to: '/crm/lembretes', icon: Bell, module: 'crm.lembretes', permission: 'crm.alertas' },
        { label: 'Agenda', to: '/crm/agenda', icon: Calendar, module: 'crm.agenda', permission: 'crm.agenda' }
      ]
    },
    {
      id: 'administrativo',
      label: 'Administração',
      icon: ShieldAlert,
      tone: '#94a3b8',
      items: [
        { label: 'Relatórios Diversos', to: '/relatorios-diversos', icon: FileText, module: 'logs.relatorios_diversos', managerOnly: true },
        { label: 'Logs do Sistema', to: '/logs-sistema', icon: ShieldAlert, module: 'logs.sistema', permission: 'administrativo.logs' }
      ]
    },
    {
      id: 'configuracoes',
      label: 'Configurações',
      icon: Settings,
      tone: '#a78bfa',
      items: [
        { label: 'Configurações Gerais', to: '/configuracoes', icon: Settings, module: 'admin.config', permission: 'administrativo.config' }
      ]
    },
    {
      id: 'comprasDev',
      label: 'Compras',
      icon: ClipboardList,
      tone: '#fb923c',
      roadmap: true,
      items: [
        { label: 'Pedidos de Compra', to: '/compras/pedidos-compra', icon: ClipboardList, module: 'compras.pedidos' },
        { label: 'Fornecedores', to: '/compras/fornecedores', icon: Users, module: 'compras.fornecedores' },
        { label: 'Cotação de Compra', to: '/compras/cotacoes', icon: Inbox, module: 'compras.cotacoes' }
      ]
    },
    {
      id: 'ecommerceDev',
      label: 'E-commerce',
      icon: Store,
      tone: '#38bdf8',
      roadmap: true,
      items: [
        { label: 'Nuvemshop', to: '/integracoes/nuvemshop', icon: Store, module: 'integracoes.nuvemshop' },
        { label: 'Marketplaces', to: '/integracoes/marketplaces', icon: ShoppingCart, module: 'integracoes.marketplaces' },
        { label: 'Sincronizações', to: '/integracoes/sincronizacoes', icon: Link2, module: 'integracoes.sincronizacoes' }
      ]
    },
    {
      id: 'operacoesDev',
      label: 'Operações',
      icon: Factory,
      tone: '#14b8a6',
      roadmap: true,
      items: [
        { label: 'Produção Interna', to: '/operacoes/producao', icon: Factory, module: 'operacoes.producao' },
        { label: 'Expedição e Entregas', to: '/operacoes/expedicao', icon: Truck, module: 'operacoes.expedicao' },
        { label: 'Lotes e Validades', to: '/operacoes/lotes-validades', icon: Package, module: 'operacoes.lotes' }
      ]
    }
  ], []);

  const visibleGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return groups
      .map((group) => {
        const visibleItems = group.items.filter(canAccess);
        if (visibleItems.length === 0) return null;
        if (!term) return { ...group, items: visibleItems };

        const groupMatches = group.label.toLowerCase().includes(term);
        const filteredItems = groupMatches
          ? visibleItems
          : visibleItems.filter((item) => item.label.toLowerCase().includes(term));

        return filteredItems.length > 0 ? { ...group, items: filteredItems } : null;
      })
      .filter(Boolean) as NavGroup[];
  }, [canAccess, groups, searchTerm]);

  const quickActions = [
    { label: 'Venda', to: '/pedidos-venda/novo', icon: ShoppingCart, permission: 'vendas.pedidos', module: 'comercial.pedidos' },
    { label: 'Cliente', to: '/clientes/novo', icon: Users, permission: 'cadastros.clientes', module: 'cadastros.clientes' },
    { label: 'OS', to: '/os/nova', icon: Wrench, permission: 'mecanica.os', module: 'mecanica.os' },
    { label: 'Orçamento', to: '/orcamentos/novo', icon: FileText, permission: 'vendas.orcamentos', module: 'comercial.orcamentos' }
  ].filter(canAccess);

  const isGroupActive = (group: NavGroup) => group.items.some((item) => location.pathname.startsWith(item.to));
  const isExpanded = (group: NavGroup) => {
    if (searchTerm.trim()) return true;
    return expandedGroups[group.id] ?? isGroupActive(group);
  };
  const isRailActive = (group: NavGroup) => expandedGroups[group.id] ?? isGroupActive(group);

  const toggleGroup = (group: NavGroup) => {
    const currentlyExpanded = expandedGroups[group.id] ?? isGroupActive(group);
    const nextState = { ...expandedGroups, [group.id]: !currentlyExpanded };
    setExpandedGroups(nextState);
    localStorage.setItem('nexus_sidebar_groups', JSON.stringify(nextState));
  };

  const navigateTo = (to: string) => {
    setActionMenuOpen(false);
    document.body.classList.remove('mobile-sidebar-open');
    navigate(to);
  };

  const handleLogout = useCallback(() => {
    setIsLoggingOut(true);
    setTimeout(() => logout(), 1500);
  }, [logout]);

  const handleGoHome = () => {
    if (window.location.pathname === '/dashboard') return;
    setIsNavigatingHome(true);
    setTimeout(() => {
      navigate('/dashboard');
      setIsNavigatingHome(false);
    }, 700);
  };

  const toggleMiniSidebar = () => {
    const nextValue = !miniSidebar;
    setMiniSidebar(nextValue);
    localStorage.setItem('nexus_mini_sidebar', String(nextValue));
    localStorage.setItem('nexus_sidebar_expand_all', 'true');
    document.body.classList.toggle('mini-sidebar', nextValue);
    window.dispatchEvent(new Event('sidebar-state-change'));
  };

  useEffect(() => {
    const onTriggerLogout = () => handleLogout();
    window.addEventListener('trigger-logout', onTriggerLogout);
    return () => window.removeEventListener('trigger-logout', onTriggerLogout);
  }, [handleLogout]);

  useEffect(() => {
    document.body.classList.toggle('mini-sidebar', miniSidebar);
  }, [miniSidebar]);

  const tenantName = selectedTenant?.nomeOficina || 'Nexus Company';
  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuário';
  const userInitial = userName.trim().charAt(0).toUpperCase() || 'N';

  return (
    <>
      <div
        className="mobile-sidebar-overlay"
        onClick={() => document.body.classList.remove('mobile-sidebar-open')}
      />

      <aside className="sidebar nexus-sidebar">
        <div className="nexus-sidebar-rail">
          <button className="nexus-rail-logo" onClick={handleGoHome} title="Ir para Dashboard">
            N
          </button>

          <div className="nexus-rail-modules">
            {visibleGroups.slice(0, 9).map((group) => {
              const Icon = group.icon;
              const expanded = isRailActive(group);
              return (
                <button
                  key={group.id}
                  className={expanded ? 'nexus-rail-item active' : 'nexus-rail-item'}
                  onClick={() => {
                    if (miniSidebar) {
                      setMiniSidebar(false);
                      localStorage.setItem('nexus_mini_sidebar', 'false');
                      document.body.classList.remove('mini-sidebar');
                    }
                    toggleGroup(group);
                  }}
                  title={group.label}
                  aria-pressed={expanded}
                  style={{ '--module-color': group.tone } as React.CSSProperties}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>

          <div className="nexus-rail-bottom">
            <button className="nexus-rail-item" onClick={toggleMiniSidebar} title={miniSidebar ? 'Expandir menu' : 'Recolher menu'}>
              {miniSidebar ? <ChevronsRight size={19} /> : <ChevronsLeft size={19} />}
            </button>
          </div>
        </div>

        <div className="nexus-sidebar-pane">
          <div className="nexus-sidebar-header">
            <button className="nexus-workspace" onClick={handleGoHome} title={tenantName}>
              <span>{tenantName}</span>
              <ChevronDown size={16} />
            </button>

            <div className="nexus-sidebar-search">
              <Search size={16} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar no menu..."
                aria-label="Buscar no menu"
              />
              <kbd>Ctrl K</kbd>
            </div>

            <div className="nexus-action-block">
              <button
                className="nexus-new-action"
                type="button"
                onClick={() => setActionMenuOpen((open) => !open)}
              >
                <Plus size={17} />
                Nova Ação
                <ChevronDown size={16} />
              </button>

              {actionMenuOpen && (
                <div className="nexus-new-action-menu">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button key={action.to} type="button" onClick={() => navigateTo(action.to)}>
                        <Icon size={17} />
                        <span>{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <nav className="nexus-sidebar-nav" aria-label="Menu principal">
            <div className="nexus-nav-caption">Navegação</div>

            {visibleGroups.map((group) => {
              const Icon = group.icon;
              const expanded = isExpanded(group);
              const active = isGroupActive(group);
              return (
                <div key={group.id} className={group.roadmap ? 'nexus-nav-group roadmap' : 'nexus-nav-group'}>
                  <button
                    type="button"
                    className={active ? 'nexus-nav-group-trigger active' : 'nexus-nav-group-trigger'}
                    onClick={() => toggleGroup(group)}
                    style={{ '--module-color': group.tone } as React.CSSProperties}
                  >
                    <span className="nexus-module-dot" />
                    <Icon size={17} />
                    <span>{group.label}</span>
                    {group.roadmap && <small>Em breve</small>}
                    <ChevronRight className={expanded ? 'open' : ''} size={15} />
                  </button>

                  <div className={expanded ? 'nexus-nav-items open' : 'nexus-nav-items'}>
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive }) => isActive ? 'nexus-nav-link active' : 'nexus-nav-link'}
                          onClick={() => document.body.classList.remove('mobile-sidebar-open')}
                        >
                          <ItemIcon size={16} />
                          <span>{item.label}</span>
                          {item.badge && <small>{item.badge}</small>}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {visibleGroups.length === 0 && (
              <div className="nexus-nav-empty">
                Nenhum item encontrado.
              </div>
            )}
          </nav>

          <div className="nexus-sidebar-footer">
            <div className="nexus-day-summary">
              <span>Resumo rápido</span>
              <button type="button" onClick={() => navigateTo('/os')}>
                <Wrench size={15} />
                <strong>Atendimentos</strong>
                <small>Abrir</small>
              </button>
              <button type="button" onClick={() => navigateTo('/pedidos-venda')}>
                <ShoppingCart size={15} />
                <strong>Vendas</strong>
                <small>Abrir</small>
              </button>
              <button type="button" onClick={() => navigateTo('/crm/lembretes')}>
                <AlertTriangle size={15} />
                <strong>Pendências</strong>
                <small>Abrir</small>
              </button>
            </div>

            <div className="nexus-user-card">
              <div className="nexus-user-avatar">{userInitial}</div>
              <div>
                <strong>{userName}</strong>
                <span>{userRole || 'Operador'}</span>
              </div>
              <button type="button" onClick={handleLogout} title="Sair do Sistema">
                <LogOut size={17} />
              </button>
            </div>

            <div className="nexus-tenant-card">
              <Building2 size={17} />
              <div>
                <strong>{tenantName}</strong>
                <span>Ambiente ativo</span>
              </div>
            </div>
          </div>
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
