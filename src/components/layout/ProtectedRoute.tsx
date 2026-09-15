import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import BootSplash from './BootSplash';
import VerificadorDataDoSistema from './VerificadorDataDoSistema';

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

  // Se estiver logado, renderiza as rotas filhas (Dashboard, OS, etc).
  // O verificador de data mora aqui pra cobrir de uma vez o ERP inteiro
  // (todas as abas) e o PDV, que sao irmaos dentro desta rota protegida.
  return (
    <>
      <VerificadorDataDoSistema />
      <Outlet />
    </>
  );
};

export default ProtectedRoute;
