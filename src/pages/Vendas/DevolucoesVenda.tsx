import React, { useEffect, useState } from 'react';
import { RotateCcw, Search, ShoppingCart } from 'lucide-react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import DevolucaoVendaModal from './DevolucaoVendaModal';

interface ItemVenda {
  id: string;
  nome: string;
  precoUnitario: number;
  quantidade: number;
  desconto: number;
  quantidadeJaDevolvida?: number;
  fatorConversao?: number;
  unidadeMedidaSigla?: string;
}

interface PedidoVendaResumo {
  id: string;
  numeroPedido: string;
  createdAt?: { seconds?: number };
  clienteNome?: string;
  valorTotal: number;
  status: string;
  itens?: ItemVenda[];
}

/**
 * Tela separada de Devolucao de Venda -- busca o pedido primeiro, depois
 * abre o mesmo DevolucaoVendaModal usado dentro do proprio pedido
 * (PedidoVendaForm.tsx). So aparece no menu quando a empresa liga
 * "Devolucao com tela separada" em Configuracoes (devolucaoBotaoSeparado);
 * por padrao a devolucao continua feita direto na tela do pedido.
 */
const DevolucoesVenda: React.FC = () => {
  const { tenantId } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoVendaResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [pedidoSelecionado, setPedidoSelecionado] = useState<PedidoVendaResumo | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId),
      where('status', '==', 'Finalizada'),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lista: PedidoVendaResumo[] = [];
      snapshot.forEach((docSnap) => lista.push({ id: docSnap.id, ...docSnap.data() } as PedidoVendaResumo));
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPedidos(lista);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao carregar pedidos para devolução:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [tenantId]);

  const termo = searchTerm.trim().toLowerCase();
  const pedidosFiltrados = termo
    ? pedidos.filter((p) => p.numeroPedido?.toLowerCase().includes(termo) || p.clienteNome?.toLowerCase().includes(termo))
    : pedidos;

  const podeDevolver = (p: PedidoVendaResumo) => (p.itens || []).some((item) => (item.quantidade - (item.quantidadeJaDevolvida || 0)) > 0);

  const atualizarItensDoPedidoSelecionado = async () => {
    if (!pedidoSelecionado) return;
    const snap = await getDoc(doc(db, 'pedidos_venda', pedidoSelecionado.id));
    if (snap.exists()) {
      setPedidoSelecionado((atual) => (atual ? { ...atual, itens: (snap.data().itens || []) as ItemVenda[] } : atual));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RotateCcw size={28} color="var(--accent-purple)" />
          Devolução de Venda
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>Busque o pedido finalizado para registrar a devolução de itens.</p>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="search-bar" style={{ position: 'relative', marginBottom: '24px' }}>
          <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            autoFocus
            placeholder="Buscar por número do pedido ou cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Nº Pedido</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Total (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>Carregando pedidos...</td>
                </tr>
              ) : pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <ShoppingCart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum pedido finalizado encontrado.</p>
                  </td>
                </tr>
              ) : (
                pedidosFiltrados.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '16px', fontWeight: 600 }}>#{p.numeroPedido}</td>
                    <td style={{ padding: '16px' }}>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td style={{ padding: '16px' }}>{p.clienteNome}</td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorTotal)}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <button
                        onClick={() => setPedidoSelecionado(p)}
                        className="btn-secondary"
                        disabled={!podeDevolver(p)}
                        title={podeDevolver(p) ? 'Devolução de itens deste pedido' : 'Todos os itens deste pedido já foram devolvidos'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', opacity: podeDevolver(p) ? 1 : 0.5, cursor: podeDevolver(p) ? 'pointer' : 'not-allowed' }}
                      >
                        <RotateCcw size={16} /> Devolução
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pedidoSelecionado && (
        <DevolucaoVendaModal
          pedidoId={pedidoSelecionado.id}
          numeroPedido={pedidoSelecionado.numeroPedido}
          clienteNome={pedidoSelecionado.clienteNome || ''}
          itens={pedidoSelecionado.itens || []}
          onClose={() => setPedidoSelecionado(null)}
          onSuccess={atualizarItensDoPedidoSelecionado}
        />
      )}
    </div>
  );
};

export default DevolucoesVenda;
