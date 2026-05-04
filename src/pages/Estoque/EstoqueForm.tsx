import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Package, DollarSign, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import './Estoque.css';

const EstoqueForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    categoria: '',
    quantidade: '',
    estoqueMinimo: '',
    precoCusto: '',
    precoVenda: '',
    fornecedor: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (!currentUser) return;

        // Fetch Categorias
        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', currentUser.uid));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          if (d.data().tipo === 'Peça') cats.push(d.data().nome);
        });
        setCategoriasDB(cats);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'estoque', id));
          if (docSnap.exists()) {
            setFormData(docSnap.data() as any);
          }
        } else {
          // Gerar código sequencial para novo cadastro
          const q = query(collection(db, 'estoque'), where('tenantId', '==', currentUser.uid));
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
    if (!formData.nome || !formData.codigo) {
      showError('Campos incompletos', 'Por favor, preencha o Código e o Nome da Peça.');
      return;
    }

    setIsLoading(true);

    try {
      const pecaData = {
        ...formData,
        quantidade: Number(formData.quantidade) || 0,
        estoqueMinimo: Number(formData.estoqueMinimo) || 0,
        precoCusto: Number(formData.precoCusto) || 0,
        precoVenda: Number(formData.precoVenda) || 0,
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'estoque', id), { ...pecaData, updatedAt: serverTimestamp() });
        showSuccess('Peça atualizada!');
      } else {
        if (!currentUser) return;
        await addDoc(collection(db, 'estoque'), { 
          ...pecaData, 
          tenantId: currentUser.uid,
          createdAt: serverTimestamp() 
        });
        showSuccess('Peça cadastrada!');
      }
      
      navigate('/estoque');
    } catch (error) {
      console.error('Erro ao salvar peça:', error);
      showError('Erro ao salvar', 'Erro ao salvar peça no estoque. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'white' }}>Carregando...</div>;

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Nova Peça</h1>
            <p className="page-subtitle">Cadastre um novo item no estoque</p>
          </div>
        </div>
        <button 
          className="btn-primary" 
          onClick={handleSave}
          disabled={isLoading}
          style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
        >
          {isLoading ? (
            <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} />
          ) : (
            <Save size={18} style={{ marginRight: 8 }} />
          )}
          {isLoading ? 'Salvando...' : 'Salvar Peça'}
        </button>
      </div>

      <div className="form-grid">
        <div className="form-column">
          {/* Identificação Section */}
          <div className="card form-section">
            <div className="section-header">
              <Package size={20} className="section-icon" />
              <h3>Identificação da Peça</h3>
            </div>
            
            <div className="input-group">
              <label>Nome da Peça *</label>
              <input 
                type="text" 
                name="nome"
                placeholder="Ex: Filtro de Óleo" 
                value={formData.nome}
                onChange={handleChange}
              />
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label>Código / SKU *</label>
                <input 
                  type="text" 
                  name="codigo"
                  placeholder="Ex: FO-001" 
                  value={formData.codigo}
                  onChange={handleChange}
                />
              </div>
              <div className="input-group">
                <label>Categoria</label>
                <select 
                  name="categoria" 
                  value={formData.categoria}
                  onChange={handleChange}
                  className="form-select"
                >
                  <option value="">Selecione...</option>
                  {categoriasDB.map((cat, idx) => (
                    <option key={idx} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="input-group">
              <label>Fornecedor (Opcional)</label>
              <input 
                type="text" 
                name="fornecedor"
                placeholder="Ex: Distribuidora XYZ" 
                value={formData.fornecedor}
                onChange={handleChange}
              />
            </div>
          </div>
        </div>

        <div className="form-column">
          {/* Quantidade e Valores Section */}
          <div className="card form-section fill-height">
            <div className="section-header">
              <DollarSign size={20} className="section-icon" />
              <h3>Quantidade e Valores</h3>
            </div>
            
            <div className="grid-2-col">
              <div className="input-group">
                <label>Qtd. em Estoque Inicial</label>
                <input 
                  type="number" 
                  name="quantidade"
                  placeholder="0" 
                  min="0"
                  value={formData.quantidade}
                  onChange={handleChange}
                />
              </div>
              <div className="input-group">
                <label>Estoque Mínimo Ideal</label>
                <input 
                  type="number" 
                  name="estoqueMinimo"
                  placeholder="0" 
                  min="0"
                  value={formData.estoqueMinimo}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="grid-2-col" style={{ marginTop: '16px' }}>
              <div className="input-group">
                <label>Preço de Custo (R$)</label>
                <input 
                  type="number" 
                  name="precoCusto"
                  placeholder="0.00" 
                  step="0.01"
                  min="0"
                  value={formData.precoCusto}
                  onChange={handleChange}
                />
              </div>
              <div className="input-group">
                <label>Preço de Venda (R$)</label>
                <input 
                  type="number" 
                  name="precoVenda"
                  placeholder="0.00" 
                  step="0.01"
                  min="0"
                  value={formData.precoVenda}
                  onChange={handleChange}
                />
              </div>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  );
};

export default EstoqueForm;
