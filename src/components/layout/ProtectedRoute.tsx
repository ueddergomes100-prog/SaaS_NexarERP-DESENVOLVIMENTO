import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import BootSplash from './BootSplash';

const ProtectedRoute: React.FC = () => {
  const { currentUser, loading } = useAuth();

  // Mesmo splash que o AuthPage mostra logo apos autenticar. Manter o visual
  // identico e' o que faz a transicao login -> sistema parecer continua: o
  // componente troca no meio da navegacao, mas a tela nao pisca.
  if (loading) {
    return <BootSplash />;
  }

  // Se não estiver logado, redireciona para o login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Se estiver logado, renderiza as rotas filhas (Dashboard, OS, etc)
  return <Outlet />;
};

export default ProtectedRoute;
