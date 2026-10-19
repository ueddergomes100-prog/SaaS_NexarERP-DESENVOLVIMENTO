import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import VerificadorDataDoSistema from '../../components/layout/VerificadorDataDoSistema';
import PDV from '../PDV/PDV';
import { CAMINHO_APP_CAIXA, CAMINHO_LOGIN_CAIXA, MENSAGEM_SEM_ACESSO_AO_CAIXA, podeUsarFrenteDeCaixa } from '../../utils/frenteDeCaixaDomain';

/**
 * Casca da Frente de Caixa como app separado (/caixa, 19/10/2026) -- o mesmo
 * papel que VendedorShell tem para /vendedor: fica FORA da ProtectedRoute do
 * sistema porque o redirecionamento e a mensagem de bloqueio apontam para o
 * /caixa/login, nunca para o /login normal.
 *
 * Confere duas coisas: esta logado, e este login pode usar o caixa
 * (podeUsarFrenteDeCaixa). O PDV em si continua conferindo o modulo do plano
 * e a empresa ativa, como faz dentro do sistema.
 */
const CaixaShell: React.FC = () => {
  const { currentUser, loading, userRole, isOwner, userPermissions, logout } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        Carregando...
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to={CAMINHO_LOGIN_CAIXA} replace />;
  }

  if (!podeUsarFrenteDeCaixa({ role: userRole, isOwner, permissoes: userPermissions })) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', textAlign: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <ShieldAlert size={40} color="#f59e0b" />
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Sem acesso à Frente de Caixa</div>
        <p style={{ fontSize: '14.5px', color: 'var(--text-muted)', maxWidth: '360px' }}>{MENSAGEM_SEM_ACESSO_AO_CAIXA}</p>
        <button type="button" onClick={() => void logout()} className="btn-secondary" style={{ marginTop: '8px' }}>
          Sair
        </button>
      </div>
    );
  }

  return (
    <>
      <VerificadorDataDoSistema />
      <Routes>
        <Route index element={<PDV modo="app" />} />
        <Route path="*" element={<Navigate to={CAMINHO_APP_CAIXA} replace />} />
      </Routes>
    </>
  );
};

export default CaixaShell;
