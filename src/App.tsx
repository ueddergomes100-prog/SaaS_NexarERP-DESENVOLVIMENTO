import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import Dashboard from './pages/Dashboard/Dashboard';
import Orcamentos from './pages/Orcamentos/Orcamentos';
import PedidoVendas from './pages/Vendas/PedidoVendas';
import RelatoriosVendas from './pages/Vendas/RelatoriosVendas';
import OSList from './pages/OS/OSList';
import RelatoriosMecanica from './pages/OS/RelatoriosMecanica';
import OSForm from './pages/OS/OSForm';
import OsPrint from './pages/OS/OsPrint';
import EstoqueList from './pages/Estoque/EstoqueList';
import EstoqueForm from './pages/Estoque/EstoqueForm';
import LembretesList from './pages/Lembretes/LembretesList';
import LembreteForm from './pages/Lembretes/LembreteForm';
import Caixa from './pages/Financeiro/Caixa';
import Faturamento from './pages/Financeiro/Faturamento';
import ContasReceber from './pages/Financeiro/ContasReceber';
import RelatorioComissoes from './pages/Financeiro/RelatorioComissoes';
import ClientesList from './pages/Clientes/ClientesList';
import ClienteForm from './pages/Clientes/ClienteForm';
import UsuariosList from './pages/Usuarios/UsuariosList';
import Configuracoes from './pages/Configuracoes/Configuracoes';
import ServicosList from './pages/Servicos/ServicosList';
import ServicoForm from './pages/Servicos/ServicoForm';
import CategoriasList from './pages/Categorias/CategoriasList';
import CategoriaForm from './pages/Categorias/CategoriaForm';
import Agenda from './pages/CRM/Agenda';
import NFE from './pages/Fiscal/NFE';
import EntradaNFE from './pages/Fiscal/EntradaNFE';
import SuperAdmin from './pages/Admin/SuperAdmin';
import UsuarioForm from './pages/Usuarios/UsuarioForm';

function App() {
  const [splashState, setSplashState] = useState<'visible' | 'fading' | 'hidden'>('visible');

  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashState('fading'), 1500);
    const hideTimer = setTimeout(() => setSplashState('hidden'), 2000);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  return (
    <>
      {splashState !== 'hidden' && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          opacity: splashState === 'fading' ? 0 : 1,
          transition: 'opacity 0.5s ease-in-out'
        }}>
          <div style={{
            width: '80px', height: '80px',
            backgroundColor: 'var(--accent-purple)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            fontWeight: 'bold',
            color: 'white',
            animation: 'pulseLogo 1.5s infinite ease-in-out',
            boxShadow: '0 0 20px rgba(139, 92, 246, 0.5)'
          }}>
            N
          </div>
          <h1 style={{
            marginTop: '24px',
            fontSize: '24px',
            color: 'white',
            letterSpacing: '2px',
            animation: 'drawLogo 1s ease-out forwards'
          }}>
            NEXAR ERP
          </h1>
        </div>
      )}

      <AuthProvider>
        <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            {/* Rotas Públicas */}
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<Register />} />

            {/* Rotas Protegidas (Exigem Login) */}
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                
                <Route path="orcamentos" element={<Orcamentos />} />
                <Route path="pedidos-venda" element={<PedidoVendas />} />
                <Route path="relatorios-vendas" element={<RelatoriosVendas />} />
                
                <Route path="os" element={<OSList />} />
                <Route path="os/nova" element={<OSForm />} />
                <Route path="os/editar/:id" element={<OSForm />} />
                <Route path="os/print/:id" element={<OsPrint />} />
                <Route path="relatorios-mecanica" element={<RelatoriosMecanica />} />
                
                <Route path="estoque" element={<EstoqueList />} />
                <Route path="estoque/nova" element={<EstoqueForm />} />
                <Route path="estoque/editar/:id" element={<EstoqueForm />} />
                
                <Route path="servicos" element={<ServicosList />} />
                <Route path="servicos/novo" element={<ServicoForm />} />
                <Route path="servicos/editar/:id" element={<ServicoForm />} />
                
                <Route path="crm/lembretes" element={<LembretesList />} />
                <Route path="crm/lembretes/novo" element={<LembreteForm />} />
                <Route path="crm/lembretes/editar/:id" element={<LembreteForm />} />
                <Route path="crm/agenda" element={<Agenda />} />
                
                <Route path="financeiro/caixa" element={<Caixa />} />
                <Route path="financeiro/contas-receber" element={<ContasReceber />} />
                <Route path="financeiro/faturamento" element={<Faturamento />} />
                <Route path="financeiro/comissoes" element={<RelatorioComissoes />} />
                
                <Route path="fiscal/nfe" element={<NFE />} />
                <Route path="fiscal/entrada-nfe" element={<EntradaNFE />} />
                
                <Route path="clientes" element={<ClientesList />} />
                <Route path="clientes/novo" element={<ClienteForm />} />
                <Route path="clientes/editar/:id" element={<ClienteForm />} />
                
                <Route path="usuarios" element={<UsuariosList />} />
                <Route path="usuarios/novo" element={<UsuarioForm />} />
                
                <Route path="categorias" element={<CategoriasList />} />
                <Route path="categorias/nova" element={<CategoriaForm />} />
                <Route path="categorias/editar/:id" element={<CategoriaForm />} />
                
                <Route path="configuracoes" element={<Configuracoes />} />
                
                {/* Painel SaaS */}
                <Route path="superadmin" element={<SuperAdmin />} />
              </Route>
            </Route>
            
            {/* Rota coringa de fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        </ErrorBoundary>
      </AuthProvider>
    </>
  );
}

export default App;
