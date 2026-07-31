import React, { Suspense, useEffect } from 'react';
import { MemoryRouter, useLocation, useRoutes } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { hasTenantFullAccess } from '../../utils/roles';
import { resolveRouteAccess } from '../../utils/routeAccess';
import { appRoutesConfig } from '../../routes/appRoutesConfig';
import { TabActiveContext, useTabs, type Tab } from '../../contexts/TabsContext';
import PageLoader from './PageLoader';

/**
 * Conteudo de uma aba: resolve as rotas (useRoutes) e o bloqueio por
 * modulo/permissao a partir da localizacao INTERNA do MemoryRouter da
 * aba -- nao da URL real do navegador, que so espelha a aba ativa (ver
 * TabPane mais abaixo).
 */
const TabPaneContent: React.FC<{ tab: Tab; isActive: boolean }> = ({ tab, isActive }) => {
  const location = useLocation();
  const element = useRoutes(appRoutesConfig);
  const { updateTabLocation } = useTabs();
  const { blockedModules, userRole, userPermissions, isOwner, isPlatformAdmin } = useAuth();

  useEffect(() => {
    updateTabLocation(tab.id, location.pathname);
  }, [location.pathname, tab.id, updateTabLocation]);

  // So a aba ativa espelha sua localizacao interna pra URL real do
  // navegador (leitura -> escrita, nunca o contrario) -- mantem F5 e
  // deep-link coerentes sem fazer as abas em segundo plano brigarem
  // pela barra de enderecos.
  useEffect(() => {
    if (!isActive) return;
    const target = `${location.pathname}${location.search}${location.hash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [isActive, location]);

  const { routeModule, routePermission } = resolveRouteAccess(location.pathname);
  const isModuleBlocked = routeModule && !isPlatformAdmin && blockedModules?.includes(routeModule);
  const hasFullAccess = hasTenantFullAccess(userRole, isOwner);
  const isRouteAllowed = !routePermission || hasFullAccess || userPermissions?.includes(routePermission);

  return (
    <TabActiveContext.Provider value={isActive}>
      <main className="page-content">
        <div className="page-transition">
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
 * Uma aba = um MemoryRouter proprio, sempre montado enquanto a aba
 * existir (fechar de verdade desmonta e limpa as escutas do Firestore
 * daquela tela; trocar de aba so esconde via CSS). Sistema de Abas
 * (F19), fase B.
 */
const TabPane: React.FC<{ tab: Tab; isActive: boolean }> = ({ tab, isActive }) => (
  <div style={{ display: isActive ? 'contents' : 'none' }}>
    <MemoryRouter initialEntries={[tab.path]}>
      {/* Suspense proprio por aba: uma aba nova carregando sua tela lazy
          nao pode "piscar" o conteudo das outras abas ja carregadas, que
          compartilhariam o mesmo boundary se ele fosse so o de App.tsx. */}
      <Suspense fallback={<PageLoader />}>
        <TabPaneContent tab={tab} isActive={isActive} />
      </Suspense>
    </MemoryRouter>
  </div>
);

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
