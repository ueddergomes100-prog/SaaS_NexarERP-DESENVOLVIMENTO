import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ClipboardList, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHome from './VendedorHome';
import VendedorNovoPedido from './VendedorNovoPedido';
import VendedorNovoOrcamento from './VendedorNovoOrcamento';
import VendedorConsultarCliente from './VendedorConsultarCliente';
import VendedorConsultarPreco from './VendedorConsultarPreco';
import VendedorMeusPedidos from './VendedorMeusPedidos';
import VendedorPerfil from './VendedorPerfil';
import VendedorBottomNav from './VendedorBottomNav';
import VendedorEmBreve from './VendedorEmBreve';
import VendedorContasPagar from './VendedorContasPagar';
import VendedorContasReceber from './VendedorContasReceber';
import VendedorRascunhos from './VendedorRascunhos';
import VendedorPedidoDetalhe from './VendedorPedidoDetalhe';
import VendedorPedidoImprimir from './VendedorPedidoImprimir';
import VendedorOrdensServico from './VendedorOrdensServico';
import VendedorOrdemServicoDetalhe from './VendedorOrdemServicoDetalhe';
import VendedorOsImprimir from './VendedorOsImprimir';
import './vendedorMobile.css';
import { PERMISSAO_BALANCO } from './vendedorPermissoes';
import VendedorNovoCliente from './VendedorNovoCliente';
import VendedorNovaTroca from './VendedorNovaTroca';
import VendedorTrocas from './VendedorTrocas';

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

// A navbar fica escondida nas telas de montar pedido/orcamento (novo ou
// rascunho reaberto) -- ja tem botao de acao fixo embaixo, sem espaco (nem
// sentido) pra navegacao.
const SEM_NAVBAR_PREFIXOS = ['/vendedor/cliente/novo', '/vendedor/pedido/novo', '/vendedor/orcamento/novo', '/vendedor/pedido/rascunho/', '/vendedor/orcamento/rascunho/'];

const VendedorShell: React.FC = () => {
  const location = useLocation();
  const { currentUser, loading, acessoAppMobile, logout, userPermissions } = useAuth();

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
        <p style={{ fontSize: '14.5px', color: 'var(--text-muted)', maxWidth: '320px' }}>
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

  // Impressao fica FORA da casca de altura fixa abaixo: aquela casca corta
  // tudo numa tela so' (overflow hidden), e a folha precisa rolar na tela e
  // paginar no papel/PDF.
  if (location.pathname.endsWith('/imprimir')) {
    return (
      <Routes>
        <Route path="pedido/:id/imprimir" element={<VendedorPedidoImprimir />} />
        <Route path="os/:id/imprimir" element={<VendedorOsImprimir />} />
        <Route path="*" element={<Navigate to="/vendedor" replace />} />
      </Routes>
    );
  }

  const mostraNavbar = !SEM_NAVBAR_PREFIXOS.some((prefixo) => location.pathname.startsWith(prefixo));

  return (
    <div
      className="vendedor-app vendedor-safe-area"
      style={{ height: '100dvh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}
    >
      {/* key por rota: sair de um rascunho e abrir Novo Pedido tem que
          comecar a tela do zero, nao herdar o estado do rascunho. */}
      <div key={location.pathname} style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route index element={<VendedorHome />} />
          <Route path="pedido/novo" element={<VendedorNovoPedido />} />
          <Route path="pedido/rascunho/:localId" element={<VendedorNovoPedido />} />
          <Route path="pedido/:id" element={<VendedorPedidoDetalhe />} />
          <Route path="orcamento/novo" element={<VendedorNovoOrcamento />} />
          <Route path="orcamento/rascunho/:localId" element={<VendedorNovoOrcamento />} />
          <Route path="rascunhos" element={<VendedorRascunhos />} />
          <Route path="troca/nova" element={<VendedorNovaTroca />} />
          <Route path="troca/rascunho/:localId" element={<VendedorNovaTroca />} />
          <Route path="trocas" element={<VendedorTrocas />} />
          <Route path="os" element={<VendedorOrdensServico />} />
          <Route path="os/:id" element={<VendedorOrdemServicoDetalhe />} />
          <Route path="pedidos" element={<VendedorMeusPedidos />} />
          <Route path="cliente" element={<VendedorConsultarCliente />} />
          <Route path="cliente/novo" element={<VendedorNovoCliente />} />
          <Route path="preco" element={<VendedorConsultarPreco />} />
          <Route path="perfil" element={<VendedorPerfil />} />
          <Route path="contas-pagar" element={<VendedorContasPagar />} />
          <Route path="contas-receber" element={<VendedorContasReceber />} />
          <Route
            path="balanco"
            element={userPermissions.includes(PERMISSAO_BALANCO) ? (
              <VendedorEmBreve
                titulo="Balanço"
                descricao="A contagem de estoque direto pelo celular está a caminho. Em breve dá pra fazer o balanço sem precisar do computador."
                Icon={ClipboardList}
              />
            ) : <Navigate to="/vendedor" replace />}
          />
          <Route path="*" element={<Navigate to="/vendedor" replace />} />
        </Routes>
      </div>
      {mostraNavbar && <VendedorBottomNav />}
    </div>
  );
};

export default VendedorShell;
