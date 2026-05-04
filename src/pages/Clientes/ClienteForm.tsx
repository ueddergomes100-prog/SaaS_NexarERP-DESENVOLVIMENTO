import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, User, Loader2 } from 'lucide-react';
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, getCountFromServer, serverTimestamp, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

const ClienteForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  
  const [formData, setFormData] = useState({
    codigo: '',
    nome: '',
    telefone: '',
    email: '',
    documento: '',
    endereco: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(isEditing);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        if (isEditing && id) {
          const docSnap = await getDoc(doc(db, 'clientes', id));
          if (docSnap.exists()) {
            setFormData(docSnap.data() as any);
          }
        } else {
          // Gerar código sequencial para novo cadastro (isolado por tenant)
          if (!currentUser) return;
          const q = query(collection(db, 'clientes'), where('tenantId', '==', currentUser.uid));
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nome) {
      showError('Campos incompletos', 'Por favor, preencha o Nome do Cliente.');
      return;
    }

    setIsLoading(true);

    try {
      if (isEditing && id) {
        await updateDoc(doc(db, 'clientes', id), { ...formData, updatedAt: serverTimestamp() });
        showSuccess('Cliente atualizado!');
      } else {
        if (!currentUser) return;
        await addDoc(collection(db, 'clientes'), { 
          ...formData, 
          tenantId: currentUser.uid,
          createdAt: serverTimestamp() 
        });
        showSuccess('Cliente cadastrado!');
      }
      navigate('/clientes');
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      showError('Erro ao salvar', 'Verifique sua conexão e tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) return <div style={{ padding: '40px', color: 'white' }}>Carregando...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/clientes')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Novo Cliente</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Cadastre um novo cliente no sistema</p>
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
          {isLoading ? 'Salvando...' : 'Salvar Cliente'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <User size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados Pessoais</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Código do Cliente *</label>
              <input 
                type="text" 
                name="codigo"
                value={formData.codigo}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome Completo *</label>
              <input 
                type="text" 
                name="nome"
                placeholder="Ex: João da Silva" 
                value={formData.nome}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Telefone / WhatsApp</label>
              <input 
                type="text" 
                name="telefone"
                placeholder="(00) 00000-0000" 
                value={formData.telefone}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CPF / CNPJ</label>
              <input 
                type="text" 
                name="documento"
                placeholder="000.000.000-00" 
                value={formData.documento}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail</label>
              <input 
                type="email" 
                name="email"
                placeholder="joao@email.com" 
                value={formData.email}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Endereço Completo</label>
              <input 
                type="text" 
                name="endereco"
                placeholder="Rua Exemplo, 123" 
                value={formData.endereco}
                onChange={handleChange}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ClienteForm;
