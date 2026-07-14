import React, { useState, useEffect } from 'react';
import { Save, Store, FileText, Loader2, Edit2, CheckCircle, Bell, ChevronDown, ChevronUp, Shield, ListTree, Plus, X, Sliders, LayoutTemplate, Camera, MessageCircle } from 'lucide-react';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, getDocs, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';
import { DEFAULT_OS_PRINT_MODEL, OS_PRINT_MODELS } from '../../utils/osPrintModels';
import { formatCompanyAddress } from '../../utils/companyAddress';
import { MODULE_GROUPS } from '../../utils/moduleCatalog';
import { isPlatformAdminRole } from '../../utils/roles';

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const Configuracoes: React.FC = () => {
  const { currentUser, tenantId, userRole } = useAuth();
  const isPlatformAdmin = isPlatformAdminRole(userRole);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isEditingMode, setIsEditingMode] = useState(true);
  const [showSuccessAnim, setShowSuccessAnim] = useState(false);
  const [showModulosSistema, setShowModulosSistema] = useState(true);
  const [showDadosOficina, setShowDadosOficina] = useState(false);
  const [showTextosPadroes, setShowTextosPadroes] = useState(true);
  const [showNotificacoesCrm, setShowNotificacoesCrm] = useState(true);
  const [showPermissoes, setShowPermissoes] = useState(false);
  const [showPlanoContas, setShowPlanoContas] = useState(false);
  const [showConfigAvancadas, setShowConfigAvancadas] = useState(false);
  const [showSpedy, setShowSpedy] = useState(false);
  const [novaReceitaInput, setNovaReceitaInput] = useState('');
  const [novaDespesaInput, setNovaDespesaInput] = useState('');

  // Controle de permissões
  const [tenantUsers, setTenantUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedUserPermissions, setSelectedUserPermissions] = useState<string[]>([]);
  const [recebeComissaoServicos, setRecebeComissaoServicos] = useState(false);
  const [comissaoPercentualServicos, setComissaoPercentualServicos] = useState(0);
  const [recebeComissaoPecas, setRecebeComissaoPecas] = useState(false);
  const [comissaoPercentualPecas, setComissaoPercentualPecas] = useState(0);
  const [isSavingPermissions, setIsSavingPermissions] = useState(false);
  const [moduleBlockedDraft, setModuleBlockedDraft] = useState<string[]>([]);
  const [isSavingTenantModules, setIsSavingTenantModules] = useState(false);

  const [formData, setFormData] = useState({
    logo: '',
    nomeOficina: '',
    nomeUsuario: '',
    cnpj: '',
    telefone: '',
    whatsapp: '',
    instagram: '',
    rua: '',
    numero: '',
    bairro: '',
    endereco: '',
    email: '',
    garantiaPadrao: '',
    diasNotificacaoLembrete: '15',
    venderSemEstoque: false,
    validarCadastroProduto: false,
    diasCrediario: '30',
    planoContasReceitas: ['Serviços', 'Venda de Produtos', 'Outras Receitas'],
    planoContasDespesas: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Impostos', 'Fornecedores de Produtos', 'Marketing', 'Manutenção', 'Outros'],
    modeloImpressaoOS: DEFAULT_OS_PRINT_MODEL,
    spedyEnabled: false,
    spedyApiKey: '',
    spedyEnvironment: 'sandbox'
  });

  useEffect(() => {
    const fetchConfig = async () => {
      if (!currentUser || !tenantId) return;
      try {
        // Busca Configurações
        const docRef = doc(db, 'configuracoes', tenantId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          let privateSpedyApiKey = data.spedyApiKey ?? '';
          try {
            const privateSnap = await getDoc(doc(db, 'configuracoes_privadas', tenantId));
            if (privateSnap.exists()) {
              privateSpedyApiKey = privateSnap.data().spedyApiKey ?? privateSpedyApiKey;
            }
          } catch (privateError) {
            console.warn('Nao foi possivel carregar configuracoes privadas:', privateError);
          }
          let receitas = data.planoContasReceitas || [];
          if (typeof receitas === 'string') receitas = receitas.split('\n').filter((c: string) => c.trim() !== '');
          let despesas = data.planoContasDespesas || [];
          if (typeof despesas === 'string') despesas = despesas.split('\n').filter((c: string) => c.trim() !== '');

          setFormData({
            ...data,
            venderSemEstoque: data.venderSemEstoque ?? false,
            validarCadastroProduto: data.validarCadastroProduto ?? false,
            whatsapp: data.whatsapp ?? '',
            instagram: data.instagram ?? '',
            rua: data.rua ?? data.endereco ?? '',
            numero: data.numero ?? '',
            bairro: data.bairro ?? '',
            diasCrediario: data.diasCrediario ?? '30',
            planoContasReceitas: receitas,
            planoContasDespesas: despesas,
            modeloImpressaoOS: data.modeloImpressaoOS || DEFAULT_OS_PRINT_MODEL,
            spedyEnabled: data.spedyEnabled ?? false,
            spedyApiKey: privateSpedyApiKey,
            spedyEnvironment: data.spedyEnvironment ?? 'sandbox'
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

        // Busca usuários da empresa para o controle de permissões
        const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
        const qSnap = await getDocs(qUsers);
        const usersList: any[] = [];
        qSnap.forEach(u => {
          const uData = u.data();
          // Allow listing Admin to satisfy user request
          usersList.push({ id: u.id, ...uData });
        });
        setTenantUsers(usersList);

        if (isPlatformAdmin && tenantId) {
          const ownerSnap = await getDoc(doc(db, 'usuarios', tenantId));
          const ownerBlockedModules = ownerSnap.exists() ? toStringArray(ownerSnap.data().modulosBloqueados) : [];
          const configBlockedModules = docSnap.exists() ? toStringArray(docSnap.data().modulosBloqueados) : [];
          setModuleBlockedDraft(ownerBlockedModules.length > 0 ? ownerBlockedModules : configBlockedModules);
        } else {
          setModuleBlockedDraft([]);
        }

      } catch (error) {
        console.error("Erro ao buscar configurações:", error);
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, [currentUser, tenantId, isPlatformAdmin]);

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
    if (!currentUser || !tenantId) return;

    if (formData.cnpj) {
      const cnpjLimpo = formData.cnpj.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
        showError('Atenção', 'O CNPJ deve conter 14 dígitos válidos.');
        return;
      }
    }

    setIsLoading(true);
    try {
      const docRef = doc(db, 'configuracoes', tenantId);
      const privateDocRef = doc(db, 'configuracoes_privadas', tenantId);
      const enderecoCompleto = formatCompanyAddress(formData);
      const { spedyApiKey, ...publicFormData } = formData;
      const trimmedSpedyApiKey = spedyApiKey.trim();

      await setDoc(privateDocRef, {
        tenantId,
        spedyApiKey: trimmedSpedyApiKey,
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await setDoc(docRef, {
        ...publicFormData,
        endereco: enderecoCompleto,
        spedyApiKey: deleteField(),
        spedyApiKeyConfigured: Boolean(trimmedSpedyApiKey),
        tenantId,
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
      setRecebeComissaoServicos(user?.recebeComissaoServicos || false);
      setComissaoPercentualServicos(user?.comissaoPercentualServicos || 0);
      setRecebeComissaoPecas(user?.recebeComissaoPecas || false);
      setComissaoPercentualPecas(user?.comissaoPercentualPecas || 0);
    } else {
      setSelectedUserPermissions([]);
      setRecebeComissaoServicos(false);
      setComissaoPercentualServicos(0);
      setRecebeComissaoPecas(false);
      setComissaoPercentualPecas(0);
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
        recebeComissaoServicos: recebeComissaoServicos,
        comissaoPercentualServicos: comissaoPercentualServicos,
        recebeComissaoPecas: recebeComissaoPecas,
        comissaoPercentualPecas: comissaoPercentualPecas
      });
      // Atualiza o estado local para não perder
      setTenantUsers(prev => prev.map(u => u.id === selectedUserId ? {
        ...u,
        permissoes: selectedUserPermissions,
        recebeComissaoServicos: recebeComissaoServicos,
        comissaoPercentualServicos: comissaoPercentualServicos,
        recebeComissaoPecas: recebeComissaoPecas,
        comissaoPercentualPecas: comissaoPercentualPecas
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

  const toggleTenantModule = (moduleId: string) => {
    setModuleBlockedDraft(prev =>
      prev.includes(moduleId)
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleSaveTenantModules = async () => {
    if (!tenantId) {
      showError('Atenção', 'Selecione uma empresa ativa para configurar os módulos.');
      return;
    }

    setIsSavingTenantModules(true);
    try {
      await updateDoc(doc(db, 'usuarios', tenantId), {
        modulosBloqueados: moduleBlockedDraft,
        updatedAt: serverTimestamp()
      });

      try {
        await updateDoc(doc(db, 'configuracoes', tenantId), {
          modulosBloqueados: moduleBlockedDraft,
          updatedAt: serverTimestamp()
        });
      } catch {
        await setDoc(doc(db, 'configuracoes', tenantId), {
          tenantId,
          modulosBloqueados: moduleBlockedDraft,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      showSuccess('Módulos e telas atualizados com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar módulos da empresa:', error);
      showError('Erro', 'Não foi possível atualizar os módulos desta empresa.');
    } finally {
      setIsSavingTenantModules(false);
    }
  };

  if (isFetching) {
    return <div style={{ padding: '40px', color: 'var(--text-primary)', textAlign: 'center' }}>Carregando configurações...</div>;
  }

  const totalModuleCount = MODULE_GROUPS.reduce((acc, group) => acc + group.items.length, 0);
  const activeModuleCount = totalModuleCount - moduleBlockedDraft.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>Configurações</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Dados da empresa e preferências do sistema</p>
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
          backgroundColor: 'rgba(16, 185, 129, 0.9)', color: 'var(--text-primary)', padding: '24px 48px',
          borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '12px', zIndex: 1000, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          animation: 'fadeInUpLogout 0.3s ease-out forwards'
        }}>
          <CheckCircle size={48} />
          <h2 style={{ margin: 0, fontSize: '20px' }}>Configurações Salvas!</h2>
        </div>
      )}

      {isPlatformAdmin && (
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showModulosSistema ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowModulosSistema(!showModulosSistema)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Sliders size={20} style={{ color: 'var(--accent-purple)' }} />
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configurar Módulos & Telas</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0' }}>Área restrita para liberar ou bloquear recursos da empresa ativa.</p>
              </div>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showModulosSistema ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showModulosSistema && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 160px 160px', gap: '16px', alignItems: 'stretch' }}>
                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Empresa ativa</span>
                  <strong style={{ display: 'block', fontSize: '16px', color: 'var(--text-primary)', marginTop: '6px' }}>{formData.nomeOficina || 'Empresa selecionada'}</strong>
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>{formData.email || tenantId}</span>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>Ativos</span>
                  <strong style={{ display: 'block', fontSize: '22px', color: 'var(--text-primary)', marginTop: '4px' }}>{activeModuleCount}</strong>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <span style={{ display: 'block', fontSize: '11px', color: '#ef4444', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueados</span>
                  <strong style={{ display: 'block', fontSize: '22px', color: 'var(--text-primary)', marginTop: '4px' }}>{moduleBlockedDraft.length}</strong>
                </div>
              </div>

              {tenantId ? (
                <>
                  <div style={{ padding: '12px 14px', borderRadius: '8px', backgroundColor: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.18)', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                    Marcado significa módulo ativo para <strong style={{ color: 'var(--text-primary)' }}>{formData.nomeOficina || 'a empresa ativa'}</strong>. Desmarcado bloqueia a tela para dono e funcionários da empresa.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                    {MODULE_GROUPS.map(group => (
                      <div key={group.group} style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <h4 style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--accent-purple)', textTransform: 'uppercase', fontWeight: 700 }}>{group.group}</h4>
                        {group.items.map(moduleItem => {
                          const isActive = !moduleBlockedDraft.includes(moduleItem.id);
                          return (
                            <label
                              key={moduleItem.id}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', cursor: isSavingTenantModules ? 'not-allowed' : 'pointer', borderTop: '1px solid rgba(255,255,255,0.04)' }}
                            >
                              <span style={{ fontSize: '13px', color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isActive ? 600 : 400 }}>{moduleItem.label}</span>
                              <span style={{ position: 'relative', width: '40px', height: '22px', borderRadius: '999px', backgroundColor: isActive ? 'var(--accent-purple)' : 'var(--bg-primary)', border: `1px solid ${isActive ? 'var(--accent-purple)' : 'var(--border-color)'}`, flexShrink: 0 }}>
                                <span style={{ position: 'absolute', top: '2px', left: isActive ? '20px' : '2px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: isActive ? '#fff' : 'var(--text-muted)', transition: 'left 0.2s ease' }} />
                              </span>
                              <input
                                type="checkbox"
                                checked={isActive}
                                disabled={isSavingTenantModules}
                                onChange={() => toggleTenantModule(moduleItem.id)}
                                style={{ display: 'none' }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleSaveTenantModules}
                      disabled={isSavingTenantModules}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isSavingTenantModules ? 0.7 : 1 }}
                    >
                      {isSavingTenantModules ? <Loader2 size={16} className="spin-icon" /> : <Save size={16} />}
                      {isSavingTenantModules ? 'Salvando...' : 'Salvar Módulos da Empresa'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '20px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Nenhuma empresa encontrada para configurar.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px', maxWidth: '800px', opacity: isEditingMode ? 1 : 0.4, filter: isEditingMode ? 'none' : 'grayscale(60%) blur(1px)', transition: 'all 0.4s ease', pointerEvents: isEditingMode ? 'auto' : 'none' }}>
        {/* Dados da Empresa */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showDadosOficina ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowDadosOficina(!showDadosOficina)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Store size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Dados da Empresa (Cabeçalhos e Impressões)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showDadosOficina ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showDadosOficina && (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Logotipo da Empresa (Aparecerá nas Impressões)</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  {formData.logo ? (
                    <div style={{ position: 'relative', width: '100px', height: '100px', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden', backgroundColor: 'white' }}>
                      <img src={formData.logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      {isEditingMode && (
                        <button type="button" onClick={() => setFormData({...formData, logo: ''})} style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239, 68, 68, 0.9)', color: 'var(--text-primary)', border: 'none', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ width: '100px', height: '100px', borderRadius: '8px', border: '1px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      <Store size={32} />
                    </div>
                  )}
                  {isEditingMode && (
                    <div>
                      <label htmlFor="logo-upload" className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                        <Plus size={16} /> Carregar Logo
                      </label>
                      <input
                        id="logo-upload"
                        type="file"
                        accept="image/png, image/jpeg, image/jpg"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 1024 * 1024 * 2) {
                              showError('Erro', 'A imagem deve ter no máximo 2MB.');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setFormData({...formData, logo: reader.result as string});
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>Formatos: PNG, JPG (Máx 2MB)</p>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Nome Fantasia da Empresa</label>
              <input
                type="text"
                name="nomeOficina"
                placeholder="Ex: Mercado Central Nexar"
                value={formData.nomeOficina}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
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
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
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
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
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
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>E-mail</label>
              <input
                type="email"
                name="email"
                placeholder="contato@empresa.com"
                value={formData.email}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <MessageCircle size={14} /> WhatsApp para impressões
              </label>
              <input
                type="text"
                name="whatsapp"
                placeholder="(00) 00000-0000"
                value={formData.whatsapp}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Camera size={14} /> Instagram para impressões
              </label>
              <input
                type="text"
                name="instagram"
                placeholder="@suaempresa"
                value={formData.instagram}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1.2fr', gap: '20px' }}>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Rua</label>
              <input
                type="text"
                name="rua"
                placeholder="Rua Joaquim Santana"
                value={formData.rua}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Número</label>
              <input
                type="text"
                name="numero"
                placeholder="111"
                value={formData.numero}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Bairro</label>
              <input
                type="text"
                name="bairro"
                placeholder="Sagrada Família"
                value={formData.bairro}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
            </>
          )}
        </div>

        {/* Preferências do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showTextosPadroes ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowTextosPadroes(!showTextosPadroes)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Textos Padrões (OS)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showTextosPadroes ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showTextosPadroes && (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Termo de Garantia Padrão (Aparecerá na impressão da OS)</label>
                <textarea
                  name="garantiaPadrao"
                  rows={4}
                  placeholder="Ex: Garantia de 90 dias sobre a mão de obra. As peças possuem garantia do fabricante..."
                  value={formData.garantiaPadrao}
                  onChange={handleChange}
                  disabled={!isEditingMode}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', resize: 'vertical' }}
                />
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <LayoutTemplate size={18} style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>Modelo de impressão da Ordem de Serviço</h4>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>O modelo selecionado será usado automaticamente ao imprimir qualquer OS.</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
                  {OS_PRINT_MODELS.map(modelo => {
                    const selected = formData.modeloImpressaoOS === modelo.id;
                    return (
                      <label
                        key={modelo.id}
                        style={{
                          display: 'flex',
                          gap: '12px',
                          alignItems: 'flex-start',
                          padding: '14px',
                          borderRadius: '8px',
                          border: `1px solid ${selected ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                          backgroundColor: selected ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-tertiary)',
                          cursor: isEditingMode ? 'pointer' : 'default',
                        }}
                      >
                        <input
                          type="radio"
                          name="modeloImpressaoOS"
                          value={modelo.id}
                          checked={selected}
                          onChange={handleChange}
                          disabled={!isEditingMode}
                          style={{ marginTop: '3px', accentColor: 'var(--accent-purple)' }}
                        />
                        <span>
                          <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{modelo.name}</strong>
                          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.45, color: 'var(--text-muted)' }}>{modelo.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Notificações do Sistema */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showNotificacoesCrm ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowNotificacoesCrm(!showNotificacoesCrm)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Bell size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Notificações CRM</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showNotificacoesCrm ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showNotificacoesCrm && (
            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Avisar Lembretes Preventivos com antecedência de:</label>
              <select
                name="diasNotificacaoLembrete"
                value={formData.diasNotificacaoLembrete}
                onChange={handleChange}
                disabled={!isEditingMode}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', maxWidth: '300px' }}
              >
                <option value="15">15 Dias antes</option>
                <option value="30">30 Dias antes</option>
                <option value="45">45 Dias antes</option>
              </select>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Isso define quando o sininho vermelho de notificações no topo da tela será acionado.</p>
            </div>
          )}
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
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '13px' }}
                  />
                  <button type="button" onClick={handleAddReceita} disabled={!isEditingMode || !novaReceitaInput.trim()} style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaReceitaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaReceitaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasReceitas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{cat}</span>
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
                    style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)', fontSize: '13px' }}
                  />
                  <button type="button" onClick={handleAddDespesa} disabled={!isEditingMode || !novaDespesaInput.trim()} style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)', padding: '0 12px', cursor: (!isEditingMode || !novaDespesaInput.trim()) ? 'not-allowed' : 'pointer', opacity: (!isEditingMode || !novaDespesaInput.trim()) ? 0.5 : 1 }}>
                    <Plus size={18} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                  {formData.planoContasDespesas.map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{cat}</span>
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

        {/* Configurações Avançadas */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showConfigAvancadas ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowConfigAvancadas(!showConfigAvancadas)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Sliders size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configurações Avançadas</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showConfigAvancadas ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showConfigAvancadas && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Permitir Venda Sem Estoque</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="venderSemEstoque"
                      checked={formData.venderSemEstoque === true}
                      onChange={() => setFormData({ ...formData, venderSemEstoque: true })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Sim
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                    <input
                      type="radio"
                      name="venderSemEstoque"
                      checked={formData.venderSemEstoque === false}
                      onChange={() => setFormData({ ...formData, venderSemEstoque: false })}
                      disabled={!isEditingMode}
                      style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                    />
                    Não
                  </label>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Se "Sim", o sistema permitirá adicionar itens na OS e Vendas mesmo que o estoque seja insuficiente.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Validar Cadastro de Produto</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    name="validarCadastroProduto"
                    checked={formData.validarCadastroProduto === true}
                    onChange={(e) => setFormData({ ...formData, validarCadastroProduto: e.target.checked })}
                    disabled={!isEditingMode}
                    style={{ accentColor: 'var(--accent-purple)', width: '16px', height: '16px' }}
                  />
                  Permitir cadastrar produto apenas com nome, preço e quantidade
                </label>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Quando marcado, o cadastro de produtos exige apenas nome, preço de venda e quantidade inicial de estoque.</p>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Dias de Crediário Padrão</label>
                <input
                  type="text"
                  name="diasCrediario"
                  placeholder="Ex: 15, 30, 45"
                  value={formData.diasCrediario}
                  onChange={handleChange}
                  disabled={!isEditingMode}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                />
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Intervalo de dias (ex: "30" ou "15, 30, 45") usado para preencher os vencimentos ao finalizar vendas a prazo.</p>
              </div>
            </div>
          )}
        </div>

        {/* Configuração de Nota Fiscal (Spedy) */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: showSpedy ? '1px solid var(--border-color)' : 'none', cursor: 'pointer' }}
            onClick={() => setShowSpedy(!showSpedy)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText size={20} style={{ color: 'var(--accent-purple)' }} />
              <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Configuração de Nota Fiscal (Spedy)</h3>
            </div>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              {showSpedy ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>

          {showSpedy && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
              <div className="input-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="checkbox"
                  name="spedyEnabled"
                  id="spedyEnabled"
                  checked={formData.spedyEnabled || false}
                  onChange={(e) => setFormData({ ...formData, spedyEnabled: e.target.checked })}
                  disabled={!isEditingMode}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--accent-purple)', cursor: 'pointer' }}
                />
                <label htmlFor="spedyEnabled" style={{ fontSize: '14px', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>Habilitar Emissão de Notas Fiscais (Spedy)</label>
              </div>

              {formData.spedyEnabled && (
                <>
                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Ambiente</label>
                    <select
                      name="spedyEnvironment"
                      value={formData.spedyEnvironment || 'sandbox'}
                      onChange={handleChange}
                      disabled={!isEditingMode}
                      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)', maxWidth: '300px' }}
                    >
                      <option value="sandbox">Sandbox (Homologação / Testes)</option>
                      <option value="production">Produção (Valor Fiscal Real)</option>
                    </select>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>O ambiente de Sandbox permite simular emissões sem valor fiscal real.</p>
                  </div>

                  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Spedy API Key (Chave da Empresa)</label>
                    <input
                      type="password"
                      name="spedyApiKey"
                      placeholder="Insira a chave obtida no painel Spedy"
                      value={formData.spedyApiKey || ''}
                      onChange={handleChange}
                      disabled={!isEditingMode}
                      style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
                    />
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Esta chave é única por empresa (CNPJ) e pode ser encontrada no painel da Spedy.</p>
                  </div>
                </>
              )}
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
                Selecione um usuário da sua empresa para liberar ou bloquear o acesso aos módulos do sistema.
              </p>

              <div className="input-group">
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Selecionar Usuário</label>
                <select
                  value={selectedUserId}
                  onChange={handleUserSelect}
                  style={{ width: '100%', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'var(--text-primary)' }}
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            checked={recebeComissaoServicos}
                            onChange={(e) => setRecebeComissaoServicos(e.target.checked)}
                            style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                          />
                          Comissão em Serviços?
                        </label>

                        {recebeComissaoServicos && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Porcentagem (%):</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={comissaoPercentualServicos}
                              onChange={(e) => setComissaoPercentualServicos(Number(e.target.value))}
                              style={{ width: '80px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                            />
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary)' }}>
                          <input
                            type="checkbox"
                            checked={recebeComissaoPecas}
                            onChange={(e) => setRecebeComissaoPecas(e.target.checked)}
                            style={{ width: '18px', height: '18px', accentColor: '#f59e0b', cursor: 'pointer' }}
                          />
                          Comissão em Produtos?
                        </label>

                        {recebeComissaoPecas && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Porcentagem (%):</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={comissaoPercentualPecas}
                              onChange={(e) => setComissaoPercentualPecas(Number(e.target.value))}
                              style={{ width: '80px', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: '14px', outline: 'none' }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bloco de Permissões */}
                  <div>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-purple)' }}></span>
                      Módulos Permitidos
                    </h4>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginTop: '16px' }}>
                    {[
                      { id: 'dashboard.valores', label: 'Dashboard: Visão Financeira', color: '#10b981' },
                      { id: 'cadastros.clientes', label: 'Cadastros: Clientes', color: '#8b5cf6' },
                      { id: 'cadastros.estoque', label: 'Cadastros: Estoque / Produtos', color: '#8b5cf6' },
                      { id: 'cadastros.servicos', label: 'Cadastros: Serviços', color: '#8b5cf6' },
                      { id: 'cadastros.categorias', label: 'Cadastros: Categorias', color: '#8b5cf6' },
                      { id: 'cadastros.unidades_medida', label: 'Cadastros: Unidades de Medida', color: '#8b5cf6' },
                      { id: 'vendas.pedidos', label: 'Vendas: Pedidos de Venda', color: '#f59e0b' },
                      { id: 'vendas.alterar', label: 'Vendas: Alterar Pedidos', color: '#f59e0b' },
                      { id: 'vendas.excluir', label: 'Vendas: Excluir Pedidos', color: '#ef4444' },
                      { id: 'vendas.devolucao', label: 'Vendas: Devolução de Venda', color: '#ef4444' },
                      { id: 'vendas.orcamentos', label: 'Vendas: Orçamentos', color: '#f59e0b' },
                      { id: 'vendas.orcamentos_alterar', label: 'Vendas: Alterar Orçamentos', color: '#f59e0b' },
                      { id: 'vendas.orcamentos_excluir', label: 'Vendas: Excluir Orçamentos', color: '#ef4444' },
                      { id: 'vendas.relatorios', label: 'Vendas: Relatórios', color: '#f59e0b' },
                      { id: 'mecanica.os', label: 'Serviços: Ordens de Serviço', color: '#3b82f6' },
                      { id: 'mecanica.os_alterar', label: 'Serviços: Alterar OS', color: '#3b82f6' },
                      { id: 'mecanica.os_excluir', label: 'Serviços: Excluir OS', color: '#ef4444' },
                      { id: 'mecanica.relatorios', label: 'Serviços: Relatórios', color: '#3b82f6' },
                      { id: 'crm.agenda', label: 'CRM: Agendamentos', color: '#ec4899' },
                      { id: 'crm.alertas', label: 'CRM: Alertas de Retorno', color: '#ec4899' },
                      { id: 'fiscal.emitir', label: 'Fiscal: Emitir Nota Fiscal', color: '#f59e0b' },
                      { id: 'fiscal.entrada', label: 'Fiscal: Entrada de XML', color: '#f59e0b' },
                      { id: 'fiscal.excluir', label: 'Fiscal: Excluir/Cancelar Nota Fiscal', color: '#ef4444' },
                      { id: 'financeiro.caixa', label: 'Financeiro: Fluxo de Caixa', color: '#10b981' },
                      { id: 'financeiro.receber', label: 'Financeiro: Contas a Receber', color: '#10b981' },
                      { id: 'financeiro.pagar', label: 'Financeiro: Contas a Pagar', color: '#10b981' },
                      { id: 'financeiro.faturamento', label: 'Financeiro: Faturamento', color: '#10b981' },
                      { id: 'financeiro.comissoes', label: 'Financeiro: Comissões', color: '#10b981' },
                      { id: 'financeiro.estornar', label: 'Financeiro: Estornar Pagamento/Recebimento', color: '#10b981' },
                      { id: 'administrativo.config', label: 'Admin: Configurações', color: '#6b7280' },
                      { id: 'administrativo.equipe', label: 'Admin: Equipe e Acessos', color: '#6b7280' },
                      { id: 'administrativo.logs', label: 'Admin: Logs do Sistema', color: '#6b7280' }
                    ].map(mod => {
                      const isChecked = selectedUserPermissions.includes(mod.id);
                      return (
                        <label key={mod.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
                          fontSize: '13px', color: isChecked ? 'white' : 'var(--text-secondary)',
                          backgroundColor: isChecked ? 'rgba(255,255,255,0.03)' : 'var(--bg-primary)',
                          padding: '14px 16px', borderRadius: 'var(--radius-md)',
                          border: `1px solid ${isChecked ? mod.color : 'var(--border-color)'}`,
                          borderLeft: `4px solid ${isChecked ? mod.color : 'transparent'}`,
                          transition: 'all 0.2s', boxShadow: isChecked ? `0 0 10px ${mod.color}20` : 'none'
                        }}>
                          <span style={{ fontWeight: isChecked ? 600 : 400 }}>{mod.label}</span>
                          <div style={{ position: 'relative', width: '40px', height: '22px', backgroundColor: isChecked ? mod.color : 'var(--bg-tertiary)', borderRadius: '20px', transition: 'all 0.3s', border: `1px solid ${isChecked ? mod.color : 'var(--border-color)'}` }}>
                            <div style={{ position: 'absolute', top: '2px', left: isChecked ? '20px' : '2px', width: '16px', height: '16px', backgroundColor: isChecked ? '#fff' : 'var(--text-muted)', borderRadius: '50%', transition: 'all 0.3s', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} />
                          </div>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePermission(mod.id)}
                            style={{ display: 'none' }}
                          />
                        </label>
                      );
                    })}
                  </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <button
                      onClick={handleSavePermissions}
                      disabled={isSavingPermissions}
                      style={{
                        backgroundColor: 'var(--accent-purple)', color: 'var(--text-primary)', border: 'none',
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
