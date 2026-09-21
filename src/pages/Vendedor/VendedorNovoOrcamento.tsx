import React, { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Save, UserPlus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { showError, showSuccess } from '../../utils/alerts';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import type { SearchableClient } from '../../utils/clientSearch';
import CadastroRapidoClienteModal, { type ClienteCadastradoRapido } from '../../components/common/CadastroRapidoClienteModal';
import VendedorHeader from './VendedorHeader';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import type { ItemVendaExterna } from '../../services/vendedorExternoVendaService';
import { buscarRascunho, novoLocalId, RascunhoStorageError, salvarRascunho } from './vendedorRascunhosStore';

interface ClienteVendedor extends SearchableClient {
  id: string;
  nome: string;
  telefone?: string;
}

/** Mesmo fluxo de VendedorNovoPedido: salva rascunho no aparelho, envia so'
 *  em "Enviar dados". */
const VendedorNovoOrcamento: React.FC = () => {
  const navigate = useNavigate();
  const { localId } = useParams();
  const { tenantId, currentUser } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  const [rascunhoAberto] = useState(() => (
    localId && tenantId && currentUser ? buscarRascunho(tenantId, currentUser.uid, localId) : null
  ));

  const [clienteBusca, setClienteBusca] = useState('');
  const [cadastroRapidoAberto, setCadastroRapidoAberto] = useState(false);
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(
    () => (rascunhoAberto ? { ...rascunhoAberto.cliente } : null),
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <ClientAutocomplete
              value={clienteBusca}
              onChange={setClienteBusca}
              clients={clientes}
              onSelect={(cliente) => setClienteSelecionado(cliente)}
              renderItem={(cliente) => <span>{cliente.nome}</span>}
              placeholder="Buscar cliente por nome"
              ariaLabel="Buscar cliente"
            />
            <button
              type="button"
              onClick={() => setCadastroRapidoAberto(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start',
                fontSize: '12.5px', color: 'var(--brand-400)', background: 'none', border: 'none',
                cursor: 'pointer', fontWeight: 600, padding: '2px 0',
              }}
            >
              <UserPlus size={14} /> Cliente não cadastrado? Cadastrar agora
            </button>
          </div>
        )}
      </div>

      <CadastroRapidoClienteModal
        open={cadastroRapidoAberto}
        nomeInicial={clienteBusca}
        onClose={() => setCadastroRapidoAberto(false)}
        onCriado={(cliente: ClienteCadastradoRapido) => {
          setClienteSelecionado({ id: cliente.id, nome: cliente.nome, ...(cliente.telefone ? { telefone: cliente.telefone } : {}) });
          setClienteBusca('');
        }}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque />
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

export default VendedorNovoOrcamento;
