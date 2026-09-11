import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import PlatformAdminRoute from './components/layout/PlatformAdminRoute';
import PlatformAdminLayout from './components/layout/PlatformAdminLayout';
import AppLayout from './components/layout/AppLayout';
import PageLoader from './components/layout/PageLoader';

// PDV, painel da plataforma e as rotas publicas ficam fora do sistema de
// abas (Sistema de Abas, F19) -- continuam com import direto aqui. Todo o
// resto do "miolo" do app vive em src/routes/appRoutesConfig.tsx, montado
// uma vez por aba.
const AuthPage = lazy(() => import('./pages/Auth/AuthPage'));
const PDV = lazy(() => import('./pages/PDV/PDV'));
const SuperAdmin = lazy(() => import('./pages/Admin/SuperAdmin'));
const SuperAdminBackup = lazy(() => import('./pages/Admin/SuperAdminBackup'));
// App do vendedor externo (mobile): shell + login proprios, sem Sidebar/
// TopBar nem Sistema de Abas -- mesmo motivo do PDV acima. O login fica
// PUBLICO (fora de ProtectedRoute, que redireciona pro /login normal) e o
// shell faz sua PROPRIA checagem de sessao + acessoAppMobile (ver
// VendedorShell.tsx), porque o vendedor de balcao loga com codigo+PIN, nao
// com o fluxo padrao do sistema.
const VendedorLoginPage = lazy(() => import('./pages/Vendedor/VendedorLoginPage'));
const VendedorShell = lazy(() => import('./pages/Vendedor/VendedorShell'));

function App() {
  return (
    <>
      <ErrorBoundary>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Rotas Públicas */}
                <Route path="/login" element={<AuthPage />} />
                <Route path="/cadastro" element={<AuthPage />} />
                <Route path="/vendedor/login" element={<VendedorLoginPage />} />

                {/* App do vendedor externo -- shell com guarda propria (ver
                    comentario no import acima), por isso fica FORA de
                    ProtectedRoute e ANTES do coringa "/*" do AppLayout,
                    senao cairia no ERP normal (mesmo motivo do /superadmin
                    abaixo). */}
                <Route path="/vendedor/*" element={<VendedorShell />} />

                {/* Painel da plataforma -- shell proprio, sem sidebar de
                    modulos nem sistema de abas (esses sao conceitos de
                    tenant). Precisa vir ANTES do coringa "/*" do AppLayout,
                    senao /superadmin cairia no ERP normal. */}
                <Route element={<PlatformAdminRoute />}>
                  <Route path="/superadmin" element={<PlatformAdminLayout />}>
                    <Route index element={<SuperAdmin />} />
                    <Route path="backups" element={<SuperAdminBackup />} />
                  </Route>
                </Route>

                {/* Rotas Protegidas (Exigem Login) */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/pdv" element={<PDV />} />
                  {/* AppLayout casa qualquer sub-rota; o conteudo real de
                      cada uma vem de appRoutesConfig, renderizado dentro
                      do MemoryRouter isolado de cada aba (ver TabPane). */}
                  <Route path="/*" element={<AppLayout />} />
                </Route>

                {/* Rota coringa de fallback */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ErrorBoundary>
    </>
  );
}

export default App;
