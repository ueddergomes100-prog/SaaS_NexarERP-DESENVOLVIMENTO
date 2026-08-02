import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Truck, Loader2, MapPin } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';

const FornecedorForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;

  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    telefone: '',
    email: '',
    cnpj: '',
    endereco: '',
    bairro: '',
    numero: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const { currentUser, tenantId } = useAuth();

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!tenantId) return;
      try {
        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'fornecedores', id));
          if (docSnap.exists()) {
            const data = docSnap.data() as any;
            setFormData(prev => ({ ...prev, ...data }));
          }
        } else {
          const q = query(collection(db, 'fornecedores'), where('tenantId', '==', tenantId));
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
  }, [id, isEditing, tenantId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    // Validação específica para CNPJ/CPF (apenas números)
    if (name === 'cnpj') {
      const onlyNums = value.replace(/\D/g, '');
      if (onlyNums.length <= 14) {
        setFormData({ ...formData, [name]: onlyNums });
      }
      return;
    }

    setFormData({ ...formData, [name]: value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome) {
      showError('Campos incompletos', 'Por favor, preencha o Nome / Razão Social do fornecedor.');
      return;
    }

    if (formData.cnpj && formData.cnpj.length > 0) {
      if (formData.cnpj.length !== 11 && formData.cnpj.length !== 14) {
        showError('Documento Inválido', 'O CPF deve ter 11 dígitos e o CNPJ 14 dígitos (apenas números).');
        return;
      }
    }

    if (!currentUser) return;
    setIsLoading(true);

    try {
      const dataToSave = {
        ...formData,
        nome: formData.nome.toUpperCase().trim(),
        tenantId
      };

      if (isEditing && id) {
        await updateDoc(doc(db, 'fornecedores', id), {
          ...dataToSave,
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Fornecedor atualizado!');
      } else {
        await addDoc(collection(db, 'fornecedores'), {
          ...dataToSave,
          createdAt: serverTimestamp(),
          ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Fornecedor cadastrado!');
      }
      navigate('/fornecedores');
    } catch (error) {
      console.error('Erro ao salvar fornecedor:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'var(--text-primary)' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/fornecedores')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Cadastre um fornecedor para uso em compras e entrada de notas fiscais</p>
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
          {isLoading ? 'Salvando...' : 'Salvar Fornecedor'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Truck size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados do Fornecedor</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group">
              <label>Código *</label>
              <input type="text" name="codigo" value={formData.codigo} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Nome / Razão Social *</label>
              <input type="text" name="nome" placeholder="Ex: AUTO PEÇAS BRASIL LTDA" value={formData.nome} onChange={handleChange} style={{ textTransform: 'uppercase', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Telefone / WhatsApp</label>
              <input type="text" name="telefone" placeholder="(00) 00000-0000" value={formData.telefone} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>CNPJ / CPF (Apenas números)</label>
              <input type="text" name="cnpj" placeholder="00000000000000" value={formData.cnpj} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div className="input-group">
            <label>E-mail</label>
            <input type="email" name="email" placeholder="contato@fornecedor.com" value={formData.email} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', marginTop: '12px' }}>
            <MapPin size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Endereço</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
            <div className="input-group">
              <label>Rua / Logradouro</label>
              <input type="text" name="endereco" placeholder="Av. Central" value={formData.endereco} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
            <div className="input-group">
              <label>Número</label>
              <input type="text" name="numero" placeholder="123" value={formData.numero} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
            </div>
          </div>

          <div className="input-group">
            <label>Bairro</label>
            <input type="text" name="bairro" placeholder="Centro" value={formData.bairro} onChange={handleChange} style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }} />
          </div>

        </div>
      </div>
    </div>
  );
};

export default FornecedorForm;
