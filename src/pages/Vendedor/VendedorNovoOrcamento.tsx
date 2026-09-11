import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { showError, showSuccess } from '../../utils/alerts';
import ClientAutocomplete from '../../components/common/ClientAutocomplete';
import type { SearchableClient } from '../../utils/clientSearch';
import VendedorHeader from './VendedorHeader';
import VendedorItemPicker, { type ProdutoVendedorExterno } from './VendedorItemPicker';
import { criarOrcamentoExterno, type ItemVendaExterna } from '../../services/vendedorExternoVendaService';

interface ClienteVendedor extends SearchableClient {
  id: string;
  nome: string;
  telefone?: string;
}

const VendedorNovoOrcamento: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const { items: produtos } = useTenantCollection<ProdutoVendedorExterno & { ativo?: boolean }>('estoque', tenantId);
  const { items: clientes } = useTenantCollection<ClienteVendedor>('clientes', tenantId);

  const [clienteBusca, setClienteBusca] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteVendedor | null>(null);
  const [itens, setItens] = useState<ItemVendaExterna[]>([]);
  const [salvando, setSalvando] = useState(false);

  const produtosAtivos = produtos.filter((p) => p.ativo !== false);

  const handleFinalizar = async () => {
    if (!clienteSelecionado) {
      showError('Atenção', 'Selecione o cliente.');
      return;
    }
    if (itens.length === 0) {
      showError('Atenção', 'Adicione pelo menos um item.');
      return;
    }
    if (!tenantId || !currentUser) return;

    setSalvando(true);
    try {
      const { numeroOrcamento } = await criarOrcamentoExterno({
        tenantId,
        usuarioId: currentUser.uid,
        clienteId: clienteSelecionado.id,
        clienteNome: clienteSelecionado.nome,
        clienteTelefone: clienteSelecionado.telefone || '',
        itens,
      });
      showSuccess(`Orçamento #${numeroOrcamento} criado!`);
      navigate('/vendedor', { replace: true });
    } catch (error) {
      console.error('Erro ao criar orçamento do vendedor externo:', error);
      showError('Não foi possível criar', error instanceof Error ? error.message : 'Tente novamente em instantes.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo="Novo Orçamento" />

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
        <VendedorItemPicker produtos={produtosAtivos} itens={itens} onItensChange={setItens} permitirVendaSemEstoque />
      </div>

      <div style={{ padding: '16px 20px 24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <button
          type="button"
          onClick={handleFinalizar}
          disabled={salvando}
          style={{
            width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: '8px', fontSize: '15px', fontWeight: 700, color: '#fff', cursor: 'pointer',
            background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
            opacity: salvando ? 0.7 : 1,
          }}
        >
          <CheckCircle2 size={18} />
          {salvando ? 'Criando...' : 'Criar Orçamento'}
        </button>
      </div>
    </div>
  );
};

export default VendedorNovoOrcamento;
