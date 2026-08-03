import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export interface Tab {
  /** Identificador estavel da aba (nao muda mesmo que o usuario navegue
   * internamente pra outro path dentro da mesma aba). */
  id: string;
  /** Path atual exibido nesta aba -- pode "andar" com a navegacao interna
   * (ex: da lista de Clientes pra Editar Cliente, na mesma aba). */
  path: string;
  label: string;
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  /** Reaproveita a aba que ja estiver mostrando esse path; senao cria uma nova e ativa. */
  openTab: (path: string, label?: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  reorderTab: (draggedId: string, targetId: string) => void;
  /** Chamado pelo TabPane quando a navegacao interna daquela aba muda de path. */
  updateTabLocation: (id: string, path: string, label?: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

/** Sinaliza se o conteudo atual esta dentro da aba ativa -- usado por
 * useKeyboardShortcuts/useEscapeLayer pra nao reagir em abas escondidas
 * (elas continuam montadas, so nao visiveis). Default true fora do
 * sistema de abas (ex: PDV, que nao usa TabsProvider). */
export const TabActiveContext = createContext(true);

const STORAGE_KEY = 'nexus_tabs_v1';
const MAX_TABS = 8;

let tabIdCounter = 0;
const makeTabId = () => `tab-${Date.now()}-${tabIdCounter++}`;

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
  ['/fornecedores', 'Fornecedores'],
  ['/materias-primas', 'Matéria-Prima'],
  ['/producao/ordens', 'Ordens de Produção'],
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

export const resolveTabLabel = (pathname: string): string => {
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

const initialTabsState = (): { tabs: Tab[]; activeTabId: string } => {
  const stored = loadStoredTabs();
  if (stored && stored.tabs.some((tab) => tab.id === stored.activeTabId)) return stored;

  // Primeiro acesso (ou storage invalido): honra a URL real que o
  // navegador tinha no momento do carregamento (ex: F5 numa tela
  // especifica), em vez de sempre resetar pro Dashboard.
  const initialPath = window.location.pathname && window.location.pathname !== '/'
    ? window.location.pathname
    : '/dashboard';
  const tab: Tab = { id: makeTabId(), path: initialPath, label: resolveTabLabel(initialPath) };
  return { tabs: [tab], activeTabId: tab.id };
};

interface TabsState {
  tabs: Tab[];
  activeTabId: string;
}

export const TabsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // tabs + activeTabId vivem num unico useState (em vez de dois separados)
  // porque o calculo inicial (initialTabsState) pode CRIAR uma aba nova --
  // precisam nascer consistentes um com o outro. O inicializador passado
  // pro useState so roda uma vez, no mount, garantido pelo proprio React.
  const [state, setState] = useState<TabsState>(initialTabsState);
  const { tabs, activeTabId } = state;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const openTab = useCallback((path: string, label?: string) => {
    setState((current) => {
      const existing = current.tabs.find((tab) => tab.path === path);
      if (existing) {
        return existing.id === current.activeTabId ? current : { ...current, activeTabId: existing.id };
      }
      if (current.tabs.length >= MAX_TABS) return current;

      const newTab: Tab = { id: makeTabId(), path, label: label || resolveTabLabel(path) };
      return { tabs: [...current.tabs, newTab], activeTabId: newTab.id };
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    setState((current) => (current.activeTabId === id ? current : { ...current, activeTabId: id }));
  }, []);

  const updateTabLocation = useCallback((id: string, path: string, label?: string) => {
    setState((current) => {
      const target = current.tabs.find((tab) => tab.id === id);
      if (!target || target.path === path) return current;
      return {
        ...current,
        tabs: current.tabs.map((tab) => (
          tab.id === id ? { ...tab, path, label: label || resolveTabLabel(path) } : tab
        )),
      };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((current) => {
      if (current.tabs.length <= 1) return current;
      const closingIndex = current.tabs.findIndex((tab) => tab.id === id);
      if (closingIndex === -1) return current;
      const nextTabs = current.tabs.filter((tab) => tab.id !== id);

      const nextActiveTabId = id === current.activeTabId
        ? (nextTabs[closingIndex - 1] || nextTabs[0]).id
        : current.activeTabId;

      return { tabs: nextTabs, activeTabId: nextActiveTabId };
    });
  }, []);

  const reorderTab = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setState((current) => {
      const draggedIndex = current.tabs.findIndex((tab) => tab.id === draggedId);
      const targetIndex = current.tabs.findIndex((tab) => tab.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return current;

      const nextTabs = [...current.tabs];
      const [draggedTab] = nextTabs.splice(draggedIndex, 1);
      nextTabs.splice(targetIndex, 0, draggedTab);
      return { ...current, tabs: nextTabs };
    });
  }, []);

  const value = useMemo(
    () => ({ tabs, activeTabId, openTab, activateTab, closeTab, reorderTab, updateTabLocation }),
    [tabs, activeTabId, openTab, activateTab, closeTab, reorderTab, updateTabLocation],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
};

export const useTabs = (): TabsContextValue => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs deve ser usado dentro de TabsProvider');
  return ctx;
};

export const MAX_TABS_LIMIT = MAX_TABS;
