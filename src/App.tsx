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
