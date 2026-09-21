import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { showError, showSuccess } from '../../utils/alerts';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorHeader from './VendedorHeader';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import type { VendedorNovoPedidoNavState } from './vendedorNavState';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';

interface ClienteVendedor extends SearchableClient {
  id: string;
  nome: string;
  telefone?: string;
}

/**
 * Monta o pedido e guarda como RASCUNHO no aparelho -- nao envia pra base.
 * Quem envia de verdade e' "Enviar dados" (VendedorRascunhos.tsx). Com
 * `:localId` na rota, reabre um rascunho ja salvo pra editar.
 */
const VendedorNovoPedido: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { localId } = useParams();
  const estadoNavegacao = (location.state as VendedorNovoPedidoNavState | null) || null;
  const { tenantId, currentUser, trabalhaComPreVenda, permiteVendaSemEstoque } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  // VendedorShell so' renderiza depois do login carregado, entao tenantId e
  // currentUser ja existem aqui -- da pra ler o rascunho direto no estado
  // inicial.
  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));

  const [clienteBusca, setClienteBusca] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(() => {
    if (rascunhoAberto) return { ...rascunhoAberto.cliente };
    return estadoNavegacao?.clientePreSelecionado
      ? { id: estadoNavegacao.clientePreSelecionado.id, nome: estadoNavegacao.clientePreSelecionado.nome }
      : null;
  });
  const [itens, setItens] = useState<ItemVendaExterna[]>(() => {
    if (rascunhoAberto) return rascunhoAberto.itens;
    return estadoNavegacao?.itemPreAdicionado ? [estadoNavegacao.itemPreAdicionado] : [];
  });

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  if (localId && !rascunhoAberto) {
    // Rascunho ja enviado (ou apagado) -- nao ha mais o que editar aqui.
    return <Navigate to="/vendedor/rascunhos" replace />;
  }

  const handleSalvar = () => {
    if (!trabalhaComPreVenda) {
      showError(
        'Pré-venda não está habilitada',
        'O pedido do vendedor externo precisa da opção "Pré-venda" ligada em Configurações → Configurações Avançadas. Peça pro administrador habilitar antes de montar pedidos pelo aplicativo.',
      );
      return;
    }
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
        tipo: 'pedido',
        cliente: {
          id: clienteSelecionado.id,
          nome: clienteSelecionado.nome,
          ...(clienteSelecionado.telefone ? { telefone: clienteSelecionado.telefone } : {}),
        },
        itens,
        criadoEm: rascunhoAberto?.criadoEm || agora,
        atualizadoEm: agora,
      });
      showSuccess('Rascunho salvo! Toque em "Enviar dados" quando o pedido estiver fechado.');
      navigate('/vendedor/rascunhos', { replace: true });
    } catch (error) {
      showError('Não foi possível salvar', error instanceof RascunhoStorageError ? error.message : 'Tente novamente.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={localId ? 'Editar Rascunho' : 'Novo Pedido'} />

      <div style={{ padding: '16px 20px 0' }}>
        {clienteSelecionado ? (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '13px 14px', borderRadius: '14px',
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{clienteSelecionado.nome}</div>
            </div>
            <button
              type="button"
              onClick={() => { setClienteSelecionado(null); setClienteBusca(''); }}
              style={{ fontSize: '12.5px', color: 'var(--brand-400)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <ClientAutocomplete
            value={clienteBusca}
            onChange={setClienteBusca}
            clients={clientes}
            onSelect={(cliente) => setClienteSelecionado(cliente)}
            renderItem={(cliente) => <span>{cliente.nome}</span>}
            placeholder="Buscar cliente por nome"
            ariaLabel="Buscar cliente"
          />
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque={permiteVendaSemEstoque} />
      </div>

      <div style={{ padding: '16px 20px calc(24px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={handleSalvar}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff', cursor: 'pointer',
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

export default VendedorNovoPedido;
