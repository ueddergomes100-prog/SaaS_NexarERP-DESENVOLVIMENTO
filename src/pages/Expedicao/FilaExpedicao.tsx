import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Printer, Truck, ClipboardCheck } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { StatusConferencia } from '../../utils/conferenciaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';

interface PedidoExpedicaoData {
  id: string;
  numeroPedido: string;
  clienteNome?: string;
  createdAt?: { seconds?: number };
  statusConferencia: StatusConferencia;
  tenantId: string;
  vendedorId?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
}

// Mesmos rotulos/cores de PedidoVendas.tsx (coluna "Conferência") -- mantidos
// em arquivos separados de proposito, cada tela e' independente (mesmo
// espirito de STATUS_LABELS/STATUS_COLORS duplicados entre
// OrdensProducaoList.tsx e OrdemProducaoForm.tsx).
const STATUS_LABELS: Record<StatusConferencia, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};

const STATUS_COLORS: Record<StatusConferencia, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

const STATUS_FILTER_ORDER: StatusConferencia[] = ['aguardando', 'em_conferencia', 'divergente', 'conferido'];

const FilaExpedicao: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  const [pedidos, setPedidos] = useState<PedidoExpedicaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusConferencia | 'todos'>('todos');

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    // So le por tenantId (mesmo padrao de PedidoVendas.tsx/OrdensProducaoList.tsx)
    // -- pedidos sem statusConferencia (tenant nunca ligou a chave, ou venda
    // anterior ao modulo) sao filtrados no cliente, nunca aparecem na fila.
    const q = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: PedidoExpedicaoData[] = [];
      snapshot.forEach((docSnap) => {
        const item = { id: docSnap.id, ...docSnap.data() } as PedidoExpedicaoData;
        if (item.statusConferencia) data.push(item);
      });
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      // A fila tambem respeita a visibilidade de vendas. ATENCAO ao ligar
      // as duas configs juntas: se quem separa a mercadoria estiver como
      // nivel 'funcionario', a fila dele fica vazia -- o separador precisa
      // ser nivel 'administracao' pra enxergar os pedidos da equipe.
      setPedidos(filtrarVendasVisiveis(data, vendasVisiveisDeUsuarioId));
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar fila de expedição:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const filteredPedidos = pedidos.filter((p) => {
    if (statusFilter !== 'todos' && p.statusConferencia !== statusFilter) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (p.numeroPedido && p.numeroPedido.toLowerCase().includes(term)) ||
      (p.clienteNome && p.clienteNome.toLowerCase().includes(term))
    );
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Fila de Expedição</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Pedidos aguardando separação e conferência de mercadoria</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <button
          onClick={() => setStatusFilter('todos')}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: statusFilter === 'todos' ? 'var(--accent-purple)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: '13px',
          }}
        >
          Todos
        </button>
        {STATUS_FILTER_ORDER.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === status ? STATUS_COLORS[status] : 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número do pedido ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Data</th>
                <th>Cliente</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando fila de expedição...</td>
                </tr>
              ) : filteredPedidos.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <Truck size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>
                      {searchTerm
                        ? `Nenhum resultado encontrado para "${searchTerm}".`
                        : statusFilter !== 'todos'
                          ? `Nenhum pedido com status "${STATUS_LABELS[statusFilter]}".`
                          : 'Nenhum pedido aguardando expedição.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPedidos.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">#{p.numeroPedido}</td>
                    <td>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td>{p.clienteNome || 'Consumidor Final'}</td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[p.statusConferencia] }}>
                        {STATUS_LABELS[p.statusConferencia]}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button
                        onClick={() => navigate(`/operacoes/conferencia/${p.id}`)}
                        className="icon-btn"
                        title={p.statusConferencia === 'aguardando' ? 'Abrir Conferência' : 'Continuar/Reabrir Conferência'}
                        style={{ color: '#3b82f6' }}
                      >
                        <ClipboardCheck size={18} />
                      </button>
                      <button
                        onClick={() => navigate(`/operacoes/expedicao/minuta/${p.id}`)}
                        className="icon-btn"
                        title="Reimprimir Minuta"
                        style={{ color: '#14b8a6' }}
                      >
                        <Printer size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FilaExpedicao;
