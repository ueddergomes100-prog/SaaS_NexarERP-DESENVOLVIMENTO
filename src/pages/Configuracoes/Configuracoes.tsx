import React, { useState, useEffect } from 'react';
import { Save, Store, FileText, Loader2, Edit2, CheckCircle, Bell } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

const Configuracoes: React.FC = () => {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isEditingMode, setIsEditingMode] = useState(true);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);

  const [formData, setFormData] = useState({
    nomeOficina: '',
    nomeUsuario: '',
    cnpj: '',
    telefone: '',
    endereco: '',
    email: '',
    garantiaPadrao: '',
    diasNotificacaoLembrete: '15',
  });

  useEffect(() => {
    const fetchConfig = async () => {
      if (!currentUser) return;
      try {
        const docRef = doc(db, 'configuracoes', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setFormData(docSnap.data() as any);
          setIsEditingMode(false);
        } else {
          setIsEditingMode(true);
        }
      } catch (error) {
        console.error("Erro ao buscar configurações:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, [currentUser]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    setIsLoading(true);
    try {
      const docRef = doc(db, 'configuracoes', currentUser.uid);
      await setDoc(docRef, {
        ...formData,
        tenantId: currentUser.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      setIsEditingMode(false);
      setShowSuccessAnim(true);
      setTimeout(() => setShowSuccessAnim(false), 2000);

    } catch (error) {
      console.error("Erro ao salvar:", error);
      showError('Erro ao salvar', 'Não foi possível salvar as configurações.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isFetching) {
    return <div style={{ padding: '40px', color: 'white', textAlign: 'center' }}>Carregando configurações...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Configurações</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Dados da oficina e preferências do sistema</p>
        </div>
        {isEditingMode ? (
          <button 
            className="btn-primary" 
            onClick={handleSave} 
            disabled={isLoading} 
            style={{ opacity: isLoading ? 0.7 : 1, display: 'flex', alignItems: 'center' }}
          >
            {isLoading ? <Loader2 size={18} className="spin-icon" style={{ marginRight: 8 }} /> : <Save size={18} style={{ marginRight: 8 }} />}
            {isLoading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        ) : (
          <button 
            className="btn-secondary" 
            onClick={() => setIsEditingMode(true)} 
            style={{ display: 'flex', alignItems: 'center', borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}
          >
            <Edit2 size={18} style={{ marginRight: 8 }} />
            Editar Dados
          </button>
        )}
      </div>

      {showSuccessAnim && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(16, 185, 129, 0.9)', color: 'white', padding: '24px 48px',
          borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '12px', zIndex: 1000, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          animation: 'fadeInUpLogout 0.3s ease-out forwards'
        }}>
          <CheckCircle size={48} />
          <h2 style={{ margin: 0, fontSize: '20px' }}>Configurações Salvas!</h2>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', maxWidth: '800px', opacity: isEditingMode ? 1 : 0.8, pointerEvents: isEditingMode ? 'auto' : 'none' }}>
        {/* Dados da Oficina */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Store size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Dados da Oficina (Cabeçalho OS)</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da Oficina Fantasia</label>
              <input 
                type="text" 
                name="nomeOficina" 
                placeholder="Ex: Auto Center Nexus" 
                value={formData.nomeOficina} 
                onChange={handleChange} 
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome de Usuário (Aparecerá no Topo)</label>
              <input 
                type="text" 
                name="nomeUsuario" 
                placeholder="Ex: Carlos (Admin)" 
                value={formData.nomeUsuario} 
                onChange={handleChange} 
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CNPJ / CPF</label>
              <input 
                type="text" 
                name="cnpj" 
                placeholder="00.000.000/0000-00" 
                value={formData.cnpj} 
                onChange={handleChange} 
                disabled={!isEditingMode}
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
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail</label>
              <input 
                type="email" 
                name="email" 
                placeholder="contato@oficina.com" 
                value={formData.email} 
                onChange={handleChange} 
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
              />
            </div>
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Endereço Completo</label>
            <input 
              type="text" 
              name="endereco" 
              placeholder="Rua Exemplo, 123 - Bairro, Cidade - UF" 
              value={formData.endereco} 
              onChange={handleChange} 
              disabled={!isEditingMode}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
            />
          </div>
        </div>

        {/* Preferências do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <FileText size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Textos Padrões (OS)</h3>
          </div>
          
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Termo de Garantia Padrão (Aparecerá na impressão da OS)</label>
            <textarea 
              name="garantiaPadrao" 
              rows={4}
              placeholder="Ex: Garantia de 90 dias sobre a mão de obra. As peças possuem garantia do fabricante..." 
              value={formData.garantiaPadrao} 
              onChange={handleChange} 
              disabled={!isEditingMode}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white', resize: 'vertical' }} 
            />
          </div>
        </div>

        {/* Notificações do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
            <Bell size={20} style={{ color: 'var(--accent-purple)' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Notificações CRM</h3>
          </div>
          
          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Avisar Lembretes Preventivos com antecedência de:</label>
            <select 
              name="diasNotificacaoLembrete" 
              value={formData.diasNotificacaoLembrete} 
              onChange={handleChange} 
              disabled={!isEditingMode}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white', maxWidth: '300px' }} 
            >
              <option value="15">15 Dias antes</option>
              <option value="30">30 Dias antes</option>
              <option value="45">45 Dias antes</option>
            </select>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Isso define quando o sininho vermelho de notificações no topo da tela será acionado.</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Configuracoes;
