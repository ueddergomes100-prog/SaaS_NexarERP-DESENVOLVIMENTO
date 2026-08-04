import React, { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate, useRoutes } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { resolveRouteAccess } from '../../utils/routeAccess';
import { appRoutesConfig } from '../../routes/appRoutesConfig';
import { TabActiveContext, useTabs, type Tab } from '../../contexts/TabsContext';
import { ErrorBoundary } from '../ErrorBoundary';
import PageLoader from './PageLoader';

/**
 * Conteudo de uma aba. react-router proibe <Router> aninhado (nao da pra
 * dar a cada aba seu proprio MemoryRouter dentro do BrowserRouter externo
 * -- "You cannot render a <Router> inside another <Router>"), entao todas
 * as abas compartilham o MESMO router; o que muda por aba e qual location
 * usamos pra resolver a rota:
 * - aba ativa: resolve contra a location REAL do navegador (useLocation),
 *   entao navigate()/Link dentro da tela funcionam normalmente; um efeito
 *   espelha a location real de volta pro tab.path (persistencia).
 * - aba em segundo plano: resolve contra o ultimo tab.path conhecido
 *   (congelado), sem depender da location real, que pertence a aba ativa.
 * Ao trocar de aba ativa, um efeito empurra tab.path pra location real via
 * navigate(..., {replace:true}), pra aba recem-ativada assumir o timao.
 *
 * CUIDADO -- a aba ativa passa `location` (o objeto real do useLocation)
 * em vez de `undefined`, e isso NAO e redundante: o useRoutes do
 * react-router embrulha o resultado num <LocationContext.Provider>
 * QUANDO (e so quando) recebe um locationArg; sem locationArg ele
 * devolve a arvore crua. Passar `undefined` pra aba ativa e uma string
 * pras inativas fazia esse wrapper aparecer/sumir do topo da arvore a
 * cada troca de aba -- o React via um tipo de elemento diferente naquela
 * posicao e DESMONTAVA/REMONTAVA a tela inteira. Era a causa raiz de
 * tres sintomas ao mesmo tempo: texto digitado sumindo ao trocar de aba
 * (estado local destruido), ~300ms de travada por troca (pagina inteira
 * reconstruida) e o ResponsiveContainer do Recharts remedindo do zero.
 * Passando sempre um locationArg, a forma da arvore nunca muda e o React
 * so re-renderiza, preservando o estado. Semanticamente identico: sem
 * locationArg o proprio react-router usa a location do contexto, que e
 * exatamente o que passamos aqui.
 */
const TabPaneContent: React.FC<{ tab: Tab; isActive: boolean }> = ({ tab, isActive }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const element = useRoutes(appRoutesConfig, isActive ? location : tab.path);
  const { updateTabLocation } = useTabs();
  const { blockedModules, userRole, userPermissions, isOwner, isPlatformAdmin } = useAuth();

  // Ao virar a aba ativa (troca de aba, ou primeiro mount ja ativa),
  // assume a location real do navegador -- so essa aba deve mexer nela.
  useEffect(() => {
    if (!isActive) return;
    if (location.pathname === tab.path) return;
    navigate(tab.path, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // So a aba ativa espelha sua location real de volta pro tab.path
  // (leitura -> escrita, nunca o contrario) -- mantem F5 e deep-link
  // coerentes sem fazer as abas em segundo plano brigarem pela URL.
  useEffect(() => {
    if (!isActive) return;
    updateTabLocation(tab.id, location.pathname);
  }, [isActive, location.pathname, tab.id, updateTabLocation]);

  const effectivePath = isActive ? location.pathname : tab.path;
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
