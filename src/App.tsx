import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import PlatformAdminRoute from './components/layout/PlatformAdminRoute';
import PlatformAdminLayout from './components/layout/PlatformAdminLayout';
import AppLayout from './components/layout/AppLayout';
import PageLoader from './components/layout/PageLoader';

// Painel da plataforma e as rotas publicas ficam fora do sistema de abas
// (Sistema de Abas, F19) -- continuam com import direto aqui. Todo o resto
// do "miolo" do app vive em src/routes/appRoutesConfig.tsx, montado uma vez
// por aba. A Frente de Caixa (PDV) e' app separado, em /caixa (CaixaShell).
const AuthPage = lazy(() => import('./pages/Auth/AuthPage'));
const CotacaoPublica = lazy(() => import('./pages/Compras/CotacaoPublica'));
const SuperAdmin = lazy(() => import('./pages/Admin/SuperAdmin'));
const SuperAdminBackup = lazy(() => import('./pages/Admin/SuperAdminBackup'));
const SuperAdminManutencao = lazy(() => import('./pages/Admin/SuperAdminManutencao'));
// App do vendedor externo (mobile): shell + login proprios, sem Sidebar/
// TopBar nem Sistema de Abas -- mesmo motivo do painel da plataforma. O login fica
// PUBLICO (fora de ProtectedRoute, que redireciona pro /login normal) e o
// shell faz sua PROPRIA checagem de sessao + acessoAppMobile (ver
// VendedorShell.tsx), porque o vendedor de balcao loga com codigo+PIN, nao
// com o fluxo padrao do sistema.
const VendedorLoginPage = lazy(() => import('./pages/Vendedor/VendedorLoginPage'));
const VendedorShell = lazy(() => import('./pages/Vendedor/VendedorShell'));
const VendedorInstalar = lazy(() => import('./pages/Vendedor/VendedorInstalar'));
// Frente de Caixa como app separado (/caixa, 19/10/2026): mesmo desenho do app
// do vendedor -- login publico proprio, shell com guarda propria (CaixaShell.tsx)
// e pagina de instalacao no arquivo HTML real (caixa.html).
const CaixaLoginPage = lazy(() => import('./pages/Caixa/CaixaLoginPage'));
const CaixaShell = lazy(() => import('./pages/Caixa/CaixaShell'));
const CaixaInstalar = lazy(() => import('./pages/Caixa/CaixaInstalar'));

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
                {/* Cotacao de compra para o FORNECEDOR (22/10/2026): sem login,
                    token no link + codigo de acesso; tudo pelo servidor. */}
                <Route path="/cotacao/:token" element={<CotacaoPublica />} />
                <Route path="/vendedor/login" element={<VendedorLoginPage />} />
                {/* Arquivo real servido pela hospedagem (unico caminho com o
                    <head> do app do vendedor) -- e' o start_url do manifest e
                    a pagina de instalacao. Ver VendedorInstalar.tsx. */}
                <Route path="/vendedor.html" element={<VendedorInstalar />} />

                {/* App do vendedor externo -- shell com guarda propria (ver
                    comentario no import acima), por isso fica FORA de
                    ProtectedRoute e ANTES do coringa "/*" do AppLayout,
                    senao cairia no ERP normal (mesmo motivo do /superadmin
                    abaixo). */}
                <Route path="/vendedor/*" element={<VendedorShell />} />

                {/* Frente de Caixa como app separado: mesma regra do /vendedor
                    (fora de ProtectedRoute e antes do coringa do AppLayout). */}
                <Route path="/caixa/login" element={<CaixaLoginPage />} />
                <Route path="/caixa.html" element={<CaixaInstalar />} />
                <Route path="/caixa/*" element={<CaixaShell />} />

                {/* Painel da plataforma -- shell proprio, sem sidebar de
                    modulos nem sistema de abas (esses sao conceitos de
                    tenant). Precisa vir ANTES do coringa "/*" do AppLayout,
                    senao /superadmin cairia no ERP normal. */}
                <Route element={<PlatformAdminRoute />}>
                  <Route path="/superadmin" element={<PlatformAdminLayout />}>
                    <Route index element={<SuperAdmin />} />
                    <Route path="backups" element={<SuperAdminBackup />} />
                    <Route path="manutencao" element={<SuperAdminManutencao />} />
                  </Route>
                </Route>

                {/* Rotas Protegidas (Exigem Login) */}
                <Route element={<ProtectedRoute />}>
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
