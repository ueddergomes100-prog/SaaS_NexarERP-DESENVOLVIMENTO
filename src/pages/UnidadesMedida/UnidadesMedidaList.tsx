import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Scale, Edit, Trash2, X, Loader2, AlertTriangle } from 'lucide-react';
import { collection, query, onSnapshot, deleteDoc, doc, where, updateDoc, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { isPlatformAdminRole } from '../../utils/roles';

interface UnidadeData {
  id: string;
  sigla: string;
  nome: string;
  casasDecimais: number;
  permiteFracionado: boolean;
}

const UnidadesMedidaList: React.FC = () => {
  const [unidades, setUnidades] = useState<UnidadeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState({
    sigla: '',
    nome: '',
    casasDecimais: 0,
    permiteFracionado: false
  });
  const [modalLoading, setModalLoading] = useState(false);

  const { currentUser, tenantId, userRole, userPermissions, isOwner } = useAuth();
  const navigate = useNavigate();

  const canAccess = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('cadastros.unidades_medida'));

  useEffect(() => {
    if (!currentUser || !tenantId || !canAccess) return;
    const q = query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: UnidadeData[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as UnidadeData));
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setUnidades(data);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar unidades:", error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const handleDelete = async (id: string, sigla: string) => {
    const isConfirmed = await confirmDelete(`a unidade de medida (${sigla})`);
    if (isConfirmed) {
      try {
        await deleteDoc(doc(db, 'unidades_medida', id));
        showSuccess('Unidade de medida excluída!');
      } catch (error) {
        showError('Erro', 'Não foi possível excluir a unidade.');
      }
    }
  };

  const handleLoadDefaults = async () => {
    const isConfirmed = await NexusSwal.fire({
      title: 'Carregar Padrões?',
      text: 'Isso criará automaticamente as unidades básicas (UN, KG, LTS, MT).',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, criar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        const defaults = [
          { sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
          { sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
          { sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
          { sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true }
        ];

        for (const item of defaults) {
          // Evita duplicar se a sigla já existir
          const jaExiste = unidades.some(u => u.sigla.toUpperCase() === item.sigla);
          if (!jaExiste) {
            await addDoc(collection(db, 'unidades_medida'), {
              ...item,
              tenantId,
              createdAt: serverTimestamp()
            });
          }
        }
        showSuccess('Unidades de medida padrão adicionadas!');
      } catch (err) {
        showError('Erro', 'Ocorreu um erro ao carregar padrões.');
      } finally {
        setLoading(false);
      }
    }
  };

  const openNewModal = () => {
    setEditingId(null);
    setModalForm({
      sigla: '',
      nome: '',
      casasDecimais: 0,
      permiteFracionado: false
    });
    setIsModalOpen(true);
  };

  const openEditModal = (unidade: UnidadeData) => {
    setEditingId(unidade.id);
    setModalForm({
      sigla: unidade.sigla,
      nome: unidade.nome,
      casasDecimais: unidade.casasDecimais,
      permiteFracionado: unidade.permiteFracionado
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalForm.sigla || !modalForm.nome) {
      showError('Erro', 'Preencha todos os campos obrigatórios.');
      return;
    }

    setModalLoading(true);
    try {
      const docData = {
        sigla: modalForm.sigla.toUpperCase().trim(),
        nome: modalForm.nome.toUpperCase().trim(),
        casasDecimais: Number(modalForm.casasDecimais),
        permiteFracionado: modalForm.permiteFracionado,
        tenantId,
        updatedAt: serverTimestamp()
      };

      if (editingId) {
        await updateDoc(doc(db, 'unidades_medida', editingId), docData);
        showSuccess('Unidade de medida atualizada!');
      } else {
        // Verifica se a sigla já existe
        const jaExiste = unidades.some(u => u.sigla.toUpperCase() === docData.sigla);
        if (jaExiste) {
          showError('Sigla Duplicada', `A unidade com a sigla ${docData.sigla} já está cadastrada.`);
          setModalLoading(false);
          return;
        }

        await addDoc(collection(db, 'unidades_medida'), {
          ...docData,
          createdAt: serverTimestamp()
        });
        showSuccess('Unidade de medida cadastrada!');
      }
      closeModal();
    } catch (err) {
      console.error(err);
      showError('Erro', 'Não foi possível salvar a unidade de medida.');
    } finally {
      setModalLoading(false);
    }
  };

  const filteredUnidades = unidades.filter(u => 
    u.sigla.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!canAccess) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Você não possui permissão para gerenciar as unidades de medida. Solicite ao administrador da empresa para liberar o módulo "Cadastros: Unidades de Medida".
        </p>
        <button className="btn-primary" onClick={() => navigate('/dashboard')}>
          Ir para o Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Unidades de Medida</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Configuração de unidades para os produtos do estoque</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {unidades.length === 0 && (
            <button className="btn-secondary" onClick={handleLoadDefaults} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              Carregar Padrões
            </button>
          )}
          <button className="btn-primary" onClick={openNewModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Unidade
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar unidade..." 
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
                <th style={{ width: '15%' }}>Sigla</th>
                <th>Nome da Unidade</th>
                <th style={{ width: '20%' }}>Casas Decimais</th>
                <th style={{ width: '20%' }}>Venda Fracionada</th>
                <th style={{ width: '15%' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredUnidades.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <Scale size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhuma unidade de medida encontrada.</p>
                  </td>
                </tr>
              ) : (
                filteredUnidades.map((unidade) => (
                  <tr key={unidade.id}>
                    <td className="font-medium" style={{ color: 'var(--accent-purple)', fontWeight: 700 }}>{unidade.sigla}</td>
                    <td className="font-medium">{unidade.nome}</td>
                    <td>{unidade.casasDecimais} {unidade.casasDecimais === 1 ? 'casa' : 'casas'}</td>
                    <td>
                      <span className="status-badge" style={{ 
                        backgroundColor: unidade.permiteFracionado ? '#10b98120' : 'rgba(255,255,255,0.05)', 
                        color: unidade.permiteFracionado ? '#10b981' : 'var(--text-muted)' 
                      }}>
                        {unidade.permiteFracionado ? 'Fracionada' : 'Inteira'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openEditModal(unidade)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(unidade.id, unidade.sigla)}>
                          <Trash2 size={16} />
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

      {/* Modal Dialog */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            position: 'relative',
            boxShadow: 'var(--shadow-card)',
            animation: 'pageFadeIn 0.2s ease-out'
          }}>
            <button 
              onClick={closeModal}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer'
              }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Scale size={20} color="#8b5cf6" />
              {editingId ? 'Editar Unidade de Medida' : 'Nova Unidade de Medida'}
            </h3>

            <form onSubmit={handleSave}>
              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Sigla *</label>
                <input 
                  type="text" 
                  placeholder="Ex: KG, UN, LTS" 
                  value={modalForm.sigla}
                  onChange={(e) => setModalForm({ ...modalForm, sigla: e.target.value.toUpperCase() })}
                  required
                  maxLength={6}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da Unidade *</label>
                <input 
                  type="text" 
                  placeholder="Ex: Quilograma, Unidade, Litro" 
                  value={modalForm.nome}
                  onChange={(e) => setModalForm({ ...modalForm, nome: e.target.value })}
                  required
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Quantidade de Casas Decimais</label>
                <select 
                  className="form-select"
                  value={modalForm.casasDecimais}
                  onChange={(e) => {
                    const dec = Number(e.target.value);
                    setModalForm({ 
                      ...modalForm, 
                      casasDecimais: dec,
                      // Se casas > 0, permite fracionado automaticamente para ajudar o usuário
                      permiteFracionado: dec > 0 ? true : modalForm.permiteFracionado
                    });
                  }}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                >
                  <option value={0}>0 (Ex: 10 unidades)</option>
                  <option value={1}>1 (Ex: 10,5 unidades)</option>
                  <option value={2}>2 (Ex: 10,50 metros)</option>
                  <option value={3}>3 (Ex: 10,500 quilogramas)</option>
                  <option value={4}>4 (Ex: 10,5000 precisão)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px', marginBottom: '24px' }}>
                <input 
                  type="checkbox" 
                  id="permiteFracionado"
                  checked={modalForm.permiteFracionado}
                  onChange={(e) => setModalForm({ ...modalForm, permiteFracionado: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="permiteFracionado" style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Permitir venda fracionada (decimais)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={modalLoading}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={modalLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {modalLoading && <Loader2 size={16} className="spin-icon" />}
                  {modalLoading ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UnidadesMedidaList;
