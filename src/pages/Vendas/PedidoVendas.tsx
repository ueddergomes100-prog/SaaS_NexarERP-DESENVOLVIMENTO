import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, Search, FileText, Printer, Trash2 } from 'lucide-react';
import { collection, query, where, onSnapshot, deleteDoc, doc, getDoc, updateDoc, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { spedyService } from '../../services/spedyService';
import { isPlatformAdminRole } from '../../utils/roles';

interface ItemVenda {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
}

interface PedidoVendaData {
  id: string;
  numeroPedido: string;
  createdAt?: { seconds?: number; nanoseconds?: number };
  clienteNome?: string;
  formaPagamento?: string;
  status: string;
  valorTotal: number;
  itens?: ItemVenda[];
  tenantId: string;
}

const PedidoVendas: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();

  const canDeleteVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.excluir'));

  const [pedidos, setPedidos] = useState<PedidoVendaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('Ativos');

  // Estado para armazenar IDs dos cupons autorizados
  const [authorizedCupons, setAuthorizedCupons] = useState<Record<string, { spedyId: string; status: string }>>({});

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    // Monitora notas fiscais do tipo NFC-e
    const qNotas = query(
      collection(db, 'notas_fiscais'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'NFC-e')
    );

    const unsubscribeNotas = onSnapshot(qNotas, (snapshot) => {
      const cupons: Record<string, { spedyId: string; status: string }> = {};
      snapshot.forEach(d => {
        const data = d.data();
        if (data.pedidoId) {
          cupons[data.pedidoId] = {
            spedyId: data.spedyId || '',
            status: data.status || ''
          };
        }
      });
      setAuthorizedCupons(cupons);
    });

    return () => unsubscribeNotas();
  }, [currentUser, tenantId]);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    const q = query(
      collection(db, 'pedidos_venda'),
      where('tenantId', '==', tenantId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const p: PedidoVendaData[] = [];
      snapshot.forEach(doc => p.push({ id: doc.id, ...doc.data() } as PedidoVendaData));
      p.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setPedidos(p);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleDelete = async (pedido: PedidoVendaData) => {
    // Verifica se há nota fiscal ativa vinculada
    try {
      const qNotas = query(
        collection(db, 'notas_fiscais'),
        where('tenantId', '==', tenantId),
        where('pedidoId', '==', pedido.id)
      );
      const notasSnap = await getDocs(qNotas);
      const activeNotas = notasSnap.docs.filter(d => d.data().status !== 'canceled');

      if (activeNotas.length > 0) {
        const nota = activeNotas[0].data();
        await NexusSwal.fire({
          title: 'Não é possível excluir',
          text: `Existe uma nota fiscal ativa (${nota.tipo} nº ${nota.number || 'Aguardando'}) associada a este pedido. Cancele ou exclua a nota fiscal primeiro no painel fiscal.`,
          icon: 'error',
          confirmButtonText: 'Entendido'
        });
        return;
      }
    } catch (err) {
      console.error("Erro ao verificar notas vinculadas ao pedido:", err);
    }

    const confirm = await NexusSwal.fire({
      title: 'Excluir Pedido?',
      text: 'Se excluir, os relatórios serão afetados permanentemente. Deseja retornar o estoque dos produtos desta venda?',
      icon: 'warning',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Sim, retornar estoque',
      denyButtonText: 'Não, apenas excluir',
      cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed || confirm.isDenied) {
      try {
        if (confirm.isConfirmed && pedido.status !== 'Cancelada' && pedido.itens) {
          for (const item of pedido.itens) {
            if (item.id !== 'avulso') {
              try {
                const pecaRef = doc(db, 'estoque', item.id);
                const pecaSnap = await getDoc(pecaRef);
                if (pecaSnap.exists()) {
                  const atual = pecaSnap.data().quantidade || 0;
                  await updateDoc(pecaRef, { quantidade: atual + item.quantidade });
                }
              } catch (e) {
                console.error("Erro ao retornar estoque:", e);
              }
            }
          }
        }
        await deleteDoc(doc(db, 'pedidos_venda', pedido.id));
        try {
          await deleteDoc(doc(db, 'transacoes', pedido.id));
        } catch {
          // ignore error
        }

        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId: tenantId || '',
            usuarioId: currentUser?.uid || '',
            usuarioEmail: currentUser?.email || '',
            modulo: 'vendas',
            acao: 'exclusao',
            descricao: `Pedido de Venda #${pedido.numeroPedido} excluído permanentemente. Cliente: ${pedido.clienteNome || 'Geral'}. Valor: R$ ${(pedido.valorTotal || 0).toFixed(2)}.`,
            registroRelacionadoId: pedido.id,
            status: 'sucesso',
            critical: true
          });
        } catch {
          // ignore audit log error
        }

        showSuccess('Pedido excluído!');
      } catch {
        showError('Erro', 'Não foi possível excluir.');
      }
    }
  };

  const filteredPedidos = pedidos.filter(p => {
    const matchStatus = activeTab === 'Ativos' ? p.status !== 'Cancelada' : p.status === 'Cancelada';
    if (!matchStatus) return false;
    if (!searchTerm) return true;
    return p.clienteNome?.toLowerCase().includes(searchTerm.toLowerCase()) || p.numeroPedido?.includes(searchTerm);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingCart size={28} color="var(--accent-purple)" />
            Pedidos de Venda
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Gerenciamento de vendas diretas e PDV</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/pedidos-venda/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Nova Venda (PDV)
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>

        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por cliente ou número do pedido..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', backgroundColor: 'var(--bg-tertiary)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
            <button
              onClick={() => setActiveTab('Ativos')}
              style={{ padding: '8px 16px', backgroundColor: activeTab === 'Ativos' ? 'var(--accent-purple)' : 'transparent', color: activeTab === 'Ativos' ? 'white' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
            >
              Ativos / Faturados
            </button>
            <button
              onClick={() => setActiveTab('Cancelados')}
              style={{ padding: '8px 16px', backgroundColor: activeTab === 'Cancelados' ? 'rgba(239, 68, 68, 0.2)' : 'transparent', color: activeTab === 'Cancelados' ? '#ef4444' : 'var(--text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}
            >
              Cancelados
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Nº Pedido</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Cliente</th>
                <th style={{ padding: '16px' }}>Forma Pgto</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Total (R$)</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px' }}>Carregando pedidos...</td>
                </tr>
              ) : filteredPedidos.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <ShoppingCart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum pedido de venda encontrado.</p>
                  </td>
                </tr>
              ) : (
                filteredPedidos.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: p.status === 'Cancelada' ? 0.6 : 1 }}>
                    <td style={{ padding: '16px', fontWeight: 600 }}>#{p.numeroPedido}</td>
                    <td style={{ padding: '16px' }}>{p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-'}</td>
                    <td style={{ padding: '16px' }}>{p.clienteNome}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ backgroundColor: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
                        {p.formaPagamento}
                      </span>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        backgroundColor: p.status === 'Cancelada' ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)',
                        color: p.status === 'Cancelada' ? '#ef4444' : '#10b981',
                        padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600
                      }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.valorTotal)}
                    </td>
                    <td style={{ padding: '16px', display: 'flex', justifyContent: 'center', gap: '8px' }}>
                      <button onClick={() => navigate(`/pedidos-venda/visualizar/${p.id}`)} className="icon-btn" title="Visualizar Pedido" style={{ color: '#3b82f6' }}>
                        <FileText size={18} />
                      </button>
                      {authorizedCupons[p.id] && authorizedCupons[p.id].status === 'authorized' ? (
                        <button
                          onClick={() => {
                            const cupom = authorizedCupons[p.id];
                            spedyService.openFiscalFile(cupom.spedyId, 'consumer', 'pdf')
                              .catch(err => showError('Erro ao abrir cupom fiscal', (err as Error).message));
                          }}
                          className="icon-btn"
                          title="Imprimir Cupom Fiscal (NFC-e)"
                          style={{ color: '#8b5cf6' }}
                        >
                          <Printer size={18} />
                        </button>
                      ) : (
                        <button onClick={() => navigate(`/pedidos-venda/print/${p.id}`)} className="icon-btn" title="Imprimir Recibo" style={{ color: '#10b981' }}>
                          <Printer size={18} />
                        </button>
                      )}
                      {canDeleteVenda && (
                        <button onClick={() => handleDelete(p)} className="icon-btn" title="Excluir" style={{ color: '#ef4444' }}>
                          <Trash2 size={18} />
                        </button>
                      )}
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

export default PedidoVendas;
