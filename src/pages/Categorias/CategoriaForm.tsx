import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Tags, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

const CategoriaForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [formData, setFormData] = useState({
    nome: '',
    tipo: 'Peça',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    if (isEditing && id) {
      const fetchDoc = async () => {
        try {
          const docSnap = await getDoc(doc(db, 'categorias', id));
          if (docSnap.exists()) {
            setFormData(docSnap.data() as any);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setIsFetching(false);
        }
      };
      fetchDoc();
    }
  }, [id, isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome) {
      showError('Campos incompletos', 'Nome da categoria é obrigatório.');
      return;
    }
    
    setIsLoading(true);
    try {
      const dataToSave = {
        ...formData,
        nome: formData.nome.toUpperCase().trim()
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'categorias', id), {
          ...dataToSave,
          updatedAt: serverTimestamp()
        });
        showSuccess('Categoria atualizada!');
      } else {
        if (!currentUser) return;
        await addDoc(collection(db, 'categorias'), {
          ...dataToSave,
          tenantId,
          createdAt: serverTimestamp()
        });
        showSuccess('Categoria cadastrada!');
      }
      navigate('/categorias');
    } catch (error) {
      console.error(error);
      showError('Erro ao salvar', 'Ocorreu um erro ao salvar a categoria.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/categorias')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Nova Categoria</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Adicione uma categoria para organizar o sistema</p>
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
          {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'Salvar Categoria'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Tags size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados da Categoria</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da Categoria *</label>
              <input type="text" name="nome" placeholder="Ex: SUSPENSÃO, ÓLEOS, MÃO DE OBRA..." value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tipo *</label>
              <select name="tipo" value={formData.tipo} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}>
                <option value="Peça">Peça / Produto</option>
                <option value="Serviço">Serviço</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategoriaForm;
