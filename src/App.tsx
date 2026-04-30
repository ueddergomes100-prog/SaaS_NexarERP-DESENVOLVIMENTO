import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/layout/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Auth/Login';
import Register from './pages/Auth/Register';
import Dashboard from './pages/Dashboard/Dashboard';
import OSList from './pages/OS/OSList';
import OSForm from './pages/OS/OSForm';
import OsPrint from './pages/OS/OsPrint';
import EstoqueList from './pages/Estoque/EstoqueList';
import EstoqueForm from './pages/Estoque/EstoqueForm';
import LembretesList from './pages/Lembretes/LembretesList';
import LembreteForm from './pages/Lembretes/LembreteForm';
import Caixa from './pages/Financeiro/Caixa';
import Faturamento from './pages/Financeiro/Faturamento';
import ClientesList from './pages/Clientes/ClientesList';
import ClienteForm from './pages/Clientes/ClienteForm';
import Configuracoes from './pages/Configuracoes/Configuracoes';
import ServicosList from './pages/Servicos/ServicosList';
import ServicoForm from './pages/Servicos/ServicoForm';
import CategoriasList from './pages/Categorias/CategoriasList';
import CategoriaForm from './pages/Categorias/CategoriaForm';

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
            NEXUS ERP
          </h1>
        </div>
      )}

      <AuthProvider>
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
                
                <Route path="os" element={<OSList />} />
                <Route path="os/nova" element={<OSForm />} />
                <Route path="os/editar/:id" element={<OSForm />} />
                <Route path="os/print/:id" element={<OsPrint />} />
                
                <Route path="estoque" element={<EstoqueList />} />
                <Route path="estoque/nova" element={<EstoqueForm />} />
                <Route path="estoque/editar/:id" element={<EstoqueForm />} />
                
                <Route path="servicos" element={<ServicosList />} />
                <Route path="servicos/novo" element={<ServicoForm />} />
                <Route path="servicos/editar/:id" element={<ServicoForm />} />
                
                <Route path="lembretes" element={<LembretesList />} />
                <Route path="lembretes/novo" element={<LembreteForm />} />
                <Route path="lembretes/editar/:id" element={<LembreteForm />} />
                
                <Route path="financeiro/caixa" element={<Caixa />} />
                <Route path="financeiro/faturamento" element={<Faturamento />} />
                
                <Route path="clientes" element={<ClientesList />} />
                <Route path="clientes/novo" element={<ClienteForm />} />
                <Route path="clientes/editar/:id" element={<ClienteForm />} />
                
                <Route path="categorias" element={<CategoriasList />} />
                <Route path="categorias/nova" element={<CategoriaForm />} />
                <Route path="categorias/editar/:id" element={<CategoriaForm />} />
                
                <Route path="configuracoes" element={<Configuracoes />} />
              </Route>
            </Route>
            
            {/* Rota coringa de fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}

export default App;
