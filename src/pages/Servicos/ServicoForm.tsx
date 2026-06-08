import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Wrench, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

const ServicoForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    categoria: '',
    preco: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (!currentUser) return;

        // Fetch Categorias
        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          if (d.data().tipo === 'Serviço') cats.push(d.data().nome);
        });
        setCategoriasDB(cats);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'servicos', id));
          if (docSnap.exists()) {
            setFormData(docSnap.data() as any);
          }
        } else {
          // Gerar código sequencial para novo cadastro
          const q = query(collection(db, 'servicos'), where('tenantId', '==', tenantId));
          const snap = await getCountFromServer(q);
          const nextId = snap.data().count + 1;
          setFormData(prev => ({ ...prev, codigo: String(nextId) }));
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome || !formData.preco) {
      showError('Campos incompletos', 'Nome e valor por hora são obrigatórios.');
      return;
    }
    
    setIsLoading(true);
    try {
      const dataToSave = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        preco: Number(String(formData.preco).replace(',','.'))
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'servicos', id), {
          ...dataToSave,
          updatedAt: serverTimestamp()
        });
        showSuccess('Serviço atualizado!');
      } else {
        if (!currentUser) return;
        await addDoc(collection(db, 'servicos'), {
          ...dataToSave,
          tenantId,
          createdAt: serverTimestamp()
        });
        showSuccess('Serviço cadastrado!');
      }
      navigate('/servicos');
    } catch (error) {
      console.error(error);
      showError('Erro ao salvar', 'Ocorreu um erro ao salvar o serviço.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/servicos')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Novo Serviço</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Adicione mão de obra ou pacotes ao catálogo</p>
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave} disabled={isLoading} style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}>
          {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
          {isLoading ? 'Salvando...' : 'Salvar Serviço'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Wrench size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados do Serviço</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código (Opcional)</label>
              <input type="text" name="codigo" placeholder="Ex: SRV-001" value={formData.codigo} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome do Serviço *</label>
              <input type="text" name="nome" placeholder="Ex: ALINHAMENTO E BALANCEAMENTO" value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Categoria</label>
              <select name="categoria" value={formData.categoria} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}>
                  <option value="">Selecione...</option>
                  {categoriasDB.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat}</option>
                  ))}
                </select>
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Valor por Hora (R$) *</label>
              <input type="text" name="preco" placeholder="150.00" value={formData.preco} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServicoForm;
