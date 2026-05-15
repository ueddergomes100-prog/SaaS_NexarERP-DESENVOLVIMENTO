import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute: React.FC = () => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        width: '100vw',
        backgroundColor: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-primary)'
      }}>
        <div style={{
          width: '60px', height: '60px',
          backgroundColor: 'var(--accent-purple)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '32px',
          fontWeight: 'bold',
          animation: 'pulseLogo 1.5s infinite ease-in-out',
        }}>
          N
        </div>
      </div>
    );
  }

  // Se não estiver logado, redireciona para o login
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // Se estiver logado, renderiza as rotas filhas (Dashboard, OS, etc)
  return <Outlet />;
};

export default ProtectedRoute;
