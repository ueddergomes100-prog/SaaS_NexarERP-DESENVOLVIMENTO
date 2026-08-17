import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { showError, confirmUnsavedChanges, warnBlockedTabClose } from '../utils/alerts';

export interface Tab {
  /** Identificador estavel da aba (nao muda mesmo que o usuario navegue
   * internamente pra outro path dentro da mesma aba). */
  id: string;
  /** Path atual exibido nesta aba -- pode "andar" com a navegacao interna
   * (ex: da lista de Clientes pra Editar Cliente, na mesma aba). */
  path: string;
  label: string;
  /** Id da aba de onde esta foi aberta, quando aberta de dentro de outra
   * aba (nao do menu lateral/superior) -- ver useTabs() abaixo, que injeta
   * isso automaticamente via TabIdContext. Usado por requestCloseTab pra
   * bloquear o fechamento da aba-pai enquanto a aba-filha ainda existir. */
  parentTabId?: string;
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string;
  /** Reaproveita a aba que ja estiver mostrando esse path; senao cria uma
   * nova e ativa. Pros modulos single-session (ver singleSessionPrefixFor),
   * reaproveita qualquer aba do mesmo modulo, nao so path identico. */
  openTab: (path: string, label?: string, parentTabId?: string) => Promise<void>;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Fecha a aba direto se ela nao tiver dados nao salvos registrados
   * (ver setTabDirty); senao pergunta salvar/descartar/cancelar antes.
   * E o que a TabBar chama ao clicar no X -- closeTab continua existindo
   * pra fechamentos que nao devem passar por essa checagem (ex: depois
   * que o proprio onSaveRequest ja confirmou o salvamento). */
  requestCloseTab: (id: string) => Promise<void>;
  /** Registra (ou limpa, com isDirty=false) se a aba tem dados digitados
   * ainda nao salvos, e o callback que salva-los caso o usuario escolha
   * "Salvar e fechar" na hora de fechar essa aba. Chamado pelo hook
   * useUnsavedChangesGuard, nao diretamente pelas telas. */
  setTabDirty: (tabId: string, isDirty: boolean, onSaveRequest?: () => Promise<boolean>) => void;
  reorderTab: (draggedId: string, targetId: string) => void;
  /** Chamado pelo TabPane quando a navegacao interna daquela aba muda de path. */
  updateTabLocation: (id: string, path: string, label?: string) => void;
}

/** Exportado (alem do hook useTabs) so pra useUnsavedChangesGuard poder
 * ler com useContext direto e virar no-op fora do TabsProvider, em vez
 * de lancar erro (useTabs lanca de proposito nos outros usos, pra pegar
 * bug de tela usada fora do lugar certo cedo). */
export const TabsContext = createContext<TabsContextValue | null>(null);

/** Sinaliza se o conteudo atual esta dentro da aba ativa -- usado por
 * useKeyboardShortcuts/useEscapeLayer pra nao reagir em abas escondidas
 * (elas continuam montadas, so nao visiveis). Default true fora do
 * sistema de abas (ex: PDV, que nao usa TabsProvider). */
export const TabActiveContext = createContext(true);

/** Id da aba que esta renderizando o componente atual -- usado por
 * useUnsavedChangesGuard pra saber em qual aba registrar "tenho dados
 * nao salvos". null fora do sistema de abas (ex: PDV). */
export const TabIdContext = createContext<string | null>(null);

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
  ['/producao/relatorios', 'Relatório de Produção'],
  ['/usuarios', 'Usuários'],
  ['/pedidos-venda', 'Pedidos de Venda'],
  ['/orcamentos', 'Orçamentos'],
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
  ['/fiscal/nfe', 'Notas Fiscais'],
  ['/fiscal/entrada-nfe', 'Entrada de XML'],
  ['/utilitarios/sintegra', 'SINTEGRA'],
  ['/relatorios-diversos', 'Relatórios Diversos'],
  ['/logs-sistema', 'Logs do Sistema'],
  ['/configuracoes', 'Configurações'],
];

/**
 * Modulos que so podem ter UMA aba aberta por vez (pedido explicito do
 * usuario, 2026-08-04, depois de ver duas abas "Matéria-Prima" iguais
 * na barra -- editar um registro diferente do mesmo modulo reaproveita
 * a aba existente em vez de abrir outra). Deliberadamente restrito a
 * esses dois modulos, nao o sistema inteiro -- os demais mantem "uma
 * aba por registro" (decisao original do F19).
 */
