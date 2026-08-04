import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useRoutes } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { resolveRouteAccess } from '../../utils/routeAccess';
import { appRoutesConfig } from '../../routes/appRoutesConfig';
import { TabActiveContext, TabIdContext, useTabs, type Tab } from '../../contexts/TabsContext';
import { ErrorBoundary } from '../ErrorBoundary';
import PageLoader from './PageLoader';

/**
 * Conteudo de uma aba. react-router proibe <Router> aninhado (nao da pra
 * dar a cada aba seu proprio MemoryRouter dentro do BrowserRouter externo
 * -- "You cannot render a <Router> inside another <Router>"), entao todas
 * as abas compartilham o MESMO router. O que isola uma aba da outra e
 * que CADA UMA resolve sua rota contra o proprio `tab.path`, nunca
 * contra a URL real do navegador -- inclusive a aba ativa.
 *
 * Isso e o ponto mais delicado do F19, e a fonte de varios bugs ate
 * 2026-08-04. Antes, a aba ativa resolvia contra a URL real
 * (`useRoutes(routes, isActive ? undefined : tab.path)`), o que parecia
 * natural mas quebrava por DOIS motivos independentes:
 *
 * 1. O `useRoutes` so embrulha o resultado num <LocationContext.Provider>
 *    QUANDO recebe um locationArg; sem ele, devolve a arvore crua. Como
 *    a aba alternava entre `undefined` (ativa) e uma string (inativa),
 *    esse wrapper aparecia e sumia do topo da arvore a cada troca de
 *    aba -- o React via outro tipo de elemento naquela posicao e
 *    desmontava/remontava a tela inteira.
 *
 * 2. Pior: o <BrowserRouter> do react-router v7 aplica TODA mudanca de
 *    URL dentro de um React.startTransition (ver o fonte de
 *    BrowserRouter). Transicoes tem prioridade baixa, entao o React
 *    renderiza primeiro a mudanca urgente (qual aba esta ativa) e so
 *    depois a URL nova. Ou seja, no render em que uma aba vira ativa a
 *    URL real AINDA E A DA ABA ANTERIOR -- e a aba recem-ativada
 *    renderizava a tela da outra aba, destruindo a sua propria. Nao da
 *    pra consertar isso sincronizando melhor (navegar junto do clique
 *    nao adianta: o startTransition separa as duas renderizacoes de
 *    qualquer jeito) -- foi medido ao vivo, com log de ciclo de vida.
 *
 * Resolvendo os dois de uma vez: `tab.path` e sempre a verdade pra
 * renderizar, e a URL real vira so um espelho (pra barra de endereco,
 * F5 e deep-link). Com isso o locationArg nunca deixa de existir nem
 * muda ao trocar de aba, o React so re-renderiza, e o estado local dos
 * formularios sobrevive.
 *
 * O efeito abaixo mantem os dois lados em dia nas duas direcoes, usando
 * `syncedRef` pra desempatar QUEM manda quando eles divergem -- porque
 * "URL != tab.path" tem duas causas opostas: ou a aba acabou de virar
 * ativa (a URL esta atrasada, tab.path manda), ou a propria tela chamou
 * navigate() (a URL e a novidade, ela manda).
 */
