import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Search, Edit, Trash2, Car, MapPin, Calendar, Hash } from 'lucide-react';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';
import '../OS/OS.css'; // Reusing OS styles

interface Veiculo {
  id: string;
  placa: string;
  modelo: string;
  marca?: string;
  ano: string;
  cor: string;
  kmAtual?: number;
  clienteId: string;
  clienteNome?: string;
  tenantId: string;
}

const VeiculosList: React.FC = () => {
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const { tenantId, userPermissions, userRole, isOwner } = useAuth();
  
  const canEdit = isOwner || isPlatformAdminRole(userRole) || userPermissions?.includes('cadastros.clientes');

  const fetchVeiculos = async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const q = query(
        collection(db, 'veiculos'),
        where('tenantId', '==', tenantId)
      );
      const querySnapshot = await getDocs(q);
      const data: Veiculo[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Veiculo);
      });
      // Fallback local sort since we might not have a composite index for placa or createdAt yet
      data.sort((a, b) => a.placa.localeCompare(b.placa));
      setVeiculos(data);
    } catch (error) {
      console.error("Erro ao buscar veículos:", error);
      showError('Erro', 'Não foi possível carregar os veículos.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVeiculos();
  }, [tenantId]);

  const handleDelete = async (id: string, placa: string) => {
    if (!canEdit) {
      showError('Acesso Negado', 'Você não tem permissão para excluir veículos.');
      return;
    }
    
    const confirm = await NexusSwal.fire({
      title: 'Excluir Veículo?',
      text: `Tem certeza que deseja excluir o veículo placa ${placa}? Esta ação não pode ser desfeita.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Sim, excluir',
      cancelButtonText: 'Cancelar'
    });

    if (confirm.isConfirmed) {
      try {
        await deleteDoc(doc(db, 'veiculos', id));
        showSuccess('Veículo excluído com sucesso!');
        setVeiculos(veiculos.filter(v => v.id !== id));
      } catch (error) {
        showError('Erro', 'Não foi possível excluir o veículo.');
      }
    }
  };

  const filteredVeiculos = veiculos.filter(v => 
    v.placa.toLowerCase().includes(searchTerm.toLowerCase()) ||
    v.modelo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.clienteNome && v.clienteNome.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="os-page">
      <div className="page-header">
        <div className="header-title-group">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Car size={28} color="var(--accent-purple)" />
              Cadastro de Veículos
            </h1>
            <p className="page-subtitle">Gerencie veículos vinculados aos clientes quando aplicável ao seu negócio</p>
          </div>
        </div>
        <div className="header-actions">
          {canEdit && (
            <button className="btn-primary" onClick={() => navigate('/veiculos/novo')}>
              <Plus size={20} />
              Novo Veículo
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="search-bar" style={{ marginBottom: '24px', position: 'relative' }}>
          <Search className="search-icon" size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Buscar por placa, modelo ou dono do veículo..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ 
              width: '100%', 
              padding: '14px 14px 14px 48px', 
              backgroundColor: 'var(--bg-tertiary)', 
              border: '1px solid var(--border-color)', 
              borderRadius: 'var(--radius-md)', 
              color: 'var(--text-primary)',
              fontSize: '15px'
            }}
          />
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' }}>
            <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
            <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Carregando frota...</p>
          </div>
        ) : filteredVeiculos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
            <Car size={48} style={{ opacity: 0.2, margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '18px', color: 'var(--text-primary)', marginBottom: '8px' }}>Nenhum veículo encontrado</h3>
            <p>Não há veículos cadastrados ou a busca não retornou resultados.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="nexus-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '16px' }}>Placa / Modelo</th>
                  <th style={{ padding: '16px' }}>Dono (Cliente)</th>
                  <th style={{ padding: '16px', textAlign: 'center' }}>Ano/Cor</th>
                  <th style={{ padding: '16px', textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredVeiculos.map(veiculo => (
                  <tr key={veiculo.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <td style={{ padding: '16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 700, fontSize: '16px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Hash size={14} /> {veiculo.placa}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>
                          {veiculo.marca ? `${veiculo.marca} ` : ''}{veiculo.modelo}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <span style={{ fontWeight: 500 }}>{veiculo.clienteNome || 'Desconhecido'}</span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}><Calendar size={14} color="var(--text-muted)"/> {veiculo.ano || '-'}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', color: 'var(--text-muted)' }}><MapPin size={14}/> {veiculo.cor || '-'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {canEdit && (
                          <>
                            <button 
                              className="icon-btn edit-btn" 
                              onClick={() => navigate(`/veiculos/editar/${veiculo.id}`)}
                              title="Editar Veículo"
                              style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '8px', borderRadius: '8px' }}
                            >
                              <Edit size={18} />
                            </button>
                            <button 
                              className="icon-btn delete-btn" 
                              onClick={() => handleDelete(veiculo.id, veiculo.placa)}
                              title="Excluir Veículo"
                              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px', borderRadius: '8px' }}
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default VeiculosList;
