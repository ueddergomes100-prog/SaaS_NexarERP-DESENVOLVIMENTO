import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, CreditCard, Edit, Trash2, X, Loader2, AlertTriangle } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { hasModuleAccess } from '../../utils/roles';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import { pickMissingDefaults } from '../../utils/catalogDefaults';

interface BandeiraCartao extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
}

const BANDEIRAS_PADRAO: Array<Pick<BandeiraCartao, 'nome' | 'ativo' | 'ordem'>> = [
  { nome: 'Visa', ativo: true, ordem: 1 },
  { nome: 'Mastercard', ativo: true, ordem: 2 },
  { nome: 'Elo', ativo: true, ordem: 3 },
  { nome: 'Hipercard', ativo: true, ordem: 4 },
  { nome: 'American Express', ativo: true, ordem: 5 },
];

const REQUIRED_PERMISSION = 'cadastros.bandeiras_cartao';

const BandeirasCartaoList: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, userRole, userPermissions, isOwner } = useAuth();
  const canAccess = hasModuleAccess({
    role: userRole,
    isOwner,
    permissions: userPermissions,
    requiredPermission: REQUIRED_PERMISSION,
  });

  const { items: bandeiras, loading } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId, {
    sortField: 'ordem',
    enabled: canAccess,
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalForm, setModalForm] = useState({ nome: '', ativo: true, ordem: 1 });
  const [modalLoading, setModalLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  const handleDelete = async (id: string, nome: string) => {
    const isConfirmed = await confirmDelete(`a bandeira (${nome})`);
    if (!isConfirmed) return;

    try {
      await deleteDoc(doc(db, 'bandeiras_cartao', id));
      showSuccess('Bandeira excluída!');
    } catch (error) {
      console.error(error);
      showError('Erro', 'Não foi possível excluir a bandeira.');
    }
  };

  const handleLoadDefaults = async () => {
    const missing = pickMissingDefaults(BANDEIRAS_PADRAO, bandeiras, 'nome');
    if (missing.length === 0) {
      showSuccess('As bandeiras padrão já estão cadastradas.');
      return;
    }

    const confirmation = await NexusSwal.fire({
      title: 'Carregar Padrões?',
      text: `Isso criará: ${missing.map((item) => item.nome).join(', ')}.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, criar agora',
    });
    if (!confirmation.isConfirmed) return;

    setIsSeeding(true);
    try {
      for (const item of missing) {
        await addDoc(collection(db, 'bandeiras_cartao'), {
          ...item,
          tenantId,
          createdAt: serverTimestamp(),
        });
      }
      showSuccess('Bandeiras padrão adicionadas!');
    } catch (error) {
      console.error(error);
      showError('Erro', 'Ocorreu um erro ao carregar as bandeiras padrão.');
    } finally {
      setIsSeeding(false);
    }
  };

  const openNewModal = () => {
    setEditingId(null);
    setModalForm({ nome: '', ativo: true, ordem: bandeiras.length + 1 });
    setIsModalOpen(true);
  };

  const openEditModal = (bandeira: BandeiraCartao) => {
    setEditingId(bandeira.id);
    setModalForm({ nome: bandeira.nome, ativo: bandeira.ativo, ordem: bandeira.ordem });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalForm.nome.trim()) {
      showError('Erro', 'Informe o nome da bandeira.');
      return;
    }

    setModalLoading(true);
    try {
      const docData = {
        nome: modalForm.nome.trim(),
        ativo: modalForm.ativo,
        ordem: Number(modalForm.ordem) || 0,
        tenantId,
        updatedAt: serverTimestamp(),
      };

      if (editingId) {
        await updateDoc(doc(db, 'bandeiras_cartao', editingId), docData);
        showSuccess('Bandeira atualizada!');
      } else {
        const jaExiste = bandeiras.some((b) => b.nome.toUpperCase() === docData.nome.toUpperCase());
        if (jaExiste) {
          showError('Bandeira Duplicada', `A bandeira "${docData.nome}" já está cadastrada.`);
          setModalLoading(false);
          return;
        }

        await addDoc(collection(db, 'bandeiras_cartao'), { ...docData, createdAt: serverTimestamp() });
        showSuccess('Bandeira cadastrada!');
      }
      closeModal();
    } catch (error) {
      console.error(error);
      showError('Erro', 'Não foi possível salvar a bandeira.');
    } finally {
      setModalLoading(false);
    }
  };

  const filteredBandeiras = bandeiras.filter((b) => b.nome.toLowerCase().includes(searchTerm.toLowerCase()));

  if (!canAccess) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', padding: '20px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '20px' }}>
          <AlertTriangle size={48} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>Acesso Negado</h2>
        <p style={{ color: 'var(--text-muted)', maxWidth: '500px', margin: '0 auto 24px' }}>
          Você não possui permissão para gerenciar as bandeiras de cartão. Solicite ao administrador da empresa para liberar o módulo "Cadastros: Bandeiras de Cartão".
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
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Bandeiras de Cartão</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Bandeiras disponíveis para seleção em vendas e ordens de serviço</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleLoadDefaults} disabled={isSeeding} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            {isSeeding ? <Loader2 size={14} className="spin-icon" /> : null}
            Carregar Padrões
          </button>
          <button className="btn-primary" onClick={openNewModal} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Bandeira
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar bandeira..."
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
                <th style={{ width: '15%' }}>Ordem</th>
                <th>Nome</th>
                <th style={{ width: '20%' }}>Status</th>
                <th style={{ width: '15%' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredBandeiras.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    <CreditCard size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhuma bandeira encontrada.</p>
                  </td>
                </tr>
              ) : (
                filteredBandeiras.map((bandeira) => (
                  <tr key={bandeira.id}>
                    <td>{bandeira.ordem}</td>
                    <td className="font-medium">{bandeira.nome}</td>
                    <td>
                      <span className="status-badge" style={{
                        backgroundColor: bandeira.ativo ? '#10b98120' : 'rgba(255,255,255,0.05)',
                        color: bandeira.ativo ? '#10b981' : 'var(--text-muted)',
                      }}>
                        {bandeira.ativo ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => openEditModal(bandeira)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(bandeira.id, bandeira.nome)}>
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

      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '440px', backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
            padding: '24px', position: 'relative', boxShadow: 'var(--shadow-card)',
            animation: 'pageFadeIn 0.2s ease-out',
          }}>
            <button
              onClick={closeModal}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>

            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CreditCard size={20} color="#8b5cf6" />
              {editingId ? 'Editar Bandeira' : 'Nova Bandeira'}
            </h3>

            <form onSubmit={handleSave}>
              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome *</label>
                <input
                  type="text"
                  placeholder="Ex: Visa, Mastercard"
                  value={modalForm.nome}
                  onChange={(e) => setModalForm({ ...modalForm, nome: e.target.value })}
                  required
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="input-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ordem de exibição</label>
                <input
                  type="number"
                  min="1"
                  value={modalForm.ordem}
                  onChange={(e) => setModalForm({ ...modalForm, ordem: Number(e.target.value) })}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '20px', marginBottom: '24px' }}>
                <input
                  type="checkbox"
                  id="bandeiraAtiva"
                  checked={modalForm.ativo}
                  onChange={(e) => setModalForm({ ...modalForm, ativo: e.target.checked })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <label htmlFor="bandeiraAtiva" style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Ativa (disponível para seleção em novas vendas)
                </label>
              </div>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 20px' }}>
                Desativar uma bandeira não afeta vendas antigas: o valor gravado continua sendo exibido no histórico normalmente.
              </p>

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

export default BandeirasCartaoList;
