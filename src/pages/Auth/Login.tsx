import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, LogIn, Loader2 } from 'lucide-react';
import { getIdTokenResult, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, authPersistenceReady, db } from '../../services/firebase';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { clearStoredSessionId, createSessionId, setStoredSessionId } from '../../utils/session';
import {
  buildActiveSessionWarningHtml,
  buildSessionMetadata,
  isSessionRecentlyActive,
  type ActiveSessionInfo
} from '../../utils/sessionInfo';
import { isPlatformAdminRole } from '../../utils/roles';
import { activeTenantStorageKey, loadTenantOptions } from '../../utils/platformTenants';
import './Auth.css';

const LOGIN_LOADING_STEPS = [
  'Validando acesso',
  'Preparando sua sessão',
  'Carregando ambiente'
];

const hasIncompleteOnboarding = (data: Record<string, unknown>) => {
  if (isPlatformAdminRole(data.role)) {
    return false;
  }

  const hasOnboardingFlags =
    'onboardingStatus' in data ||
    'cnpjValidado' in data ||
    'emailVerificado' in data ||
    'telefoneVerificado' in data;

  if (!hasOnboardingFlags) {
    return false;
  }

  return data.onboardingStatus !== 'active' ||
    data.cnpjValidado !== true ||
    data.emailVerificado !== true ||
    data.telefoneVerificado !== true;
};

