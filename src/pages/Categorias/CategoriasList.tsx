import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, Tags, Edit, Trash2 } from 'lucide-react';
import { collection, query, onSnapshot, deleteDoc, doc, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { confirmDelete, showSuccess, showError, NexusSwal } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardFlow';
import '../OS/OS.css';

interface CategoriaData {
  id: string;
  nome: string;
  tipo: string;
}

const CategoriasList: React.FC = () => {
  const navigate = useNavigate();
  const [categorias, setCategorias] = useState<CategoriaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { currentUser, tenantId } = useAuth();

  useKeyboardShortcuts([
    { key: 'F2', handler: () => searchInputRef.current?.focus() },
    { key: 'F6', handler: () => navigate('/categorias/nova') },
  ]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: CategoriaData[] = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() } as CategoriaData));
      data.sort((a, b) => a.nome.localeCompare(b.nome));
      setCategorias(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser]);

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirmDelete('esta categoria');
    if (isConfirmed) {
      try {
        await deleteDoc(doc(db, 'categorias', id));
        showSuccess('Categoria excluída!');
      } catch (error) {
        showError('Erro', 'Não foi possível excluir a categoria.');
      }
    }
  };

  const handleFixNames = async () => {
    if (!currentUser) return;
    const isConfirmed = await NexusSwal.fire({
      title: 'Padronizar Nomes?',
      text: 'Isto converterá o nome de TODAS as categorias para MAIÚSCULAS.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, padronizar agora'
    });

    if (isConfirmed.isConfirmed) {
      setLoading(true);
      try {
        let count = 0;
        for (const c of categorias) {
          const upName = c.nome.toUpperCase().trim();
          if (c.nome !== upName) {
            await updateDoc(doc(db, 'categorias', c.id), {
              nome: upName,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Nome padronizado para maiúsculas'),
            });
            count++;
          }
        }
        showSuccess(`Pronto! ${count} categorias foram atualizadas.`);
      } catch(err) {
        showError('Erro', 'Ocorreu um erro na migração.');
      } finally {
        setLoading(false);
      }
    }
  };

  const filteredCategorias = categorias.filter((cat) => cat.nome.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Categorias</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Classificação de produtos e serviços</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={handleFixNames} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            Padronizar (A-Z)
          </button>
          <button className="btn-primary" onClick={() => navigate('/categorias/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Categoria
          </button>
        </div>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar categoria..."
              ref={searchInputRef}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="shortcuts-hint">
            <span><kbd>F2</kbd> Buscar</span>
            <span><kbd>F6</kbd> Nova</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome da Categoria</th>
                <th>Tipo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : filteredCategorias.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}><Tags size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} /><p>Nenhuma categoria encontrada.</p></td></tr>
              ) : (
                filteredCategorias.map((cat) => (
                  <tr key={cat.id}>
                    <td className="font-medium">{cat.nome}</td>
                    <td>
                      <span className="status-badge" style={{ backgroundColor: cat.tipo === 'Serviço' ? '#8b5cf620' : '#10b98120', color: cat.tipo === 'Serviço' ? '#8b5cf6' : '#10b981' }}>
                        {cat.tipo}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="icon-btn" title="Editar" onClick={() => navigate(`/categorias/editar/${cat.id}`)}>
                          <Edit size={16} />
                        </button>
                        <button className="icon-btn" title="Excluir" style={{ color: '#ef4444' }} onClick={() => handleDelete(cat.id)}>
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

export default CategoriasList;
