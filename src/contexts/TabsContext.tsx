import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export interface Tab {
  /** Igual ao path completo -- garante uma aba por registro aberto (ex: /clientes/editar/A != /clientes/editar/B). */
  id: string;
  path: string;
  label: string;
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  closeTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const STORAGE_KEY = 'nexus_tabs_v1';
const MAX_TABS = 8;
const DEFAULT_TAB: Tab = { id: '/dashboard', path: '/dashboard', label: 'Dashboard' };

/**
 * Tabela de prefixo -> rotulo (mais especifico primeiro). Sub-rotas de
 * criacao/edicao herdam o rotulo da secao pai com um prefixo generico --
 * titulo especifico por registro (ex: nome do cliente) fica pra uma fase
 * futura, quando a propria pagina puder reportar um titulo melhor.
 */
const SECTION_LABELS: Array<[string, string]> = [
  ['/dashboard', 'Dashboard'],
  ['/clientes', 'Clientes'],
  ['/veiculos', 'Veículos'],
  ['/estoque', 'Estoque / Produtos'],
  ['/servicos', 'Serviços'],
  ['/categorias', 'Categorias'],
  ['/unidades-medida', 'Unidades de Medida'],
  ['/bandeiras-cartao', 'Bandeiras de Cartão'],
  ['/bancos', 'Bancos'],
  ['/usuarios', 'Usuários'],
  ['/pedidos-venda', 'Pedidos de Venda'],
  ['/orcamentos', 'Orçamentos'],
  ['/vendas/devolucoes', 'Devolução de Venda'],
  ['/relatorios-vendas', 'Relatório de Vendas'],
  ['/os', 'Ordens de Serviço'],
  ['/crm/agenda', 'Agendamentos'],
  ['/crm/lembretes', 'Alertas de Retorno'],
  ['/relatorios-mecanica', 'Relatório de Serviços'],
  ['/financeiro/caixa', 'Fluxo de Caixa'],
  ['/financeiro/banco', 'Banco'],
  ['/financeiro/contas-receber', 'Contas a Receber'],
  ['/financeiro/contas-pagar', 'Contas a Pagar'],
  ['/financeiro/faturamento', 'Faturamento'],
  ['/financeiro/comissoes', 'Comissões'],
  ['/fiscal/nfe', 'Emitir Nota Fiscal'],
  ['/fiscal/entrada-nfe', 'Entrada de XML'],
  ['/relatorios-diversos', 'Relatórios Diversos'],
  ['/logs-sistema', 'Logs do Sistema'],
  ['/configuracoes', 'Configurações'],
];

const humanizeSegment = (segment: string) => (
  segment
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
);

const resolveTabLabel = (pathname: string): string => {
  const match = SECTION_LABELS
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b[0].length - a[0].length)[0];

  if (!match) {
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    return lastSegment ? humanizeSegment(lastSegment) : 'Início';
  }

  const [prefix, sectionLabel] = match;
  const rest = pathname.slice(prefix.length).split('/').filter(Boolean);
  if (rest.length === 0) return sectionLabel;

  const action = rest[0];
  if (action === 'novo' || action === 'nova') return `Novo(a) ${sectionLabel}`;
  if (action === 'editar') return `Editar ${sectionLabel}`;
  if (action === 'visualizar') return `Ver ${sectionLabel}`;
  return sectionLabel;
};

const loadStoredTabs = (): { tabs: Tab[]; activeTabId: string } | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const TabsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const [tabs, setTabs] = useState<Tab[]>(() => loadStoredTabs()?.tabs ?? [DEFAULT_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>(() => loadStoredTabs()?.activeTabId ?? DEFAULT_TAB.id);

  // Garante uma aba pra localizacao atual sempre que a URL muda -- por
  // qualquer motivo (clique no menu, redirecionamento apos salvar, F5,
  // digitar a URL direto). Nao precisa instrumentar cada navigate() do app.
  useEffect(() => {
    const pathname = location.pathname;
    setTabs((current) => {
      if (current.some((tab) => tab.id === pathname)) return current;
      if (current.length >= MAX_TABS) return current;
      return [...current, { id: pathname, path: pathname, label: resolveTabLabel(pathname) }];
    });
    setActiveTabId(pathname);
  }, [location.pathname]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  }, [tabs, activeTabId]);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      if (current.length <= 1) return current;
      const closingIndex = current.findIndex((tab) => tab.id === id);
      if (closingIndex === -1) return current;
      const next = current.filter((tab) => tab.id !== id);

      if (id === activeTabId) {
        const fallback = next[closingIndex - 1] || next[0] || DEFAULT_TAB;
        navigate(fallback.path);
      }

      return next.length > 0 ? next : [DEFAULT_TAB];
    });
  }, [activeTabId, navigate]);

  const value = useMemo(() => ({ tabs, activeTabId, closeTab }), [tabs, activeTabId, closeTab]);

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
};

export const useTabs = (): TabsContextValue => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs deve ser usado dentro de TabsProvider');
  return ctx;
};

export const MAX_TABS_LIMIT = MAX_TABS;
