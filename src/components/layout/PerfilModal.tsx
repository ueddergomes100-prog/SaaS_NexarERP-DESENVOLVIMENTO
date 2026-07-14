import React, { useState, useEffect } from 'react';
import { X, User, Lock } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { isTenantManagerRole } from '../../utils/roles';

interface PerfilModalProps {
  onClose: () => void;
  userData: any;
  configData: any;
}

const PerfilModal: React.FC<PerfilModalProps> = ({ onClose, userData, configData }) => {
  const { currentUser, userRole, tenantId } = useAuth();
  const [nome, setNome] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isTenantManagerRole(userRole)) {
      setNome(configData?.nomeUsuario || '');
    } else {
      setNome(userData?.nome || '');
    }
  }, [userRole, configData, userData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !nome.trim()) return;
    
    setIsLoading(true);
    setSuccess(false);
    try {
      if (isTenantManagerRole(userRole) && tenantId) {
        await updateDoc(doc(db, 'configuracoes', tenantId), {
          nomeUsuario: nome.trim()
        });
      } else {
        await updateDoc(doc(db, 'usuarios', currentUser.uid), {
          nome: nome.trim()
        });
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Erro ao atualizar perfil', error);
      alert('Erro ao atualizar perfil.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        animation: 'pageFadeIn 0.2s ease-out'
      }}>
        <div style={{
          padding: '20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', margin: 0 }}>
            <User size={20} style={{ color: 'var(--accent-purple)' }} />
            Meu Perfil
          </h2>
          <button type="button" className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        
        <form onSubmit={handleSave} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {success && (
            <div style={{ padding: '10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '8px', fontSize: '13px', textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
              Perfil atualizado com sucesso!
            </div>
          )}
          
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>E-mail (Login)</label>
            <div className="input-with-icon" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)', display: 'flex' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              </div>
              <input type="text" className="input-field" value={currentUser?.email || ''} disabled style={{ opacity: 0.5, cursor: 'not-allowed', width: '100%', paddingLeft: '38px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 10px 10px 38px', color: 'var(--text-primary)' }} />
            </div>
            <small style={{ color: 'var(--text-muted)', marginTop: '6px', display: 'block', fontSize: '11px' }}>O e-mail de acesso não pode ser alterado por aqui.</small>
          </div>
          
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Nome de Exibição</label>
            <div className="input-with-icon" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)', display: 'flex' }}>
                <User size={18} />
              </div>
              <input 
                type="text" 
                className="input-field" 
                value={nome} 
                onChange={(e) => setNome(e.target.value)} 
                placeholder="Como você quer ser chamado?"
                required
                style={{ width: '100%', paddingLeft: '38px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 10px 10px 38px', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
          </div>

          <div style={{ marginTop: '8px', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
             <Lock size={16} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
             <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
               Para alterar sua senha, faça logout e clique em <strong>"Esqueci minha senha"</strong> na tela de login para receber um link seguro no seu e-mail.
             </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Fechar</button>
            <button type="submit" className="btn-primary" disabled={isLoading}>
              {isLoading ? 'Salvando...' : 'Salvar Perfil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PerfilModal;
