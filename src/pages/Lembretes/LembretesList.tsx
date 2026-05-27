import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, MessageCircle, Calendar, Plus, Edit2 } from 'lucide-react';
import { collection, query, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import './Lembretes.css';

interface LembreteData {
  id: string;
  clienteNome: string;
  telefone: string;
  placa: string;
  modelo: string;
  ultimaRevisao: string;
  motivoLembrete: string;
  status?: string;
  dataPrevisao: any; 
  createdAt?: any;
}

const LembretesList: React.FC = () => {
  const navigate = useNavigate();
  const [lembretes, setLembretes] = useState<LembreteData[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'lembretes'), where('tenantId', '==', tenantId));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: LembreteData[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as LembreteData);
      });
      data.sort((a, b) => {
        const dateA = a.createdAt?.seconds || 0;
        const dateB = b.createdAt?.seconds || 0;
        return dateB - dateA;
      });
      setLembretes(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const formatWhatsAppMessage = (lembrete: LembreteData) => {
    return encodeURIComponent(
      `Olá, ${lembrete.clienteNome}! Tudo bem? Somos da Nexar ERP.\n\nVimos no nosso sistema que está chegando a hora do seu atendimento de retorno (${lembrete.motivoLembrete})${lembrete.modelo ? ` referente a ${lembrete.modelo}` : ''}.\n\nPodemos agendar um horário para você nesta semana?`
    );
  };

  const handleOpenWhatsApp = (lembrete: LembreteData) => {
    if (!lembrete.telefone) {
      alert("Este lembrete não possui telefone cadastrado.");
      return;
    }
    const text = formatWhatsAppMessage(lembrete);
    const numeroLimpo = lembrete.telefone.replace(/\D/g, '');
    window.open(`https://wa.me/55${numeroLimpo}?text=${text}`, '_blank');
  };

  const getStatusLembrete = (lembrete: LembreteData) => {
    if (lembrete.status === 'Cancelado') {
      return (
        <span className="status-badge" style={{ backgroundColor: '#6b728020', color: '#6b7280' }}>
          <span className="status-dot" style={{ backgroundColor: '#6b7280' }}></span>
          Cancelado
        </span>
      );
    }
    
    if (!lembrete.dataPrevisao) return <span>-</span>;
    
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    
    const dataPrev = lembrete.dataPrevisao.toDate ? lembrete.dataPrevisao.toDate() : new Date(lembrete.dataPrevisao);
    dataPrev.setHours(0,0,0,0);

    const diffTime = dataPrev.getTime() - hoje.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>
          <span className="status-dot" style={{ backgroundColor: '#ef4444' }}></span>
          Atrasado {Math.abs(diffDays)} dias
        </span>
      );
    } else if (diffDays === 0) {
      return (
        <span className="status-badge" style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}>
          <span className="status-dot" style={{ backgroundColor: '#f59e0b' }}></span>
          Vence Hoje
        </span>
      );
    } else {
      return (
        <span className="status-badge" style={{ backgroundColor: '#10b98120', color: '#10b981' }}>
          <span className="status-dot" style={{ backgroundColor: '#10b981' }}></span>
          Em {diffDays} dias
        </span>
      );
    }
  };

  return (
    <div className="lembretes-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Lembretes CRM</h1>
          <p className="page-subtitle">Aviso proativo de manutenção para seus clientes</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/crm/lembretes/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Novo Lembrete
        </button>
      </div>

      <div className="card list-container">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Buscar cliente ou placa..." />
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
                <th>Cliente</th>
                <th>Veículo</th>
                <th>Última Revisão</th>
                <th>Motivo Preventivo</th>
                <th>Status</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando lembretes...</td>
                </tr>
              ) : lembretes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Nenhum lembrete cadastrado.</td>
                </tr>
              ) : (
                lembretes.map((lembrete) => (
                  <tr key={lembrete.id}>
                    <td className="font-medium">{lembrete.clienteNome}</td>
                    <td>
                      {lembrete.modelo} <br />
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{lembrete.placa}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={14} color="var(--text-muted)" />
                        {lembrete.ultimaRevisao || '-'}
                      </div>
                    </td>
                    <td>{lembrete.motivoLembrete}</td>
                    <td>{getStatusLembrete(lembrete)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn-whatsapp"
                          onClick={() => handleOpenWhatsApp(lembrete)}
                        >
                          <MessageCircle size={16} />
                          WhatsApp
                        </button>
                        <button 
                          className="icon-btn"
                          onClick={() => navigate(`/crm/lembretes/editar/${lembrete.id}`)}
                          title="Editar/Excluir Lembrete"
                        >
                          <Edit2 size={16} />
                        </button>
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

export default LembretesList;
