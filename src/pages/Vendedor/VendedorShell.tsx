import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useVendedorAppTags } from './useVendedorAppTags';
import VendedorHome from './VendedorHome';
import VendedorNovoPedido from './VendedorNovoPedido';
import VendedorNovoOrcamento from './VendedorNovoOrcamento';
import VendedorConsultarCliente from './VendedorConsultarCliente';
import VendedorConsultarPreco from './VendedorConsultarPreco';
import VendedorMeusPedidos from './VendedorMeusPedidos';
import VendedorPerfil from './VendedorPerfil';
import VendedorBottomNav from './VendedorBottomNav';

/**
 * Guarda de acesso do aplicativo do vendedor externo, separada da
 * ProtectedRoute do sistema desktop porque o redirecionamento (e a
 * mensagem de bloqueio) tem que apontar pro /vendedor/login, nunca pro
 * /login normal.
 *
 * Confere DUAS coisas antes de deixar entrar: esta logado, E este login
 * especifico tem `acessoAppMobile` ligado (Usuarios ou Vendedores, ver
 * PermissoesUsuarioModal.tsx / VendedoresList.tsx) -- alguem com login
 * normal do sistema, sem essa permissao, nao entra so por acertar a URL.
 */

// A navbar fica escondida nas telas de montar pedido/orcamento -- ja tem
// botao de acao fixo embaixo, sem espaco (nem sentido) pra navegacao.
const SEM_NAVBAR = ['/vendedor/pedido/novo', '/vendedor/orcamento/novo'];

const VendedorShell: React.FC = () => {
  useVendedorAppTags();
  const location = useLocation();
  const { currentUser, loading, acessoAppMobile, logout } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
        Carregando...
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/vendedor/login" replace />;
  }

  if (!acessoAppMobile) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', textAlign: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <ShieldAlert size={40} color="#f59e0b" />
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Sem acesso ao aplicativo mobile</div>
        <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '320px' }}>
          Este login não tem o acesso ao aplicativo mobile liberado. Peça pro administrador liberar em Usuários ou Vendedores.
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="btn-secondary"
          style={{ marginTop: '8px' }}
        >
          Sair
        </button>
      </div>
    );
  }

  const mostraNavbar = !SEM_NAVBAR.includes(location.pathname);

  return (
    <div style={{ height: '100dvh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route index element={<VendedorHome />} />
          <Route path="pedido/novo" element={<VendedorNovoPedido />} />
          <Route path="orcamento/novo" element={<VendedorNovoOrcamento />} />
          <Route path="pedidos" element={<VendedorMeusPedidos />} />
          <Route path="cliente" element={<VendedorConsultarCliente />} />
          <Route path="preco" element={<VendedorConsultarPreco />} />
          <Route path="perfil" element={<VendedorPerfil />} />
          <Route path="*" element={<Navigate to="/vendedor" replace />} />
        </Routes>
      </div>
      {mostraNavbar && <VendedorBottomNav />}
    </div>
  );
};

export default VendedorShell;
