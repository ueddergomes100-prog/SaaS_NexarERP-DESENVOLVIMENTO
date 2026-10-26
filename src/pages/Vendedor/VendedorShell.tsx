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
import VendedorOsNova from './VendedorOsNova';
import VendedorOsAtender from './VendedorOsAtender';
import VendedorFaixaOffline from './VendedorFaixaOffline';
import VendedorOsImprimir from './VendedorOsImprimir';
import './vendedorMobile.css';
import './vendedorVisual.css';
import { podeContarBalancoNoApp } from './vendedorPermissoes';
import VendedorBalanco from './VendedorBalanco';
import VendedorNovoCliente from './VendedorNovoCliente';
import VendedorNovaTroca from './VendedorNovaTroca';
import VendedorTrocas from './VendedorTrocas';
import VendedorEntregas from './VendedorEntregas';
import VendedorEntregaRota from './VendedorEntregaRota';
import VendedorEntregaRegistrar from './VendedorEntregaRegistrar';
import EnvioAutomaticoDeRascunhos from './EnvioAutomaticoDeRascunhos';
import VendedorConferenciaFila from './VendedorConferenciaFila';
import VendedorConferencia from './VendedorConferencia';
import VendedorLiberacoes from './VendedorLiberacoes';
import { podeLiberarDescontoNoApp, podeTelaDoApp, PERMISSAO_APP } from './vendedorPermissoes';
import { renovarAvisosSeAtivos } from '../../services/notificacoesPushService';
import { hasTenantFullAccess } from '../../utils/roles';
import { PERMISSAO_TROCA_SOLICITAR } from '../../utils/trocaDomain';

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
// Conferencia (15/10/2026): a tela de conferir usa a barra de baixo para a quantidade e o "Fechar conferencia".
const SEM_NAVBAR_PREFIXOS = ['/vendedor/cliente/novo', '/vendedor/pedido/novo', '/vendedor/orcamento/novo', '/vendedor/pedido/rascunho/', '/vendedor/orcamento/rascunho/', '/vendedor/conferencia/', '/vendedor/balanco'];

const VendedorShell: React.FC = () => {
  const location = useLocation();
  const { currentUser, loading, acessoAppMobile, logout, userPermissions, userRole, isOwner } = useAuth();

  // Avisos no celular (21/10/2026): quem ja' ativou tem o token renovado em
  // silencio a cada abertura (ele muda de tempos em tempos).
  React.useEffect(() => {
    if (currentUser && acessoAppMobile) void renovarAvisosSeAtivos();
  }, [currentUser, acessoAppMobile]);

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
  // Bloco "Aplicativo mobile" (26/10/2026): tela sem a chave volta para o inicio (a URL direta nao passa).
  const so = (chave: string, elemento: React.ReactElement) => (podeTelaDoApp(chave, userRole, isOwner, userPermissions) ? elemento : <Navigate to="/vendedor" replace />);
  const podeRascunhos = [PERMISSAO_APP.pedido, PERMISSAO_APP.orcamento].some((chave) => podeTelaDoApp(chave, userRole, isOwner, userPermissions))
    || hasTenantFullAccess(userRole, isOwner) || userPermissions.includes(PERMISSAO_TROCA_SOLICITAR);

  return (
    <div
      className="vendedor-app vendedor-safe-area"
      style={{ height: '100dvh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}
    >
      {/* key por rota: sair de um rascunho e abrir Novo Pedido tem que
          comecar a tela do zero, nao herdar o estado do rascunho. */}
      <div key={location.pathname} style={{ flex: 1, minHeight: 0 }}>
        <VendedorFaixaOffline />
        <Routes>
          <Route index element={<VendedorHome />} />
          <Route path="pedido/novo" element={so(PERMISSAO_APP.pedido, <VendedorNovoPedido />)} />
          <Route path="pedido/rascunho/:localId" element={so(PERMISSAO_APP.pedido, <VendedorNovoPedido />)} />
          <Route path="pedido/:id" element={so(PERMISSAO_APP.pedido, <VendedorPedidoDetalhe />)} />
          <Route path="orcamento/novo" element={so(PERMISSAO_APP.orcamento, <VendedorNovoOrcamento />)} />
          <Route path="orcamento/rascunho/:localId" element={so(PERMISSAO_APP.orcamento, <VendedorNovoOrcamento />)} />
          <Route path="rascunhos" element={podeRascunhos ? <VendedorRascunhos /> : <Navigate to="/vendedor" replace />} />
          <Route path="troca/nova" element={<VendedorNovaTroca />} />
          <Route path="troca/rascunho/:localId" element={<VendedorNovaTroca />} />
          <Route path="trocas" element={<VendedorTrocas />} />
          <Route path="os" element={<VendedorOrdensServico />} />
          <Route path="os/nova" element={<VendedorOsNova />} />
          <Route path="os/:id/atender" element={<VendedorOsAtender />} />
          <Route path="os/:id" element={<VendedorOrdemServicoDetalhe />} />
          <Route path="entregas" element={<VendedorEntregas />} />
          <Route path="entregas/:id" element={<VendedorEntregaRota />} />
          <Route path="entregas/:id/:pedidoId" element={<VendedorEntregaRegistrar />} />
          <Route path="pedidos" element={so(PERMISSAO_APP.pedido, <VendedorMeusPedidos />)} />
          <Route path="cliente" element={so(PERMISSAO_APP.clientes, <VendedorConsultarCliente />)} />
          <Route path="cliente/novo" element={so(PERMISSAO_APP.clientes, <VendedorNovoCliente />)} />
          <Route path="preco" element={so(PERMISSAO_APP.preco, <VendedorConsultarPreco />)} />
          <Route path="perfil" element={<VendedorPerfil />} />
          <Route path="contas-pagar" element={so(PERMISSAO_APP.contasPagar, <VendedorContasPagar />)} />
          <Route path="contas-receber" element={so(PERMISSAO_APP.contasReceber, <VendedorContasReceber />)} />
          <Route path="conferencia" element={so(PERMISSAO_APP.conferencia, <VendedorConferenciaFila />)} />
          <Route path="conferencia/troca/:trocaId" element={so(PERMISSAO_APP.conferencia, <VendedorConferencia />)} />
          <Route path="conferencia/:pedidoId" element={so(PERMISSAO_APP.conferencia, <VendedorConferencia />)} />
          <Route
            path="balanco"
            element={podeContarBalancoNoApp(userRole, isOwner, userPermissions) ? so(PERMISSAO_APP.balanco, <VendedorBalanco />) : <Navigate to="/vendedor" replace />}
          />
          {/* Liberacao de desconto pelo celular (21/10/2026): so' quem pode liberar. */}
          <Route
            path="liberacoes"
            element={podeLiberarDescontoNoApp(userRole, isOwner, userPermissions) ? so(PERMISSAO_APP.liberacoes, <VendedorLiberacoes />) : <Navigate to="/vendedor" replace />}
          />
          <Route path="*" element={<Navigate to="/vendedor" replace />} />
        </Routes>
      </div>
      {mostraNavbar && <VendedorBottomNav />}
      {/* Fora do bloco por rota: segue montado em qualquer tela do app. */}
      <EnvioAutomaticoDeRascunhos />
    </div>
  );
};

export default VendedorShell;
