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
    unidadeMedidaId: 'un'
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const [categoriasDB, setCategoriasDB] = useState<string[]>([]);
  const [unidadesDB, setUnidadesDB] = useState<any[]>([]);
  const { currentUser, tenantId } = useAuth();

  const fallbackUnidades = [
    { id: 'un', sigla: 'UN', nome: 'UNIDADE', casasDecimais: 0, permiteFracionado: false },
    { id: 'kg', sigla: 'KG', nome: 'QUILOGRAMA', casasDecimais: 3, permiteFracionado: true },
    { id: 'lts', sigla: 'LTS', nome: 'LITRO', casasDecimais: 2, permiteFracionado: true },
    { id: 'mt', sigla: 'MT', nome: 'METRO', casasDecimais: 2, permiteFracionado: true }
  ];

  const activeUnidades = unidadesDB.length > 0 ? unidadesDB : fallbackUnidades;

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (!currentUser) return;

        // Fetch Categorias
        const qCat = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
        const snapCat = await getDocs(qCat);
        const cats: string[] = [];
        snapCat.forEach(d => {
          if (d.data().tipo === 'Peça') cats.push(d.data().nome);
        });
        setCategoriasDB(cats);

        // Fetch Unidades
        const qUni = query(collection(db, 'unidades_medida'), where('tenantId', '==', tenantId));
        const snapUni = await getDocs(qUni);
        const unis: any[] = [];
        snapUni.forEach(d => {
          unis.push({ id: d.id, ...d.data() });
        });
        setUnidadesDB(unis);

        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'estoque', id));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setFormData({
              codigo: data.codigo || '',
              nome: data.nome || '',
              categoria: data.categoria || '',
              quantidade: String(data.quantidade || '0'),
              estoqueMinimo: String(data.estoqueMinimo || '0'),
              precoCusto: String(data.precoCusto || '0.00'),
              precoVenda: String(data.precoVenda || '0.00'),
              fornecedor: data.fornecedor || '',
              unidadeMedidaId: data.unidadeMedidaId || 'un'
            });
          }
        } else {
          // Gerar código sequencial para novo cadastro
          const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
          const snap = await getCountFromServer(q);
          const nextId = snap.data().count + 1;
          setFormData({
            codigo: String(nextId),
            nome: '',
            categoria: '',
            quantidade: '',
            estoqueMinimo: '',
            precoCusto: '',
            precoVenda: '',
            fornecedor: '',
            unidadeMedidaId: 'un'
          });
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchInitialData();
  }, [id, isEditing, tenantId, currentUser]);

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
      const selectedUnit = activeUnidades.find(u => u.id === formData.unidadeMedidaId) || activeUnidades.find(u => u.sigla === 'UN') || activeUnidades[0];

      const pecaData = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        quantidade: Number(formData.quantidade) || 0,
        estoqueMinimo: Number(formData.estoqueMinimo) || 0,
        precoCusto: Number(formData.precoCusto) || 0,
        precoVenda: Number(formData.precoVenda) || 0,
        unidadeMedidaId: selectedUnit?.id || 'un',
        unidadeMedidaSigla: selectedUnit?.sigla || 'UN',
        unidadeMedidaCasasDecimais: selectedUnit ? Number(selectedUnit.casasDecimais) : 0,
        unidadeMedidaFracionado: selectedUnit ? Boolean(selectedUnit.permiteFracionado) : false
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'estoque', id), { ...pecaData, updatedAt: serverTimestamp() });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId,
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'estoque',
            acao: 'edicao',
            descricao: `Peça ${pecaData.nome} editada. Quantidade: ${pecaData.quantidade} ${pecaData.unidadeMedidaSigla}. Preço de Venda: R$ ${pecaData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: id,
            status: 'sucesso'
          });
        } catch (logErr) {}
        showSuccess('Peça atualizada!');
      } else {
        if (!currentUser) return;
        const newDocRef = await addDoc(collection(db, 'estoque'), { 
          ...pecaData, 
          tenantId,
          createdAt: serverTimestamp() 
        });
        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId,
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'estoque',
            acao: 'criacao',
            descricao: `Peça ${pecaData.nome} cadastrada. Estoque Inicial: ${pecaData.quantidade} ${pecaData.unidadeMedidaSigla}. Preço de Venda: R$ ${pecaData.precoVenda.toFixed(2)}.`,
            registroRelacionadoId: newDocRef.id,
            status: 'sucesso'
          });
        } catch (logErr) {}
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

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

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
                placeholder="Ex: FILTRO DE ÓLEO" 
                value={formData.nome}
                onChange={handleChange}
                style={{ textTransform: 'uppercase' }}
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

            <div className="grid-2-col" style={{ marginTop: '16px' }}>
              <div className="input-group">
                <label>Unidade de Medida</label>
                <select 
                  name="unidadeMedidaId" 
                  value={formData.unidadeMedidaId}
                  onChange={handleChange}
                  className="form-select"
                >
                  {activeUnidades.map((uni) => (
                    <option key={uni.id} value={uni.id}>{uni.sigla} - {uni.nome}</option>
                  ))}
                </select>
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