const selectPlatformTenant = async (uid: string) => {
  localStorage.removeItem(activeTenantStorageKey(uid));
  const tenants = await loadTenantOptions();

  if (tenants.length === 0) {
    await Swal.fire({
      title: 'Nenhuma empresa encontrada',
      text: 'Nao encontramos empresas clientes para este ambiente.',
      icon: 'warning',
      confirmButtonColor: '#8b5cf6'
    });
    return null;
  }

  const inputOptions = tenants.reduce<Record<string, string>>((acc, tenant) => {
    acc[tenant.id] = tenant.email ? `${tenant.nomeOficina} - ${tenant.email}` : tenant.nomeOficina;
    return acc;
  }, {});

  const result = await Swal.fire({
    title: 'Qual empresa deseja acessar?',
    text: 'Escolha a base do cliente antes de abrir o sistema.',
    input: 'select',
    inputOptions,
    inputPlaceholder: 'Selecione uma empresa',
    showCancelButton: true,
    confirmButtonColor: '#8b5cf6',
    cancelButtonColor: '#6b7280',
    confirmButtonText: 'Acessar empresa',
    cancelButtonText: 'Cancelar',
    allowOutsideClick: false,
    allowEscapeKey: false,
    inputValidator: (value) => {
      return value ? null : 'Selecione uma empresa para continuar.';
    }
  });

  if (!result.isConfirmed || typeof result.value !== 'string') {
    return null;
  }

  localStorage.setItem(activeTenantStorageKey(uid), result.value);
  window.dispatchEvent(new CustomEvent('nexus-active-tenant-selected', { detail: result.value }));
  return tenants.find(tenant => tenant.id === result.value) || null;
};

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [empresa, setEmpresa] = useState(() => localStorage.getItem('nexus_login_cnpj') || '');
  const [loginStr, setLoginStr] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState('');
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setLoadingStep(currentStep => (currentStep + 1) % LOGIN_LOADING_STEPS.length);
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  const loadingMessage = LOGIN_LOADING_STEPS[loadingStep];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginStr || !password) {
      setError('Preencha todos os campos.');
      return;
    }

    setLoading(true);
    setError('');
    let finalEmail = loginStr.trim().toLowerCase();

    try {
      // Se não tem '@', assume que é Usuário funcionário
      if (!finalEmail.includes('@')) {
        if (!empresa) {
          setError('Para login de funcionário, informe o CNPJ da Empresa.');
          setLoading(false);
          return;
        }
        
        const cnpjLimpo = empresa.replace(/\D/g, '');
        const fullUsername = `${cnpjLimpo}-${finalEmail}`;
        
        const usernameDoc = await getDoc(doc(db, 'usernames', fullUsername));
        if (usernameDoc.exists()) {
          finalEmail = usernameDoc.data().email;
        } else {
          setError('Usuário ou CNPJ da Empresa não encontrado.');
          setLoading(false);
          return;
        }
      }

      await authPersistenceReady;
      const userCredential = await signInWithEmailAndPassword(auth, finalEmail, password);
      const user = userCredential.user;
      const token = await getIdTokenResult(user);
      const hasPlatformClaim =
        token.claims.nexarAdmin === true ||
        token.claims.superAdmin === true ||
        token.claims.role === 'NexarAdmin' ||
        token.claims.role === 'SuperAdmin';
      
      // Buscar tenantId do usuario no Firestore para salvar o log na empresa correta
      let userTenantId = 'geral';
      let activeSessionId = '';
      let activeSession: ActiveSessionInfo | null = null;
      let hasUserProfile = false;
      let isPlatformLogin = hasPlatformClaim;
      try {
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        if (userDoc.exists()) {
          hasUserProfile = true;
          const userData = userDoc.data() as Record<string, unknown>;
          isPlatformLogin = isPlatformLogin || isPlatformAdminRole(userData.role);

          if (hasIncompleteOnboarding(userData)) {
            clearStoredSessionId();
            await signOut(auth);
            setError('Cadastro ainda nao validado. Confirme CNPJ, e-mail e telefone antes de acessar.');
            setLoading(false);
            return;
          }

          userTenantId = typeof userData.tenantId === 'string' ? userData.tenantId : 'geral';
          activeSessionId = typeof userData.activeSessionId === 'string' ? userData.activeSessionId : '';
          activeSession = (userData.activeSession as ActiveSessionInfo | undefined) || null;
        } else if (!isPlatformLogin) {
          clearStoredSessionId();
          await signOut(auth);
          setError('Usuario sem perfil ativo. Fale com o administrador.');
          setLoading(false);
          return;
        }
      } catch (e) {
        console.error('Erro ao obter tenantId para log de login:', e);
        clearStoredSessionId();
        await signOut(auth);
        setError('Nao foi possivel validar seu perfil de acesso. Tente novamente.');
        setLoading(false);
        return;
      }

      if (isPlatformLogin) {
        const selectedTenant = await selectPlatformTenant(user.uid);
        if (!selectedTenant) {
          clearStoredSessionId();
          await signOut(auth);
          setLoading(false);
          return;
        }
        userTenantId = selectedTenant.id;
      }

      if (hasUserProfile && isSessionRecentlyActive(activeSessionId, activeSession)) {
        const result = await Swal.fire({
          title: 'Sessão ativa detectada',
          html: buildActiveSessionWarningHtml(activeSession),
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#8b5cf6',
          cancelButtonColor: '#d33',
          confirmButtonText: 'Encerrar outra e entrar',
          cancelButtonText: 'Manter a outra ativa'
        });

        if (!result.isConfirmed) {
          // Desloga o usuário e aborta o login
          clearStoredSessionId();
          await signOut(auth);
          setLoading(false);
          return;
        }
      }

      // Cria um ID de sessão local único
      const newSessionId = createSessionId();
      setStoredSessionId(newSessionId);
      const sessionMetadata = await buildSessionMetadata(user);

      // Atualiza no Firestore
      try {
        if (!hasUserProfile) {
          throw new Error('skip_platform_session_profile');
        }

        await updateDoc(doc(db, 'usuarios', user.uid), {
          activeSessionId: newSessionId,
          activeSession: {
            ...sessionMetadata,
            sessionId: newSessionId,
            startedAt: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
            lastSeenClientAt: new Date().toISOString()
          }
        });
      } catch (e) {
        if (isPlatformLogin && e instanceof Error && e.message === 'skip_platform_session_profile') {
          // Usuário máximo pode existir apenas via custom claim; a sessão fica controlada pelo Firebase Auth.
        } else {
        console.error('Erro ao registrar nova sessao no firestore:', e);
        clearStoredSessionId();
        await signOut(auth);
        setError('Nao foi possivel registrar a sessao. Tente novamente.');
        setLoading(false);
        return;
        }
      }

      const { createAuditLog } = await import('../../services/logService');
      createAuditLog({
        tenantId: userTenantId,
        usuarioId: user.uid,
        usuarioEmail: user.email || user.uid,
        modulo: 'autenticacao',
        acao: 'login',
        descricao: 'Usuário realizou login com sucesso.',
        status: 'sucesso'
      });
      
      // Save CNPJ if employee login
      if (!loginStr.trim().includes('@')) {
        localStorage.setItem('nexus_login_cnpj', empresa);
      }
      
      setShowSplash(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
      
    } catch (err: any) {
      console.error(err);
      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: 'geral',
          usuarioId: 'desconhecido',
          usuarioEmail: finalEmail,
          modulo: 'autenticacao',
          acao: 'login',
          descricao: `Tentativa de login malsucedida. Código: ${err.code || 'erro_desconhecido'}`,
          status: 'erro'
        });
      } catch {}

      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Login ou senha incorretos.');
      } else {
        setError('Erro ao fazer login. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showSplash && (
        <div style={{
          height: '100vh', width: '100vw',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          position: 'fixed', top: 0, left: 0, zIndex: 9999,
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.14) 0%, transparent 52%)',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            position: 'relative',
            width: '100px', height: '100px',
            marginBottom: '40px'
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'var(--bg-secondary)', borderRadius: '24px',
              border: '1px solid var(--border-color)',
              transform: 'rotate(45deg)',
              animation: 'spinPulse 2s cubic-bezier(0.4, 0, 0.2, 1) infinite'
            }}></div>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '44px', fontWeight: 'bold', color: 'var(--text-primary)',
              background: 'linear-gradient(135deg, #a78bfa, #3b82f6)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 10px rgba(139, 92, 246, 0.35))'
            }}>
              N
            </div>
          </div>

          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
            opacity: 0, animation: 'slideUpFade 0.6s ease-out 0.2s forwards'
          }}>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '24px', fontWeight: 600, letterSpacing: '1px' }}>
              Iniciando Ambiente
            </h2>
            
            <div style={{ width: '240px', height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #3b82f6)',
                backgroundSize: '200% 100%',
                borderRadius: '4px',
                animation: 'loadingBar 1.8s ease-in-out forwards, shimmer 2s linear infinite'
              }}></div>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', fontFamily: 'monospace', letterSpacing: '2px', animation: 'blinkText 1.5s infinite' }}>
              CARREGANDO MÓDULOS...
            </p>
          </div>

          <style>
            {`
              @keyframes fadeIn {
                from { opacity: 0; backdrop-filter: blur(0px); }
                to { opacity: 1; backdrop-filter: blur(10px); }
              }
              @keyframes slideUpFade {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes spinPulse {
                0% { transform: rotate(45deg) scale(0.9); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
                50% { transform: rotate(225deg) scale(1.1); box-shadow: 0 0 30px 5px rgba(139, 92, 246, 0.3); border-color: rgba(139, 92, 246, 0.5); }
                100% { transform: rotate(405deg) scale(0.9); box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
              }
              @keyframes loadingBar {
                0% { width: 0%; }
                40% { width: 45%; }
                70% { width: 80%; }
                100% { width: 100%; }
              }
              @keyframes shimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
              @keyframes blinkText {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
              }
            `}
          </style>
        </div>
      )}

      <div className="auth-container" style={{ display: showSplash ? 'none' : 'flex' }}>
      <div className={`auth-card ${loading ? 'auth-card-loading' : ''}`}>
        <div className="auth-header">
          <div className="auth-logo">N</div>
          <h1>Bem-vindo ao Nexar ERP</h1>
          <p>Faça login para acessar o sistema da sua empresa.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        {loading && (
          <div className="auth-loading-panel" aria-live="polite">
            <div className="auth-loading-orbit">
              <Loader2 size={20} className="spin-icon" />
            </div>
            <div className="auth-loading-copy">
              <strong>{loadingMessage}</strong>
              <span>Estamos conectando sua conta com segurança.</span>
            </div>
            <div className="auth-loading-track">
              <span />
            </div>
          </div>
        )}

        <form className="auth-form" onSubmit={handleLogin}>
          <div className="auth-input-group">
            <label>CNPJ da Empresa <span style={{fontSize:'12px', color:'var(--text-muted)', fontWeight: 'normal'}}>(Deixe em branco se for logar com E-mail)</span></label>
            <div className="auth-input-wrapper">
              <span className="auth-input-icon" style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 'bold' }}>#</span>
              <input 
                type="text" 
                className="auth-input" 
                placeholder="00.000.000/0000-00" 
                value={empresa}
                disabled={loading}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  let formatted = val;
                  if (val.length <= 14) {
                    formatted = val.replace(/^(\d{2})(\d)/, '$1.$2')
                                   .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                                   .replace(/\.(\d{3})(\d)/, '.$1/$2')
                                   .replace(/(\d{4})(\d)/, '$1-$2');
                  }
                  setEmpresa(formatted);
                }}
                maxLength={18}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>E-mail ou Usuário</label>
            <div className="auth-input-wrapper">
              <User size={18} className="auth-input-icon" />
              <input 
                type="text" 
                className="auth-input" 
                placeholder="Dono: seu@email.com / Funcionário: joao" 
                value={loginStr}
                disabled={loading}
                onChange={(e) => setLoginStr(e.target.value)}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>Senha</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input 
                type="password" 
                className="auth-input" 
                placeholder="••••••••" 
                value={password}
                disabled={loading}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className={`auth-button ${loading ? 'auth-button-loading' : ''}`} disabled={loading}>
            {loading ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
            {loading ? loadingMessage : 'Entrar no Sistema'}
          </button>
        </form>

        <div className="auth-footer">
          Não tem uma conta? 
          <button className="auth-link" onClick={() => navigate('/cadastro')} disabled={loading}>
            Cadastre-se grátis
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

export default Login;
