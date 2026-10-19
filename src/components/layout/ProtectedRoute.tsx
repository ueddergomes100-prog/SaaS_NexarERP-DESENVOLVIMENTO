import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import BootSplash from './BootSplash';
import VerificadorDataDoSistema from './VerificadorDataDoSistema';
import { CAMINHO_APP_CAIXA, entraDiretoNoCaixa } from '../../utils/frenteDeCaixaDomain';

const ProtectedRoute: React.FC = () => {
  const { currentUser, loading, userRole, isOwner, userPermissions } = useAuth();

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

  // Funcionario caixa (19/10/2026): so' a Frente de Caixa -- o sistema nao
  // aparece para ele, nem por URL. O app do caixa (/caixa) fica fora desta rota.
  if (entraDiretoNoCaixa({ role: userRole, isOwner, permissoes: userPermissions })) {
    return <Navigate to={CAMINHO_APP_CAIXA} replace />;
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