const SINGLE_SESSION_PREFIXES = ['/materias-primas', '/producao/ordens'];

/** Prefixo de modulo single-session que `pathname` pertence, ou null. */
export const singleSessionPrefixFor = (pathname: string): string | null => (
  SINGLE_SESSION_PREFIXES.find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) || null
);

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
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Espelha `tabs` num ref pra openTab poder ler o valor mais recente sem
  // precisar depender de `[tabs]` -- isso manteria a identidade da funcao
  // mudando a cada abertura/fechamento de aba, o que poderia disparar
  // efeitos desnecessarios em qualquer lugar que a use como dependencia.
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Ref, nao state -- registrar/desregistrar "aba suja" acontece a cada
  // tecla digitada em algum formulario; se isso fosse state, cada tecla
  // re-renderizaria toda a arvore que consome TabsContext.
  const dirtyTabsRef = useRef(new Map<string, () => Promise<boolean>>());

  const openTab = useCallback(async (path: string, label?: string, parentTabId?: string) => {
    const modulePrefix = singleSessionPrefixFor(path);
    if (modulePrefix) {
      const existingSameModule = tabsRef.current.find((tab) => singleSessionPrefixFor(tab.path) === modulePrefix);
      if (existingSameModule) {
        if (existingSameModule.path === path) {
          setState((current) => (current.activeTabId === existingSameModule.id ? current : { ...current, activeTabId: existingSameModule.id }));
          return;
        }

        // Reaproveita a aba existente do modulo em vez de abrir uma nova
        // (pedido do usuario, 2026-08-04) -- se ela tiver dado nao salvo,
        // pergunta antes de trocar o conteudo, mesmo fluxo do X de fechar.
        const onSaveRequest = dirtyTabsRef.current.get(existingSameModule.id);
        if (onSaveRequest) {
          const choice = await confirmUnsavedChanges();
          if (choice === 'cancel') return;
          if (choice === 'save') {
            const saved = await onSaveRequest();
            if (!saved) return;
          }
        }
        dirtyTabsRef.current.delete(existingSameModule.id);

        // Navega a URL real junto -- se essa aba ja for a ativa, o efeito
        // de sincronizacao do TabPane so reage a MUDANCA de isActive, nao
        // a troca externa de tab.path; sem isso a URL ficaria atrasada.
        // Se a aba ainda nao for a ativa, isso e inocuo (a URL some da
        // tela ate a aba ativar, no mesmo lote de render).
        navigate(path, { replace: true });
        setState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => (
            tab.id === existingSameModule.id ? { ...tab, path, label: label || resolveTabLabel(path) } : tab
          )),
          activeTabId: existingSameModule.id,
        }));
        return;
      }
      // Nenhuma aba desse modulo ainda -- cai pro fluxo normal abaixo.
    }

    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (!existing && tabsRef.current.length >= MAX_TABS) {
      // Antes, esse aviso so aparecia se o usuario clicasse no botao "+"
      // (que tinha sua propria checagem duplicada) -- todo outro jeito de
      // abrir uma tela (menu lateral, "Editar"/"Novo" de qualquer lista)
      // so fazia um no-op silencioso aqui, parecendo que o sistema travou.
      showError('Limite de abas atingido', `Você pode manter no máximo ${MAX_TABS} abas abertas ao mesmo tempo. Feche alguma antes de abrir outra.`);
      return;
    }

    setState((current) => {
      const found = current.tabs.find((tab) => tab.path === path);
      if (found) {
        return found.id === current.activeTabId ? current : { ...current, activeTabId: found.id };
      }
      if (current.tabs.length >= MAX_TABS) return current;

      const newTab: Tab = { id: makeTabId(), path, label: label || resolveTabLabel(path), parentTabId };
      return { tabs: [...current.tabs, newTab], activeTabId: newTab.id };
    });
  }, [navigate]);

  const activateTab = useCallback((id: string) => {
    setState((current) => (current.activeTabId === id ? current : { ...current, activeTabId: id }));
  }, []);

  const updateTabLocation = useCallback((id: string, path: string, label?: string) => {
    setState((current) => {
      const target = current.tabs.find((tab) => tab.id === id);
      if (!target || target.path === path) return current;

      // Navegacao interna (ex: botao "Voltar" de um formulario) pousou
      // exatamente no path da propria aba-pai -- em vez de virar uma
      // segunda aba mostrando a mesma lista que ja esta aberta, fecha
      // esta e reativa a aba-pai original. So nao faz isso se esta aba
      // tiver, ela mesma, uma aba-filha aberta (senao violaria a trava de
      // fechamento com filhas pendentes).
      if (target.parentTabId) {
        const parent = current.tabs.find((tab) => tab.id === target.parentTabId);
        const hasOwnChildren = current.tabs.some((tab) => tab.parentTabId === id);
        if (parent && parent.path === path && !hasOwnChildren) {
          dirtyTabsRef.current.delete(id);
          return { tabs: current.tabs.filter((tab) => tab.id !== id), activeTabId: parent.id };
        }
      }

      let nextTabs = current.tabs.map((tab) => (
        tab.id === id ? { ...tab, path, label: label || resolveTabLabel(path) } : tab
      ));

      // Se a navegacao interna da propria aba (ex: botao "Voltar" de um
      // formulario) fez ela "pousar" no territorio de um modulo
      // single-session que JA tem outra aba aberta, fecha a outra --
      // nao da pra ter duas abas de Matéria-Prima/Ordens de Produção ao
      // mesmo tempo. A aba que esta navegando (`id`) sempre vence porque
      // e a que o usuario esta olhando agora.
      const modulePrefix = singleSessionPrefixFor(path);
      if (modulePrefix) {
        nextTabs
          .filter((tab) => tab.id !== id && singleSessionPrefixFor(tab.path) === modulePrefix)
          .forEach((tab) => dirtyTabsRef.current.delete(tab.id));
        nextTabs = nextTabs.filter((tab) => tab.id === id || singleSessionPrefixFor(tab.path) !== modulePrefix);
      }

      return { ...current, tabs: nextTabs };
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    // Limpa o registro de "aba suja" aqui tambem, nao so no cleanup do
    // useUnsavedChangesGuard -- evita entrada fantasma se o componente
    // que registrou nao chegar a desmontar antes de outra checagem (ex:
    // fechamentos em sequencia rapida).
    dirtyTabsRef.current.delete(id);
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

  const setTabDirty = useCallback((tabId: string, isDirty: boolean, onSaveRequest?: () => Promise<boolean>) => {
    if (isDirty && onSaveRequest) {
      dirtyTabsRef.current.set(tabId, onSaveRequest);
    } else {
      dirtyTabsRef.current.delete(tabId);
    }
  }, []);

  const requestCloseTab = useCallback(async (id: string) => {
    const openChildren = tabsRef.current.filter((tab) => tab.parentTabId === id);
    if (openChildren.length > 0) {
      await warnBlockedTabClose(openChildren.map((tab) => tab.label));
      return;
    }

    const onSaveRequest = dirtyTabsRef.current.get(id);
    if (!onSaveRequest) {
      closeTab(id);
      return;
    }

    const choice = await confirmUnsavedChanges();
    if (choice === 'cancel') return;
    if (choice === 'discard') {
      closeTab(id);
      return;
    }

    // choice === 'save' -- so fecha se o proprio formulario confirmar
    // que salvou com sucesso (ele mesmo ja mostra o erro se falhar).
    const saved = await onSaveRequest();
    if (saved) closeTab(id);
  }, [closeTab]);

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
    () => ({ tabs, activeTabId, openTab, activateTab, closeTab, requestCloseTab, setTabDirty, reorderTab, updateTabLocation }),
    [tabs, activeTabId, openTab, activateTab, closeTab, requestCloseTab, setTabDirty, reorderTab, updateTabLocation],
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
};

export const useTabs = (): TabsContextValue => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs deve ser usado dentro de TabsProvider');

  // Injeta o id da aba atual como parentTabId automaticamente, lendo
  // TabIdContext no ponto de chamada -- so existe dentro do conteudo de
  // uma TabPane (ver TabPane.tsx), entao chamadas vindas da Sidebar/TopBar
  // (fora do sistema de abas) continuam sem parentTabId. Isso evita ter
  // que editar cada um dos ~25 call sites de openTab() espalhados pelas
  // telas de lista so pra registrar a hierarquia pai/filho.
  const currentTabId = useContext(TabIdContext);
  const openTab = useCallback(
    (path: string, label?: string) => ctx.openTab(path, label, currentTabId ?? undefined),
    [ctx.openTab, currentTabId],
  );

  return useMemo(() => ({ ...ctx, openTab }), [ctx, openTab]);
};

export const MAX_TABS_LIMIT = MAX_TABS;
