import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, Plus, Search, Filter, Edit2, Trash2, 
  CheckCircle, XCircle, Wrench, Share2, Printer, ShoppingCart 
} from 'lucide-react';
import { collection, query, where, getDocs, deleteDoc, doc, updateDoc, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';

interface Orcamento {
  id: string;
  numeroOrcamento: string;
  clienteNome: string;
  placa?: string;
  modelo?: string;
  valorTotal: number;
  status: string;
  createdAt: any;
  servicos?: any[];
  pecas?: any[];
  clienteTelefone?: string;
}

const Orcamentos: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, userRole, userPermissions, isOwner } = useAuth();
  const [orcamentos, setOrcamentos] = useState<Orcamento[]>([]);

  const canEditOrcamento = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.orcamentos_alterar'));
  const canDeleteOrcamento = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.orcamentos_excluir'));
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchOrcamentos = async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const q = query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId));
      const querySnapshot = await getDocs(q);
      const data: Orcamento[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Orcamento);
      });
      setOrcamentos(data.sort((a, b) => b.numeroOrcamento.localeCompare(a.numeroOrcamento)));
    } catch (error) {
      console.error("Erro ao buscar orçamentos:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrcamentos();
  }, [tenantId]);

  const handleDelete = async (id: string) => {
    const confirm = await NexusSwal.fire({
      title: 'Excluir Orçamento?',
      text: 'Esta ação não pode ser desfeita.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444'
    });

    if (confirm.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'orcamentos', id));
        showSuccess('Orçamento excluído!');
        fetchOrcamentos();
      } catch (error) {
        showError('Erro', 'Não foi possível excluir.');
      }
    }
  };

  const handleShareWhatsApp = (orcamento: Orcamento) => {
    const texto = `Olá! Segue o seu orçamento *#${orcamento.numeroOrcamento}* da *Nexar ERP*.\n\n` +
      `*Cliente:* ${orcamento.clienteNome}\n` +
      `*Total:* R$ ${orcamento.valorTotal.toFixed(2)}\n\n` +
      `Aguardamos sua aprovação!`;
    const fone = orcamento.clienteTelefone?.replace(/\D/g, '') || '';
    const url = `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  };

  const filteredOrcamentos = orcamentos.filter(o => 
    o.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()) || 
    o.numeroOrcamento.includes(searchTerm)
  );

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'Aprovado': return { bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981' };
      case 'Recusado': return { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' };
      case 'Convertido': 
      case 'Finalizado': return { bg: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' };
      default: return { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={28} color="var(--accent-purple)" />
            Orçamentos
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>Gerenciamento de propostas comerciais e orçamentos</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/orcamentos/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Novo Orçamento
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div className="search-bar" style={{ flex: 1, position: 'relative' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar por cliente ou número..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 16px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}>
            <Filter size={20} /> Filtros
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '16px' }}>Nº</th>
                <th style={{ padding: '16px' }}>Cliente / Veículo</th>
                <th style={{ padding: '16px' }}>Data</th>
                <th style={{ padding: '16px' }}>Valor Total</th>
                <th style={{ padding: '16px' }}>Status</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</td>
                </tr>
              ) : filteredOrcamentos.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum orçamento encontrado.</p>
                  </td>
                </tr>
              ) : (
                filteredOrcamentos.map((orc) => {
                  const style = getStatusStyle(orc.status);
                  return (
                    <tr key={orc.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '16px', fontWeight: 600 }}>#{orc.numeroOrcamento}</td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ fontWeight: 600 }}>{orc.clienteNome}</div>
                        {orc.placa && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{orc.modelo} - {orc.placa}</div>}
                      </td>
                      <td style={{ padding: '16px', color: 'var(--text-muted)' }}>
                        {orc.createdAt?.toDate ? orc.createdAt.toDate().toLocaleDateString('pt-BR') : '---'}
                      </td>
                      <td style={{ padding: '16px', fontWeight: 700, color: 'var(--accent-purple)' }}>
                        R$ {orc.valorTotal.toFixed(2)}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <span style={{ 
                          padding: '4px 12px', 
                          borderRadius: '20px', 
                          fontSize: '12px', 
                          fontWeight: 600,
                          backgroundColor: style.bg,
                          color: style.color
                        }}>
                          {orc.status}
                        </span>
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button 
                            title="Compartilhar WhatsApp"
                            onClick={() => handleShareWhatsApp(orc)}
                            style={{ padding: '8px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: 'none', cursor: 'pointer' }}
                          >
                            <Share2 size={18} />
                          </button>
                          <button 
                            title="Imprimir"
                            onClick={() => navigate(`/orcamentos/print/${orc.id}`)}
                            style={{ padding: '8px', borderRadius: '8px', background: 'var(--bg-tertiary)', color: '#3b82f6', border: 'none', cursor: 'pointer' }}
                          >
                            <Printer size={18} />
                          </button>
                          {canEditOrcamento && (
                            <button 
                              title="Editar"
                              onClick={() => navigate(`/orcamentos/editar/${orc.id}`)}
                              style={{ padding: '8px', borderRadius: '8px', background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: 'none', cursor: 'pointer' }}
                            >
                              <Edit2 size={18} />
                            </button>
                          )}
                          {canDeleteOrcamento && (
                            <button 
                              title="Excluir"
                              onClick={() => handleDelete(orc.id)}
                              style={{ padding: '8px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'none', cursor: 'pointer' }}
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Orcamentos;
