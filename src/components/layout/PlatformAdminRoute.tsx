import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import BootSplash from './BootSplash';

/**
 * Guarda das rotas do painel da plataforma (/superadmin), espelhando o
 * ProtectedRoute -- mas exigindo perfil de plataforma, nao so sessao.
 *
 * IMPORTANTE: isto e' controle de NAVEGACAO, nao de seguranca. A URL
 * /superadmin nao esconde nada: qualquer pessoa pode digita-la, e este
 * componente roda no navegador do usuario. Quem realmente protege os dados
 * da plataforma sao a custom claim (superAdmin/NexarAdmin) e a funcao
 * isSuperAdmin() das firestore.rules -- mesmo que alguem force a tela, o
 * Firestore recusa as leituras. Nao tratar esta rota como barreira.
 */
const PlatformAdminRoute: React.FC = () => {
  const { currentUser, loading, isPlatformAdmin } = useAuth();

  if (loading) {
    return <BootSplash titulo="Painel da Plataforma" legenda="VERIFICANDO ACESSO..." />;
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Quem tem sessao valida mas nao e' da plataforma volta pro ERP normal.
  if (!isPlatformAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default PlatformAdminRoute;