const TabPaneContent: React.FC<{ tab: Tab; isActive: boolean }> = ({ tab, isActive }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const element = useRoutes(appRoutesConfig, tab.path);
  const { updateTabLocation } = useTabs();
  const { blockedModules, userRole, userPermissions, isOwner, isPlatformAdmin } = useAuth();

  // Inclui a query string: telas de impressao em lote passam ?ids=...
  const currentPath = `${location.pathname}${location.search}`;
  const syncedRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      // Aba em segundo plano nao mexe na URL nem se deixa influenciar
      // por ela (a URL agora pertence a outra aba).
      syncedRef.current = false;
      return;
    }
    if (currentPath === tab.path) {
      syncedRef.current = true;
      return;
    }
    if (syncedRef.current) {
      // Ja estavamos em dia e a URL mudou: foi a propria tela navegando
      // (ex: salvou e seguiu pra outra rota) -- espelha pro tab.path.
      updateTabLocation(tab.id, currentPath);
    } else {
      // Ainda nao estavamos em dia: esta aba acabou de virar ativa e a
      // URL e a que a aba anterior deixou. Puxa a URL pra ca.
      navigate(tab.path, { replace: true });
    }
  }, [isActive, currentPath, tab.path, tab.id, navigate, updateTabLocation]);

  const effectivePath = tab.path;
  const { routeModule, routePermission } = resolveRouteAccess(effectivePath);
  const isModuleBlocked = routeModule && !isPlatformAdmin && blockedModules?.includes(routeModule);
  const hasFullAccess = hasTenantFullAccess(userRole, isOwner);
  const isRouteAllowed = !routePermission || hasFullAccess || userPermissions?.includes(routePermission);

  // O CSS reinicia a animacao de fade-in do .page-transition toda vez
  // que o display volta de "none" pra "contents" -- ou seja, toda vez
  // que o usuario troca de volta pra essa aba, nao so no primeiro
  // carregamento. Isso pisca a tela inteira a cada troca de aba. Depois
  // do fade-in de entrada tocar uma vez (400ms de folga), a classe
  // "settled" zera a animacao, entao trocas de aba seguintes nao
  // reiniciam mais nada.
  const [hasSettled, setHasSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHasSettled(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <TabIdContext.Provider value={tab.id}>
      <TabActiveContext.Provider value={isActive}>
        <main className="page-content">
          <div className={hasSettled ? 'page-transition page-transition--settled' : 'page-transition'}>
            {isModuleBlocked || !isRouteAllowed ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px', color: 'var(--text-primary)', textAlign: 'center', padding: '24px' }}>
                <div style={{ padding: '16px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '50%', color: '#ef4444' }}>
                  <ShieldAlert size={48} />
                </div>
                <h2 style={{ fontSize: '22px', fontWeight: 700, margin: '8px 0 4px 0' }}>
                  {isModuleBlocked ? 'Módulo Não Disponível' : 'Acesso não permitido'}
                </h2>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '460px', fontSize: '15px', lineHeight: '1.6', margin: 0 }}>
                  {isModuleBlocked
                    ? 'Este módulo está desativado para a sua conta. Caso precise utilizá-lo, entre em contato com o suporte ou o administrador do sistema para atualizar o seu plano.'
                    : 'Seu usuário não possui permissão para acessar esta área. Peça ao administrador para revisar seus acessos.'}
                </p>
              </div>
            ) : element}
          </div>
        </main>
      </TabActiveContext.Provider>
    </TabIdContext.Provider>
  );
};

/**
 * Uma aba, sempre montada enquanto a aba existir (fechar de verdade
 * desmonta e limpa as escutas do Firestore daquela tela; trocar de aba
 * so esconde via CSS). Sistema de Abas (F19), fase B -- todas as abas
 * compartilham o unico Router do App (ver TabPaneContent acima).
 *
 * React.memo: ao trocar de aba, so as DUAS abas envolvidas (a que sai e
 * a que entra) realmente mudam de prop (isActive); sem isso, toda troca
 * forcava TODAS as abas abertas a re-renderizar (o React sempre invoca
 * de novo os filhos de um componente que re-renderizou, mesmo que as
 * props deles nao tenham mudado), custando mais desempenho quanto mais
 * abas o usuario tiver aberto ao mesmo tempo. Validado com
 * PerformanceObserver (commit 09a6b2e); perdido sem querer no revert do
 * "justActivated" (a4f355e), que reescreveu o arquivo inteiro pro estado
 * anterior a essa otimizacao -- reposto aqui sozinho, sem a logica que
 * causou o loop. NAO trocar `display:none` por `visibility:hidden` +
 * `position:absolute` pra tentar consertar o "flash 0x0" do Recharts:
 * ja tentado nesta sessao (2026-08-03) e causa um loop CONTINUO de
 * mount/desmontagem do Dashboard, pior que o problema original -- ver
 * plano de evolucao, secao F19, pra detalhes do diagnostico.
 */
const TabPane: React.FC<{ tab: Tab; isActive: boolean }> = React.memo(({ tab, isActive }) => (
  <div style={{ display: isActive ? 'contents' : 'none' }}>
    {/* ErrorBoundary proprio por aba: uma tela quebrando em segundo plano
        nao pode derrubar as outras abas -- so o ErrorBoundary de App.tsx
        nao bastava, porque todas as abas ficam sempre montadas juntas. */}
    <ErrorBoundary>
      {/* Suspense proprio por aba: uma aba nova carregando sua tela lazy
          nao pode "piscar" o conteudo das outras abas ja carregadas, que
          compartilhariam o mesmo boundary se ele fosse so o de App.tsx. */}
      <Suspense fallback={<PageLoader />}>
        <TabPaneContent tab={tab} isActive={isActive} />
      </Suspense>
    </ErrorBoundary>
  </div>
));

/** Renderiza uma TabPane por aba aberta -- todas ficam montadas o tempo todo. */
export const TabPanesArea: React.FC = () => {
  const { tabs, activeTabId } = useTabs();
  return (
    <>
      {tabs.map((tab) => (
        <TabPane key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
      ))}
    </>
  );
};

export default TabPane;
