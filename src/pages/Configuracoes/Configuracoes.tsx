import React, { useState, useEffect } from 'react';
import { Save, Store, FileText, Loader2, Edit2, CheckCircle, Bell, ChevronDown, ChevronUp, Shield, ListTree, Plus, X } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

const Configuracoes: React.FC = () => {
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isEditingMode, setIsEditingMode] = useState(true);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [showDadosOficina, setShowDadosOficina] = useState(false);
  const [showPermissoes, setShowPermissoes] = useState(false);
  const [showPlanoContas, setShowPlanoContas] = useState(false);
  const [novaReceitaInput, setNovaReceitaInput] = useState('');
  const [novaDespesaInput, setNovaDespesaInput] = useState('');
  
  // Controle de permissões
  const [tenantUsers, setTenantUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedUserPermissions, setSelectedUserPermissions] = useState<string[]>([]);
  const [recebeComissao, setRecebeComissao] = useState(false);
  const [comissaoPercentual, setComissaoPercentual] = useState(0);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);

  const [formData, setFormData] = useState({
    nomeOficina: '',
    nomeUsuario: '',
    cnpj: '',
    telefone: '',
    endereco: '',
    email: '',
    garantiaPadrao: '',
    diasNotificacaoLembrete: '15',
    planoContasReceitas: ['Serviços', 'Venda de Peças', 'Outras Receitas'],
    planoContasDespesas: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Impostos', 'Fornecedores de Peças', 'Marketing', 'Manutenção', 'Outros'],
  });

  useEffect(() => {
    const fetchConfig = async () => {
      if (!currentUser) return;
      try {
        // Busca Configurações
        const docRef = doc(db, 'configuracoes', currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          let receitas = data.planoContasReceitas || [];
          if (typeof receitas === 'string') receitas = receitas.split('\n').filter((c: string) => c.trim() !== '');
          let despesas = data.planoContasDespesas || [];
          if (typeof despesas === 'string') despesas = despesas.split('\n').filter((c: string) => c.trim() !== '');

          setFormData({
            ...data,
            planoContasReceitas: receitas,
            planoContasDespesas: despesas
          } as any);
          setIsEditingMode(false);
        } else {
          const userProfileSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
          if (userProfileSnap.exists()) {
            const profileData = userProfileSnap.data();
            setFormData(prev => ({
              ...prev,
              nomeOficina: profileData.nomeOficina || '',
              nomeUsuario: profileData.nomeResponsavel || '',
              email: profileData.email || currentUser.email || ''
            }));
          } else {
            setFormData(prev => ({
              ...prev,
              email: currentUser.email || ''
            }));
          }
          setIsEditingMode(true);
        }

        // Busca Usuários da Oficina para o Controle de Permissões
        const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', currentUser.uid));
        const qSnap = await getDocs(qUsers);
        const usersList: any[] = [];
        qSnap.forEach(u => {
          const uData = u.data();
          // Não lista o próprio dono (Admin) porque ele já tem acesso a tudo
          if (uData.role !== 'Admin' && u.id !== currentUser.uid) {
            usersList.push({ id: u.id, ...uData });
          }
        });
        setTenantUsers(usersList);

      } catch (error) {
        console.error("Erro ao buscar configurações:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, [currentUser]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddReceita = () => {
    if (!novaReceitaInput.trim()) return;
    setFormData(prev => ({ ...prev, planoContasReceitas: [...prev.planoContasReceitas, novaReceitaInput.trim()] }));
    setNovaReceitaInput('');
  };

  const handleRemoveReceita = (index: number) => {
    setFormData(prev => ({ ...prev, planoContasReceitas: prev.planoContasReceitas.filter((_, i) => i !== index) }));
  };

  const handleAddDespesa = () => {
    if (!novaDespesaInput.trim()) return;
    setFormData(prev => ({ ...prev, planoContasDespesas: [...prev.planoContasDespesas, novaDespesaInput.trim()] }));
    setNovaDespesaInput('');
  };

  const handleRemoveDespesa = (index: number) => {
    setFormData(prev => ({ ...prev, planoContasDespesas: prev.planoContasDespesas.filter((_, i) => i !== index) }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (formData.cnpj) {
      const cnpjLimpo = formData.cnpj.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
        showError('Atenção', 'O CNPJ deve conter 14 dígitos válidos.');
        return;
      }
    }
    
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

  const handleUserSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uId = e.target.value;
    setSelectedUserId(uId);
    if (uId) {
      const user = tenantUsers.find(u => u.id === uId);
      setSelectedUserPermissions(user?.permissoes || []);
      setRecebeComissao(user?.recebeComissao || false);
      setComissaoPercentual(user?.comissaoPercentual || 0);
    } else {
      setSelectedUserPermissions([]);
      setRecebeComissao(false);
      setComissaoPercentual(0);
    }
  };

  const togglePermission = (perm: string) => {
    setSelectedUserPermissions(prev => 
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleSavePermissions = async () => {
    if (!selectedUserId) return;
    setIsSavingPermissions(true);
    try {
      await updateDoc(doc(db, 'usuarios', selectedUserId), {
        permissoes: selectedUserPermissions,
        recebeComissao: recebeComissao,
        comissaoPercentual: comissaoPercentual
      });
      // Atualiza o estado local para não perder
      setTenantUsers(prev => prev.map(u => u.id === selectedUserId ? { 
        ...u, 
        permissoes: selectedUserPermissions,
        recebeComissao: recebeComissao,
        comissaoPercentual: comissaoPercentual 
      } : u));
      
      setShowSuccessAnim(true);
      showSuccess('Permissões e regras salvas com sucesso!');
      setTimeout(() => setShowSuccessAnim(false), 2000);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      showError('Erro', 'Não foi possível salvar as permissões.');
    } finally {
      setIsSavingPermissions(false);
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', maxWidth: '800px', opacity: isEditingMode ? 1 : 0.4, filter: isEditingMode ? 'none' : 'grayscale(60%) blur(1px)', transition: 'all 0.4s ease', pointerEvents: isEditingMode ? 'auto' : 'none' }}>
        {/* Dados da Oficina */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div 
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showDadosOficina ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowDadosOficina(!showDadosOficina)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Store size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Dados da Oficina (Cabeçalho OS)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showDadosOficina ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          
          {showDadosOficina && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome da Oficina Fantasia</label>
              <input 
                type="text" 
                name="nomeOficina" 
                placeholder="Ex: Auto Center Nexar" 
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
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>CNPJ da Empresa</label>
              <input 
                type="text" 
                name="cnpj" 
                placeholder="00.000.000/0000-00" 
                value={formData.cnpj} 
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  let formatted = val;
                  if (val.length <= 14) {
                    formatted = val.replace(/^(\d{2})(\d)/, '$1.$2')
                                   .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                                   .replace(/\.(\d{3})(\d)/, '.$1/$2')
                                   .replace(/(\d{4})(\d)/, '$1-$2');
                  }
                  setFormData({ ...formData, cnpj: formatted });
                }}
                maxLength={18}
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
            </>
          )}
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

        {/* Plano de Contas */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div 
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showPlanoContas ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowPlanoContas(!showPlanoContas)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <ListTree size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Plano de Contas (Categorias Financeiras)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showPlanoContas ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          
          {showPlanoContas && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              
              {/* Receitas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#10b981', margin: 0, paddingBottom: '8px', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>Categorias de Receita</h4>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="Nova categoria de receita..." 
                    value={novaReceitaInput} 
                    onChange={(e) => setNovaReceitaInput(e.target.value)} 
                    disabled={!isEditingMode}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddReceita())}
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'white', fontSize: '13px' }} 
                  />
                  <button type="button" onClick={handleAddReceita} disabled={!isEditingMode || !novaReceitaInput.trim()} style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaReceitaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaReceitaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasReceitas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'white' }}>{cat}</span>
                      <button type="button" onClick={() => handleRemoveReceita(idx)} disabled={!isEditingMode} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: isEditingMode ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} style={{ opacity: isEditingMode ? 1 : 0.5 }} />
                      </button>
                    </div>
                  ))}
                  {formData.planoContasReceitas.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Nenhuma categoria de receita cadastrada.</p>
                  )}
                </div>
              </div>

              {/* Despesas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#ef4444', margin: 0, paddingBottom: '8px', borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>Categorias de Despesa</h4>
                
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="Nova categoria de despesa..." 
                    value={novaDespesaInput} 
                    onChange={(e) => setNovaDespesaInput(e.target.value)} 
                    disabled={!isEditingMode}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDespesa())}
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'white', fontSize: '13px' }} 
                  />
                  <button type="button" onClick={handleAddDespesa} disabled={!isEditingMode || !novaDespesaInput.trim()} style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaDespesaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaDespesaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasDespesas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'white' }}>{cat}</span>
                      <button type="button" onClick={() => handleRemoveDespesa(idx)} disabled={!isEditingMode} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: isEditingMode ? 'pointer' : 'not-allowed', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={14} style={{ opacity: isEditingMode ? 1 : 0.5 }} />
                      </button>
                    </div>
                  ))}
                  {formData.planoContasDespesas.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Nenhuma categoria de despesa cadastrada.</p>
                  )}
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Estas categorias aparecerão automaticamente na hora de lançar uma nova Receita ou Despesa no Fluxo de Caixa.</p>
              </div>
            </div>
          )}
        </div>

        {/* Permissão de Usuários */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div 
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showPermissoes ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowPermissoes(!showPermissoes)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Shield size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Permissão de Usuários</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showPermissoes ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          
          {showPermissoes && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: 0 }}>
                Selecione um usuário da sua oficina para liberar ou bloquear o acesso aos módulos do sistema.
              </p>
              
              <div className="input-group">
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Selecionar Usuário</label>
                <select 
                  value={selectedUserId} 
                  onChange={handleUserSelect}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'white' }} 
                >
                  <option value="">-- Escolha um usuário --</option>
                  {tenantUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.nome} ({u.username})</option>
                  ))}
                </select>
              </div>

              {selectedUserId && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', backgroundColor: 'var(--bg-tertiary)', padding: '20px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                  
                  {/* Bloco de Comissões */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#f59e0b' }}></span>
                      Regras de Comissão
                    </h4>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                        <input 
                          type="checkbox" 
                          checked={recebeComissao}
                          onChange={(e) => setRecebeComissao(e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                        />
                        Funcionário Recebe Comissão?
                      </label>

                      {recebeComissao && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Porcentagem (%) da mão de obra:</label>
                          <input 
                            type="number" 
                            min="0"
                            max="100"
                            value={comissaoPercentual}
                            onChange={(e) => setComissaoPercentual(Number(e.target.value))}
                            style={{ width: '80px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'white', fontSize: '14px', outline: 'none' }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bloco de Permissões */}
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-purple)' }}></span>
                      Módulos Permitidos
                    </h4>
                  
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                    {[
                      { id: 'dashboard.valores', label: 'Dashboard: Visão Financeira', color: '#10b981' },
                      { id: 'cadastros.clientes', label: 'Cadastros: Clientes', color: '#8b5cf6' },
                      { id: 'cadastros.estoque', label: 'Cadastros: Estoque / Peças', color: '#8b5cf6' },
                      { id: 'cadastros.servicos', label: 'Cadastros: Serviços', color: '#8b5cf6' },
                      { id: 'cadastros.categorias', label: 'Cadastros: Categorias', color: '#8b5cf6' },
                      { id: 'vendas.pedidos', label: 'Vendas: Pedido de Vendas', color: '#f59e0b' },
                      { id: 'vendas.orcamentos', label: 'Vendas: Orçamentos', color: '#f59e0b' },
                      { id: 'vendas.relatorios', label: 'Vendas: Relatórios', color: '#f59e0b' },
                      { id: 'mecanica.os', label: 'Mecânica: Ordens de Serviço', color: '#3b82f6' },
                      { id: 'mecanica.relatorios', label: 'Mecânica: Relatórios', color: '#3b82f6' },
                      { id: 'crm.agenda', label: 'CRM: Agendamentos', color: '#ec4899' },
                      { id: 'crm.alertas', label: 'CRM: Alertas de Retorno', color: '#ec4899' },
                      { id: 'fiscal.emitir', label: 'Fiscal: Emitir Nota Fiscal', color: '#f59e0b' },
                      { id: 'fiscal.entrada', label: 'Fiscal: Entrada de XML', color: '#f59e0b' },
                      { id: 'financeiro.caixa', label: 'Financeiro: Fluxo de Caixa', color: '#10b981' },
                      { id: 'financeiro.receber', label: 'Financeiro: Contas a Receber', color: '#10b981' },
                      { id: 'financeiro.faturamento', label: 'Financeiro: Faturamento', color: '#10b981' },
                      { id: 'financeiro.comissoes', label: 'Financeiro: Comissões', color: '#10b981' },
                      { id: 'administrativo.config', label: 'Admin: Configurações', color: '#6b7280' },
                      { id: 'administrativo.equipe', label: 'Admin: Equipe e Acessos', color: '#6b7280' }
                    ].map(mod => (
                      <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', padding: '10px 12px', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${mod.color}` }}>
                        <input 
                          type="checkbox" 
                          checked={selectedUserPermissions.includes(mod.id)}
                          onChange={() => togglePermission(mod.id)}
                          style={{ width: '16px', height: '16px', accentColor: mod.color, cursor: 'pointer' }}
                        />
                        {mod.label}
                      </label>
                    ))}
                  </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button 
                      onClick={handleSavePermissions}
                      disabled={isSavingPermissions}
                      style={{ 
                        backgroundColor: 'var(--accent-purple)', color: 'white', border: 'none', 
                        padding: '10px 20px', borderRadius: 'var(--radius-md)', fontWeight: 600, 
                        cursor: isSavingPermissions ? 'not-allowed' : 'pointer', opacity: isSavingPermissions ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s'
                      }}
                    >
                      {isSavingPermissions ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                      {isSavingPermissions ? 'Salvando...' : 'Salvar Acessos'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default Configuracoes;
