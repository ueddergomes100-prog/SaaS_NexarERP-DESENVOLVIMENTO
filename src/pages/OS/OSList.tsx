import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Printer, Edit, MessageCircle, Trash2 } from 'lucide-react';
import { collection, query, onSnapshot, where, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import './OS.css';

interface OSData {
  id: string;
  numeroOS?: string;
  clienteNome: string;
  modelo: string;
  placa: string;
  status: string;
  statusColor: string;
  createdAt: any;
  clienteTelefone?: string;
  total?: number;
}

const OSList: React.FC = () => {
  const navigate = useNavigate();
  const [osList, setOsList] = useState<OSData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'Ativas' | 'Finalizadas' | 'Canceladas'>('Ativas');
  const [searchTerm, setSearchTerm] = useState('');
  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();

  const canEditOS = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('mecanica.os_alterar'));
  const canDeleteOS = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('mecanica.os_excluir'));

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const osData: OSData[] = [];
      querySnapshot.forEach((doc) => {
        osData.push({ id: doc.id, ...doc.data() } as OSData);
      });
      // Sort in Javascript to avoid composite index requirement
      osData.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setOsList(osData);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar OS:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handleOpenWhatsApp = (os: OSData) => {
    if (!os.clienteTelefone) {
      alert("Esta Ordem de Serviço não possui telefone de cliente vinculado.");
      return;
    }
    
    // Limpar telefone (remover não numéricos)
    const telLimpado = os.clienteTelefone.replace(/\D/g, '');
    if (telLimpado.length < 10) {
      alert("Número de telefone inválido.");
      return;
    }

    const mensagem = encodeURIComponent(
      `Olá, ${os.clienteNome}! Tudo bem?\n\n` +
      `Somos da Nexar ERP. Gostaríamos de atualizar sobre o serviço do seu ${os.modelo || 'veículo'} (Placa: ${os.placa.toUpperCase()}).\n` +
      `O status atual da sua OS #${os.numeroOS || os.id.substring(0,8).toUpperCase()} é: *${os.status}*.\n\n` +
      `Acesse seu orçamento/OS neste link: (Link do PDF aqui)`
    );

    window.open(`https://wa.me/55${telLimpado}?text=${mensagem}`, '_blank');
  };

  const handleDeleteOS = async (osId: string) => {
    const confirm = await NexusSwal.fire({
      title: 'Excluir Definitivamente?',
      text: 'Esta ação removerá a OS do sistema para sempre. Não pode ser desfeita.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444'
    });

    if (confirm.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'ordens_de_servico', osId));
        try {
          await deleteDoc(doc(db, 'transacoes', osId));
        } catch(e) {}
        showSuccess('OS excluída com sucesso!');
      } catch(err) {
        showError('Erro', 'Não foi possível excluir a Ordem de Serviço.');
      }
    }
  };

  const filteredOsList = osList.filter(os => {
    const matchesTab = activeTab === 'Canceladas'
      ? os.status === 'Cancelada'
      : activeTab === 'Finalizadas'
        ? os.status === 'Finalizada'
        : os.status !== 'Cancelada' && os.status !== 'Finalizada';

    if (!matchesTab) return false;
    if (!searchTerm) return true;

    const term = searchTerm.toLowerCase();
    return (
      (os.clienteNome && os.clienteNome.toLowerCase().includes(term)) ||
      (os.placa && os.placa.toLowerCase().includes(term)) ||
      (os.numeroOS && os.numeroOS.toLowerCase().includes(term))
    );
  });

  return (
    <div className="os-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ordens de Serviço</h1>
          <p className="page-subtitle">Gerencie ordens de serviço e atendimentos da empresa</p>
        </div>
        <button 
          className="btn-primary"
          onClick={() => navigate('/os/nova')}
        >
          <Plus size={18} style={{ marginRight: 8 }} />
          Nova OS
        </button>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
        <button 
          onClick={() => setActiveTab('Ativas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Ativas' ? 'var(--accent-purple)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Em Andamento
        </button>
        <button 
          onClick={() => setActiveTab('Finalizadas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Finalizadas' ? '#10b981' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Finalizadas
        </button>
        <button 
          onClick={() => setActiveTab('Canceladas')}
          style={{ 
            padding: '10px 20px', 
            borderRadius: 'var(--radius-md)', 
            border: 'none', 
            cursor: 'pointer',
            backgroundColor: activeTab === 'Canceladas' ? '#ef4444' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600
          }}
        >
          Canceladas
        </button>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input 
              type="text" 
              placeholder="Buscar por placa, cliente ou nº OS..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn-secondary filter-btn">
            <Filter size={18} style={{ marginRight: 8 }} />
            Filtros
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nº OS</th>
                <th>Cliente</th>
                <th>Veículo</th>
                <th>Placa</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando Ordens de Serviço...</td>
                </tr>
              ) : filteredOsList.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>
                    {searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : "Nenhuma Ordem de Serviço encontrada nesta aba."}
                  </td>
                </tr>
              ) : (
                filteredOsList.map((os) => (
                  <tr key={os.id}>
                    <td className="font-medium" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
                      #{os.numeroOS || os.id.substring(0, 8).toUpperCase()}
                    </td>
                    <td>{os.clienteNome}</td>
                    <td>{os.modelo || '-'}</td>
                    <td style={{ textTransform: 'uppercase' }}>{os.placa}</td>
                    <td>
                      <span className="status-badge" style={{ backgroundColor: `${os.statusColor}20`, color: os.statusColor }}>
                        <span className="status-dot" style={{ backgroundColor: os.statusColor }}></span>
                        {os.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="icon-btn" 
                          onClick={() => handleOpenWhatsApp(os)}
                          title="Enviar por WhatsApp"
                          style={{ color: '#10b981' }}
                        >
                          <MessageCircle size={18} />
                        </button>
                        {canEditOS && (
                          <button 
                            className="icon-btn" 
                            onClick={() => navigate(`/os/editar/${os.id}`)}
                            title="Editar OS"
                          >
                            <Edit size={18} />
                          </button>
                        )}
                        <button 
                          className="icon-btn" 
                          onClick={() => navigate(`/os/print/${os.id}`)}
                          title="Imprimir OS"
                        >
                          <Printer size={18} />
                        </button>
                        {os.status === 'Cancelada' && canDeleteOS && (
                          <button 
                            className="icon-btn" 
                            onClick={() => handleDeleteOS(os.id)}
                            title="Excluir Definitivamente"
                            style={{ color: '#ef4444' }}
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
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

export default OSList;
