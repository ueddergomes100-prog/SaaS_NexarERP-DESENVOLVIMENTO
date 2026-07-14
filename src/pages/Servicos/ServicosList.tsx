import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Wrench, Edit, Trash2 } from 'lucide-react';
import { collection, query, onSnapshot, deleteDoc, doc, where, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';

interface ServicoData {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  preco: number;
}

const ServicosList: React.FC = () => {
  const navigate = useNavigate();
  const [servicos, setServicos] = useState<ServicoData[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: ServicoData[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as ServicoData));
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setServicos(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDelete('este serviço');
    if (isConfirmed) {
      try {
        await deleteDoc(doc(db, 'servicos', id));
        showSuccess('Serviço excluído!');
      } catch (error) {
        showError('Erro', 'Não foi possível excluir o serviço.');
      }
    }
  };

  const handleFixNames = async () => {
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODOS os serviços para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        let count = 0;
        for (const s of servicos) {
          const upName = s.nome.toUpperCase().trim();
          if (s.nome !== upName) {
            await updateDoc(doc(db, 'servicos', s.id), { nome: upName });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} serviços foram atualizados.`);
      } catch(err) {
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Serviços</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Catálogo de mão de obra e pacotes</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleFixNames} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            Padronizar (A-Z)
          </button>
          <button className="btn-primary" onClick={() => navigate('/servicos/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo Serviço
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Buscar serviço..." 
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome do Serviço</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Valor / Hora</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : servicos.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}><Wrench size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} /><p>Nenhum serviço cadastrado.</p></td></tr>
              ) : (
                servicos.map((servico) => (
                  <tr key={servico.id}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{servico.codigo || '-'}</td>
                    <td className="font-medium">{servico.nome}</td>
                    <td>{servico.categoria || '-'}</td>
                    <td style={{ textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(servico.preco || 0)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => navigate(`/servicos/editar/${servico.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(servico.id)}>
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
    </div>
  );
};

export default ServicosList;
