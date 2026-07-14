import React, { useState } from 'react';
import { ArrowLeft, Save, UserCog, AlertCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, setDoc, doc, serverTimestamp, getDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { db, firebaseConfig } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError } from '../../utils/alerts';

// Importa app secundário para criar usuário sem deslogar o dono
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

const UsuarioForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const { tenantId, currentUser } = useAuth();
  
  const [formData, setFormData] = useState({
    nome: '',
    username: '',
    senha: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [shopPrefix, setShopPrefix] = useState('');

  React.useEffect(() => {
    if (isEditing && id) {
      const fetchUser = async () => {
        const userSnap = await getDoc(doc(db, 'usuarios', id));
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFormData({
            nome: data.nome || '',
            username: data.username || '',
            senha: ''
          });
        }
      };
      fetchUser();
    }
  }, [id, isEditing]);

  React.useEffect(() => {
    const fetchShopPrefix = async () => {
      if (!tenantId) return;
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists() && configSnap.data().cnpj) {
          const cnpjStr = configSnap.data().cnpj;
          setShopPrefix(cnpjStr.replace(/\D/g, ''));
        } else if (configSnap.exists() && configSnap.data().nomeOficina) {
          // Fallback para empresas antigas sem CNPJ cadastrado
          const nome = configSnap.data().nomeOficina;
          const slug = nome.toLowerCase().replace(/[^a-z0-9]/g, '');
          setShopPrefix(slug);
        } else {
          setShopPrefix(tenantId.substring(0, 4).toLowerCase());
        }
      } catch (e) {
        setShopPrefix(tenantId.substring(0, 4).toLowerCase());
      }
    };
    fetchShopPrefix();
  }, [tenantId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !currentUser) return;
    
    setIsLoading(true);

    if (isEditing && id) {
      try {
        await updateDoc(doc(db, 'usuarios', id), {
          nome: formData.nome,
          updatedAt: serverTimestamp()
        });
        showSuccess('Usuário atualizado com sucesso!');
        navigate('/usuarios');
      } catch (err) {
        console.error(err);
        showError('Erro', 'Não foi possível atualizar o usuário.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Validação de Limite de Usuários para a Empresa
    try {
      const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const qSnap = await getDocs(qUsers);
      const currentCount = qSnap.size;

      // Obtém o limite configurado no documento do dono da oficina (tenantId)
      const ownerDoc = await getDoc(doc(db, 'usuarios', tenantId));
      const limit = ownerDoc.exists() ? (ownerDoc.data().limiteUsuarios !== undefined ? ownerDoc.data().limiteUsuarios : 3) : 3;

      if (currentCount >= limit) {
        showError('Limite Atingido', `Sua empresa atingiu o limite de ${limit} usuários contratados. Entre em contato com o suporte para alterar o limite do seu plano.`);
        setIsLoading(false);
        return;
      }
    } catch (e) {
      console.error("Erro ao validar limite de usuários:", e);
    }

    // Validação básica do username (sem espaços, minúsculo)
    const usernameLimpo = formData.username.trim().toLowerCase().replace(/\s+/g, '');
    const prefixo = shopPrefix || tenantId.substring(0, 4).toLowerCase();
    const usernameFinal = `${prefixo}-${usernameLimpo}`;

    if (usernameLimpo.length < 3) {
      showError('Atenção', 'O nome de usuário deve ter pelo menos 3 letras.');
      return;
    }
    if (formData.senha.length < 6) {
      showError('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setIsLoading(true);

    // Cria um email falso único para o Firebase Auth baseado no tenantId e username
    const fakeEmail = `${usernameFinal}@nexar.app`;

    try {
      // 1. Inicia um App Secundário para não deslogar o dono
      const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
      const secondaryAuth = getAuth(secondaryApp);

      // 2. Cria a conta no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, formData.senha);
      const novoUID = userCredential.user.uid;

      // Desloga do app secundário para limpar a sessão paralela
      await signOut(secondaryAuth);

      await setDoc(doc(db, 'usuarios', novoUID), {
        nome: formData.nome,
        username: usernameFinal,
        email: fakeEmail,
        role: 'Funcionario',
        permissoes: [], // Sem acesso a princípio
        tenantId: tenantId, // Vincula à oficina do dono
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        status: 'Ativo'
      });

      // 4. Salva no índice global de usernames para o Login poder descobrir o email depois
      await setDoc(doc(db, 'usernames', usernameFinal), {
        email: fakeEmail,
        tenantId: tenantId
      });

      showSuccess('Usuário criado com sucesso!');
      navigate('/usuarios');
      
    } catch (error: any) {
      console.error('Erro ao criar usuário:', error);
      if (error.code === 'auth/email-already-in-use') {
        showError('Erro', 'Este nome de usuário já está em uso.');
      } else {
        showError('Erro', 'Não foi possível criar o usuário. Tente novamente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/usuarios')} title="Voltar"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Usuário' : 'Novo Usuário'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>{isEditing ? 'Altere o nome do funcionário' : 'Cadastre um funcionário para acessar o sistema'}</p>
          </div>
        </div>
      </div>

          {!isEditing && (
            <div className="card" style={{ marginBottom: '24px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <div style={{ display: 'flex', gap: '12px', padding: '16px' }}>
                <AlertCircle size={24} color="#8b5cf6" style={{ flexShrink: 0 }} />
                <div>
                  <h4 style={{ color: '#8b5cf6', margin: '0 0 4px', fontSize: '14px' }}>Como seu funcionário fará o Login?</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Ele deverá informar o <strong>CNPJ da Empresa</strong> e o nome de usuário (ex: <strong style={{ color: 'var(--text-primary)' }}>{formData.username.trim().toLowerCase().replace(/\s+/g, '') || 'nome'}</strong>).
                  </p>
                </div>
              </div>
            </div>
          )}

      <form onSubmit={handleSubmit} className="card" style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '24px' }}>
        <div className="section-header" style={{ gridColumn: 'span 12', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
          <UserCog size={20} className="section-icon" />
          <h3>Dados de Acesso</h3>
        </div>

        <div className="input-group" style={{ gridColumn: 'span 6' }}>
          <label>Nome Completo do Funcionário *</label>
          <input 
            type="text" 
            placeholder="Ex: João da Silva"
            value={formData.nome}
            onChange={(e) => setFormData({...formData, nome: e.target.value})}
            required
            style={{ width: '100%' }}
          />
        </div>


        {!isEditing && (
          <>
            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Nome de Usuário para Login *</label>
              <input 
                type="text" 
                placeholder="ex: joao"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
                required
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Na tela de login, ele informará Código da Empresa: <strong>{shopPrefix || tenantId?.substring(0,4).toLowerCase()}</strong> e Usuário: <strong>{formData.username.toLowerCase().replace(/\s+/g, '') || 'joao'}</strong>
              </span>
            </div>

            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Senha de Acesso *</label>
              <input 
                type="password" 
                placeholder="Mínimo 6 caracteres"
                value={formData.senha}
                onChange={(e) => setFormData({...formData, senha: e.target.value})}
                required
                minLength={6}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        <div className="input-group" style={{ gridColumn: 'span 12', marginTop: '8px' }}>
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 'var(--radius-md)', color: '#3b82f6', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCog size={18} style={{ flexShrink: 0 }} />
            <span>As permissões de acesso deste usuário (Módulos) devem ser configuradas no menu <strong>Configurações &gt; Permissão de Usuários</strong> após a criação.</span>
          </div>
        </div>

        <div style={{ gridColumn: 'span 12', display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" className="btn-secondary" onClick={() => navigate('/usuarios')}>Cancelar</button>
          <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} disabled={isLoading}>
            <Save size={20} />
            {isLoading ? 'Salvando...' : 'Salvar Funcionário'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UsuarioForm;
