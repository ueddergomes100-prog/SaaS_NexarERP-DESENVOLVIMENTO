import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabs } from '../../contexts/TabsContext';
import {
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
  CreditCard,
  DollarSign,
  Factory,
  FileText,
  History,
  Inbox,
  Landmark,
  LayoutDashboard,
  Link2,
  LogOut,
  Package,
  PieChart,
  Plus,
  Receipt,
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
  Clock,
  Wrench,
  X
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { isTenantManagerRole } from '../../utils/roles';
import hennderIcon from '../../assets/hennder-icon.svg';
import wordmarkDark from '../../assets/hennder-wordmark-dark.png';
import wordmarkLight from '../../assets/hennder-wordmark-light.png';
import BootSplash from './BootSplash';
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
  const { tabs, activeTabId, openTab } = useTabs();
  const currentPath = tabs.find((tab) => tab.id === activeTabId)?.path || '';

  const searchInputRef = useRef<HTMLInputElement>(null);
  const actionBlockRef = useRef<HTMLDivElement>(null);

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
      cadastrosAuxiliares: false,
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
      items: [
        { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, module: 'dashboard.empresa' }
      ]
    },
    {
      id: 'comercial',
      label: 'Comercial',
      icon: ShoppingCart,
      items: [
        { label: 'Frente de Caixa', to: '/pdv', icon: Store, module: 'comercial.pedidos', permission: 'vendas.pedidos' },
        { label: 'Pedidos de Venda', to: '/pedidos-venda', icon: ShoppingCart, module: 'comercial.pedidos', permission: 'vendas.pedidos' },
        { label: 'Orçamentos', to: '/orcamentos', icon: FileText, module: 'comercial.orcamentos', permission: 'vendas.orcamentos' },
        { label: 'Relatório de Vendas', to: '/relatorios-vendas', icon: BarChart2, module: 'comercial.relatorios', permission: 'vendas.relatorios' }
      ]
    },
    {
      id: 'mecanica',
      label: 'Gestão de Serviços',
      icon: Briefcase,
      items: [
        { label: 'Ordens de Serviço', to: '/os', icon: ClipboardList, module: 'mecanica.os', permission: 'mecanica.os' },
        { label: 'Agendamentos', to: '/crm/agenda', icon: Calendar, module: 'crm.agenda', permission: 'crm.agenda', badge: 'Agenda' },
        { label: 'Relatório de Serviços', to: '/relatorios-mecanica', icon: PieChart, module: 'mecanica.relatorios', permission: 'mecanica.relatorios' }
      ]
    },
    {
      id: 'cadastros',
      label: 'Cadastros',
      icon: Users,
      items: [
        { label: 'Clientes', to: '/clientes', icon: Users, module: 'cadastros.clientes', permission: 'cadastros.clientes' },
        { label: 'Veículos', to: '/veiculos', icon: Car, module: 'cadastros.veiculos', permission: 'cadastros.clientes' },
        { label: 'Estoque / Produtos', to: '/estoque', icon: Package, module: 'cadastros.estoque', permission: 'cadastros.estoque' },
        { label: 'Serviços', to: '/servicos', icon: Briefcase, module: 'cadastros.servicos', permission: 'cadastros.servicos' }
      ]
    },
    {
      id: 'cadastrosAuxiliares',
      label: 'Cadastros Auxiliares',
      icon: Tags,
      items: [
        { label: 'Categorias', to: '/categorias', icon: Tags, module: 'cadastros.categorias', permission: 'cadastros.categorias' },
        { label: 'Unidades de Medida', to: '/unidades-medida', icon: Scale, module: 'cadastros.unidades_medida', permission: 'cadastros.unidades_medida' },
        { label: 'Bandeiras de Cartão', to: '/bandeiras-cartao', icon: CreditCard, module: 'cadastros.bandeiras_cartao', permission: 'cadastros.bandeiras_cartao' },
        { label: 'Bancos', to: '/bancos', icon: Building2, module: 'cadastros.bancos', permission: 'cadastros.bancos' },
        { label: 'Fornecedores', to: '/fornecedores', icon: Truck, module: 'cadastros.fornecedores', permission: 'cadastros.fornecedores' },
        { label: 'Matéria-Prima', to: '/materias-primas', icon: Factory, module: 'cadastros.materia_prima', permission: 'cadastros.materia_prima' }
      ]
    },
    {
      id: 'producao',
      label: 'Produção',
      icon: Factory,
      items: [
        { label: 'Ordens de Produção', to: '/producao/ordens', icon: ClipboardList, module: 'operacoes.producao', permission: 'operacoes.producao' },
        { label: 'Relatório de Produção', to: '/producao/relatorios', icon: PieChart, module: 'operacoes.producao', permission: 'operacoes.producao' },
      ]
    },
    {
      id: 'expedicao',
      label: 'Expedição',
      icon: Truck,
      items: [
        { label: 'Conferência de Mercadoria', to: '/operacoes/expedicao', icon: Truck, module: 'operacoes.expedicao', permission: 'operacoes.expedicao' }
      ]
    },
    {
      id: 'financeiro',
      label: 'Financeiro',
      icon: Wallet,
      items: [
        { label: 'Fluxo de Caixa', to: '/financeiro/caixa', icon: Wallet, module: 'financeiro.caixa', permission: 'financeiro.caixa' },
        { label: 'Caixa (Sessões PDV)', to: '/financeiro/caixa-registros', icon: Wallet, module: 'financeiro.caixa_registros', permission: 'financeiro.caixa_registros' },
        { label: 'Banco', to: '/financeiro/banco', icon: Landmark, module: 'financeiro.banco', permission: 'financeiro.banco' },
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
      items: [
        { label: 'Notas Fiscais', to: '/fiscal/nfe', icon: Receipt, module: 'fiscal.nfe', permission: 'fiscal.emitir' },
        { label: 'Entrada de XML', to: '/fiscal/entrada-nfe', icon: Inbox, module: 'fiscal.entrada_nfe', permission: 'fiscal.entrada' },
        { label: 'Histórico de Entradas', to: '/fiscal/entrada-nfe/historico', icon: History, module: 'fiscal.entrada_nfe', permission: 'fiscal.entrada' }
      ]
    },
    {
      id: 'utilitarios',
      label: 'Utilitários',
      icon: Wrench,
      items: [
        { label: 'SINTEGRA', to: '/utilitarios/sintegra', icon: FileText, module: 'utilitarios.sintegra', permission: 'utilitarios.sintegra' },
      ]
    },
    {
      id: 'relacionamento',
      label: 'Relacionamento',
      icon: Bell,
      items: [
        { label: 'Alertas de Retorno', to: '/crm/lembretes', icon: Bell, module: 'crm.lembretes', permission: 'crm.alertas' },
        { label: 'Agenda', to: '/crm/agenda', icon: Calendar, module: 'crm.agenda', permission: 'crm.agenda' }
      ]
    },
    {
      id: 'administrativo',
      label: 'Administração',
      icon: ShieldAlert,
      items: [
        { label: 'Usuários', to: '/usuarios', icon: UserCog, module: 'cadastros.usuarios', permission: 'administrativo.equipe' },
        { label: 'Relatórios Diversos', to: '/relatorios-diversos', icon: FileText, module: 'logs.relatorios_diversos', permission: 'administrativo.relatorios' },
        { label: 'Logs do Sistema', to: '/logs-sistema', icon: ShieldAlert, module: 'logs.sistema', permission: 'administrativo.logs' }
      ]
    },
    {
      id: 'configuracoes',
      label: 'Configurações',
      icon: Settings,
      items: [
        { label: 'Configurações Gerais', to: '/configuracoes', icon: Settings, module: 'admin.config', permission: 'administrativo.config' }
      ]
    },
    {
      id: 'comprasDev',
      label: 'Compras',
      icon: ClipboardList,
      roadmap: true,
      items: [
        { label: 'Pedidos de Compra', to: '/compras/pedidos-compra', icon: ClipboardList, module: 'compras.pedidos', permission: 'compras.pedidos' },
        { label: 'Cotação de Compra', to: '/compras/cotacoes', icon: Inbox, module: 'compras.cotacoes', permission: 'compras.cotacoes' }
      ]
    },
    {
      id: 'ecommerceDev',
      label: 'E-commerce',
      icon: Store,
      roadmap: true,
      items: [
        { label: 'Nuvemshop', to: '/integracoes/nuvemshop', icon: Store, module: 'integracoes.nuvemshop', permission: 'integracoes.nuvemshop' },
        { label: 'Marketplaces', to: '/integracoes/marketplaces', icon: ShoppingCart, module: 'integracoes.marketplaces', permission: 'integracoes.marketplaces' },
        { label: 'Sincronizações', to: '/integracoes/sincronizacoes', icon: Link2, module: 'integracoes.sincronizacoes', permission: 'integracoes.sincronizacoes' }
      ]
    },
    {
      id: 'operacoesDev',
      label: 'Operações',
      icon: Factory,
      roadmap: true,
      items: [
        { label: 'Lotes e Validades', to: '/operacoes/lotes-validades', icon: Package, module: 'operacoes.lotes', permission: 'operacoes.lotes' }
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

  // Trilha de icones do menu compacto: atalhos diretos pra telas
  // especificas (nao pra grupos) -- pedido do usuario, pra nao precisar
  // expandir o menu completo so pra trocar de tela com o menu recolhido.
  const railShortcuts: NavItem[] = [
    { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, module: 'dashboard.empresa' },
    { label: 'Pedido de Venda', to: '/pedidos-venda', icon: ShoppingCart, module: 'comercial.pedidos', permission: 'vendas.pedidos' },
    { label: 'Ordem de Serviço', to: '/os', icon: ClipboardList, module: 'mecanica.os', permission: 'mecanica.os' },
    { label: 'Estoque', to: '/estoque', icon: Package, module: 'cadastros.estoque', permission: 'cadastros.estoque' },
    { label: 'Contas a Receber', to: '/financeiro/contas-receber', icon: Clock, module: 'financeiro.receber', permission: 'financeiro.receber' },
    { label: 'Entrada de Notas', to: '/fiscal/entrada-nfe', icon: Inbox, module: 'fiscal.entrada_nfe', permission: 'fiscal.entrada' },
    { label: 'Agendamento', to: '/crm/agenda', icon: Calendar, module: 'crm.agenda', permission: 'crm.agenda' },
    { label: 'Relatórios Diversos', to: '/relatorios-diversos', icon: FileText, module: 'logs.relatorios_diversos', permission: 'administrativo.relatorios' },
    { label: 'Configuração Geral', to: '/configuracoes', icon: Settings, module: 'admin.config', permission: 'administrativo.config' },
  ].filter(canAccess);

  const quickActions = [
    { label: 'PDV', to: '/pdv', icon: Store, permission: 'vendas.pedidos', module: 'comercial.pedidos' },
    { label: 'Venda', to: '/pedidos-venda/novo', icon: ShoppingCart, permission: 'vendas.pedidos', module: 'comercial.pedidos' },
    { label: 'Cliente', to: '/clientes/novo', icon: Users, permission: 'cadastros.clientes', module: 'cadastros.clientes' },
    { label: 'OS', to: '/os/nova', icon: ClipboardList, permission: 'mecanica.os', module: 'mecanica.os' },
    { label: 'Orçamento', to: '/orcamentos/novo', icon: FileText, permission: 'vendas.orcamentos', module: 'comercial.orcamentos' }
  ].filter(canAccess);

  const isGroupActive = (group: NavGroup) => group.items.some((item) => currentPath.startsWith(item.to));
  const isExpanded = (group: NavGroup) => {
    if (searchTerm.trim()) return true;
    return expandedGroups[group.id] ?? isGroupActive(group);
  };
  const toggleGroup = (group: NavGroup) => {
    const currentlyExpanded = expandedGroups[group.id] ?? isGroupActive(group);
    const nextState = { ...expandedGroups, [group.id]: !currentlyExpanded };
    setExpandedGroups(nextState);
    localStorage.setItem('nexus_sidebar_groups', JSON.stringify(nextState));
  };

  // PDV e' a unica tela fora do sistema de abas (tela cheia, sem menu
  // lateral/barra de abas) -- continua navegacao real. Todo o resto abre
  // ou reaproveita uma aba.
  const navigateTo = (to: string, label?: string) => {
    setActionMenuOpen(false);
    document.body.classList.remove('mobile-sidebar-open');
    if (to === '/pdv') {
      navigate(to);
    } else {
      openTab(to, label);
    }
  };

  const handleLogout = useCallback(() => {
    setIsLoggingOut(true);
    setTimeout(() => logout(), 1500);
  }, [logout]);

  const handleGoHome = () => {
    if (currentPath === '/dashboard') return;
    setIsNavigatingHome(true);
    setTimeout(() => {
      openTab('/dashboard', 'Dashboard');
      setIsNavigatingHome(false);
    }, 700);
  };

  const toggleMiniSidebar = () => {
    const nextValue = !miniSidebar;
    setMiniSidebar(nextValue);
    localStorage.setItem('nexus_mini_sidebar', String(nextValue));
    document.body.classList.toggle('mini-sidebar', nextValue);
  };

  useEffect(() => {
    const onTriggerLogout = () => handleLogout();
    window.addEventListener('trigger-logout', onTriggerLogout);
    return () => window.removeEventListener('trigger-logout', onTriggerLogout);
  }, [handleLogout]);

  useEffect(() => {
    document.body.classList.toggle('mini-sidebar', miniSidebar);
  }, [miniSidebar]);

  // Ctrl/Cmd+K foca a busca do menu -- o atalho ja era anunciado no <kbd>
  // da caixa de busca, entao aqui ele passa a existir de fato. Com o menu
  // recolhido a busca nao esta montada, entao expandimos antes de focar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (miniSidebar) {
        setMiniSidebar(false);
        localStorage.setItem('nexus_mini_sidebar', 'false');
      }
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [miniSidebar]);

  // Menu "Nova acao": fecha com Esc ou clique fora, como qualquer popover.
  useEffect(() => {
    if (!actionMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!actionBlockRef.current?.contains(event.target as Node)) setActionMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [actionMenuOpen]);

  const tenantName = selectedTenant?.nomeOficina || 'Hennder Company';
  const userName = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'Usuário';
  const userInitial = userName.trim().charAt(0).toUpperCase() || 'N';

  return (
    <>
      <div
        className="mobile-sidebar-overlay"
        onClick={() => document.body.classList.remove('mobile-sidebar-open')}
      />

      <aside className="sidebar nexus-sidebar">
        {miniSidebar && (
          <div className="nexus-sidebar-rail">
            <button className="nexus-rail-logo" onClick={handleGoHome} title="Ir para Dashboard">
              <img src={hennderIcon} alt="Hennder ERP" />
            </button>

            <div className="nexus-rail-modules">
              {railShortcuts.map((item) => {
                const Icon = item.icon;
                const active = currentPath === item.to || currentPath.startsWith(`${item.to}/`);
                return (
                  <button
                    key={item.to}
                    className={active ? 'nexus-rail-item active' : 'nexus-rail-item'}
                    onClick={() => navigateTo(item.to, item.label)}
                    title={item.label}
                    aria-pressed={active}
                  >
                    <Icon size={19} />
                  </button>
                );
              })}
            </div>

            <div className="nexus-rail-bottom">
              <button
                className="nexus-rail-item"
                onClick={toggleMiniSidebar}
                title="Expandir menu"
                aria-label="Expandir menu"
              >
                <ChevronsRight size={18} />
              </button>
            </div>
          </div>
        )}

        <div className="nexus-sidebar-pane">
          <div className="nexus-sidebar-header">
            <div className="nexus-brand-row">
              <button
                className="nexus-brand"
                onClick={handleGoHome}
                title="Ir para o Dashboard"
                aria-label="Hennder Company - ir para o Dashboard"
              >
                <img className="nexus-brand-mark is-dark" src={wordmarkDark} alt="" />
                <img className="nexus-brand-mark is-light" src={wordmarkLight} alt="" />
              </button>

              <button
                className="nexus-collapse-btn"
                onClick={toggleMiniSidebar}
                title="Recolher menu"
                aria-label="Recolher menu"
              >
                <ChevronsLeft size={16} />
              </button>
            </div>

            <div className="nexus-sidebar-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar no menu"
                aria-label="Buscar no menu"
              />
              {searchTerm ? (
                <button
                  type="button"
                  className="nexus-search-clear"
                  onClick={() => setSearchTerm('')}
                  title="Limpar busca"
                  aria-label="Limpar busca"
                >
                  <X size={13} />
                </button>
              ) : (
                <kbd>Ctrl K</kbd>
              )}
            </div>

            <div className="nexus-action-block" ref={actionBlockRef}>
              <button
                className="nexus-new-action"
                type="button"
                onClick={() => setActionMenuOpen((open) => !open)}
                aria-expanded={actionMenuOpen}
                aria-haspopup="menu"
              >
                <Plus size={15} aria-hidden="true" />
                Nova ação
                <ChevronDown
                  className={actionMenuOpen ? 'nexus-chevron open' : 'nexus-chevron'}
                  size={14}
                  aria-hidden="true"
                />
              </button>

              {actionMenuOpen && (
                <div className="nexus-new-action-menu" role="menu">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.to}
                        type="button"
                        role="menuitem"
                        onClick={() => navigateTo(action.to, action.label)}
                      >
                        <Icon size={15} aria-hidden="true" />
                        <span>{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <nav className="nexus-sidebar-nav" aria-label="Menu principal">
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
                    title={group.label}
                    aria-expanded={expanded}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="nexus-nav-group-label">{group.label}</span>
                    {group.roadmap && <small>Em breve</small>}
                    <ChevronRight
                      className={expanded ? 'nexus-chevron open' : 'nexus-chevron'}
                      size={14}
                      aria-hidden="true"
                    />
                  </button>

                  <div className={expanded ? 'nexus-nav-items open' : 'nexus-nav-items'}>
                    <div className="nexus-nav-items-inner">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const itemActive = currentPath === item.to || currentPath.startsWith(`${item.to}/`);
                      return (
                        <button
                          key={item.to}
                          type="button"
                          className={itemActive ? 'nexus-nav-link active' : 'nexus-nav-link'}
                          onClick={() => navigateTo(item.to, item.label)}
                          title={item.label}
                          aria-current={itemActive ? 'page' : undefined}
                        >
                          <ItemIcon size={15} aria-hidden="true" />
                          <span>{item.label}</span>
                          {item.badge && <small>{item.badge}</small>}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                </div>
              );
            })}

            {visibleGroups.length === 0 && (
              <div className="nexus-nav-empty">
                <strong>Nenhum item encontrado</strong>
                <span>Revise o termo buscado ou limpe a busca.</span>
              </div>
            )}
          </nav>

          <div className="nexus-sidebar-footer">
            <div className="nexus-user-card">
              <span className="nexus-user-avatar" aria-hidden="true">{userInitial}</span>
              <div className="nexus-user-meta">
                <strong>{userName}</strong>
                <span title={tenantName}>{userRole || 'Operador'} · {tenantName}</span>
              </div>
              <button type="button" onClick={handleLogout} title="Sair do sistema" aria-label="Sair do sistema">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Saida do sistema: mesmo componente do splash de entrada, so com
            outro texto. Alem de dar simetria entrada/saida, resolve de vez a
            borda quadrada em volta da logo -- o overlay antigo usava
            box-shadow num <img>, e box-shadow segue a CAIXA do elemento, nao
            o contorno transparente do SVG, o que desenhava um halo quadrado.
            O BootSplash usa filter: drop-shadow(), que acompanha a arte. */}
        {isLoggingOut && (
          <BootSplash titulo="Até logo!" legenda="ENCERRANDO SESSÃO..." />
        )}

        {isNavigatingHome && (
          <BootSplash titulo="Dashboard" legenda="CARREGANDO..." />
        )}
      </aside>
    </>
  );
};

export default Sidebar;
