import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { showError, showSuccess } from '../../utils/alerts';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorHeader from './VendedorHeader';
import VendedorSeletorCliente from './VendedorSeletorCliente';
import type { ClienteConfirmavel } from './VendedorConfirmarClienteModal';
import { clienteComCodigo } from '../../utils/pedidoVendedorDomain';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import { podeCadastrarClienteNoApp } from './vendedorPermissoes';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';

interface ClienteVendedor extends SearchableClient, ClienteConfirmavel {
  id: string;
  nome: string;
  telefone?: string;
}

/** Mesmo fluxo de VendedorNovoPedido: salva rascunho no aparelho, envia so'
 *  em "Enviar dados". */
const VendedorNovoOrcamento: React.FC = () => {
  const navigate = useNavigate();
  const { localId } = useParams();
  const location = useLocation();
  const estadoNavegacao = (location.state as VendedorNovoPedidoNavState | null) || null;
  const { tenantId, currentUser, userPermissions } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));

  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(
    () => {
      if (rascunhoAberto) return { ...rascunhoAberto.cliente };
      // Volta do cadastro de cliente ja' com o cliente novo escolhido.
      return estadoNavegacao?.clientePreSelecionado
        ? { id: estadoNavegacao.clientePreSelecionado.id, nome: estadoNavegacao.clientePreSelecionado.nome }
        : null;
    },
  );
  const [itens, setItens] = useState<ItemVendaExterna[]>(() => rascunhoAberto?.itens || []);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  if (localId && !rascunhoAberto) {
    return <Navigate to="/vendedor/rascunhos" replace />;
  }

  const handleSalvar = () => {
    if (!clienteSelecionado) {
      showError('Atenção', 'Selecione o cliente.');
      return;
    }
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item.');
      return;
    }
    if (!tenantId || !currentUser) return;

    const agora = new Date().toISOString();
    try {
      salvarRascunho(tenantId, currentUser.uid, {
        localId: rascunhoAberto?.localId || novoLocalId(),
        tipo: 'orcamento',
        cliente: {
          id: clienteSelecionado.id,
          nome: clienteSelecionado.nome,
          ...(clienteSelecionado.telefone ? { telefone: clienteSelecionado.telefone } : {}),
        },
        itens,
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
      });
      showSuccess('Rascunho salvo! Toque em "Enviar dados" quando o orçamento estiver fechado.');
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Rascunho' : 'Novo Orçamento'} />

      <div style={{ padding: '16px 20px 0' }}>
        {clienteSelecionado ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px',
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{clienteComCodigo(clienteSelecionado)}</div>
            </div>
            <button
              type="button"
              onClick={() => setClienteSelecionado(null)}
              style={{ fontSize: '13.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <VendedorSeletorCliente clientes={clientes} onConfirmar={setClienteSelecionado} />
        )}
        {!clienteSelecionado && podeCadastrarClienteNoApp(userPermissions) && (
          <button
            type="button"
            onClick={() => navigate('/vendedor/cliente/novo', { state: { retornarPara: 'orcamento' } })}
            style={{ marginTop: '10px', fontSize: '14px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          >
            + Cadastrar novo cliente
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque />
      </div>

      <div style={{ padding: '16px 20px calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={handleSalvar}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
          }}
        >
          <Save size={18} />
          Salvar rascunho
        </button>
      </div>
    </div>
  );
};

export default VendedorNovoOrcamento;
