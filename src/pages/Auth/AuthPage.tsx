import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  Store,
  User
} from 'lucide-react';
import { getIdTokenResult, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { auth, authPersistenceReady, db } from '../../services/firebase';
import { clearStoredSessionId, createSessionId, setStoredSessionId } from '../../utils/session';
import {
  buildActiveSessionWarningHtml,
  buildSessionMetadata,
  isSessionRecentlyActive,
  type ActiveSessionInfo
} from '../../utils/sessionInfo';
import { isPlatformAdminRole } from '../../utils/roles';
import {
  onboardingService,
  type PublicCnpjData,
  type StartOnboardingResponse
} from '../../services/onboardingService';
import hennderIcon from '../../assets/hennder-icon.svg';
import BootSplash from '../../components/layout/BootSplash';
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

  // Mesma regra de AuthContext.tsx: telefone e' coletado mas nao exige
  // mais codigo de verificacao (2026-08-27), entao nao entra mais aqui.
  const hasOnboardingFlags =
    'onboardingStatus' in data ||
    'cnpjValidado' in data ||
    'emailVerificado' in data;

  if (!hasOnboardingFlags) {
    return false;
  }

  return data.onboardingStatus !== 'active' ||
    data.cnpjValidado !== true ||
    data.emailVerificado !== true;
};

// O popup "Qual empresa deseja acessar?" que existia aqui foi removido em
// 2026-08-18. Ele fazia sentido quando o platform admin caia direto no ERP e
// precisava de uma base antes de abrir a tela -- e, pior, ele APAGAVA o
// tenant salvo no localStorage pra forcar a escolha a cada login, e deslogava
// quem cancelasse. Agora o platform admin cai no Painel da Plataforma
// (/superadmin), que ja lista todas as empresas, entao escolher uma no login
// virou uma pergunta sem proposito. Sem o popup: o AuthContext passa a
// reaproveitar a ultima empresa usada (localStorage), e quem nunca escolheu
// nenhuma encontra o card "Selecionar empresa ativa" do AppLayout ao entrar
// no ERP -- fluxo que ja existia e e' mais suave que um modal bloqueante.

type AuthMode = 'login' | 'signup';
type RegisterStep = 'company' | 'codes' | 'password';

const formatCnpj = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

const formatPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  return digits
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
};

const getErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error ? error.message : fallback;
};

const getPasswordError = (password: string, confirmPassword: string) => {
  if (password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[a-z]/.test(password)) return 'A senha precisa conter pelo menos uma letra minuscula.';
  if (!/[A-Z]/.test(password)) return 'A senha precisa conter pelo menos uma letra maiuscula.';
  if (!/\d/.test(password)) return 'A senha precisa conter pelo menos um numero.';
  if (password !== confirmPassword) return 'As senhas nao conferem.';
  return '';
};

// Icones sociais puramente decorativos (pedido do usuario) -- lucide-react
// nao tem icones de marca, entao sao SVGs inline simples. Sem onClick: o
// Hennder ERP nao tem login social de verdade.
const SocialIcons: React.FC = () => (
  <div className="auth-switch-social-row">
    <button type="button" className="auth-switch-social-btn" aria-hidden="true" tabIndex={-1}>
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.2.8 3.9 1.5l2.6-2.5C16.9 3.2 14.7 2.2 12 2.2 6.9 2.2 2.8 6.4 2.8 12S6.9 21.8 12 21.8c6.9 0 9.4-4.9 9.4-7.4 0-.5-.1-.9-.1-1.3H12z"/></svg>
    </button>
    <button type="button" className="auth-switch-social-btn" aria-hidden="true" tabIndex={-1}>
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#1877F2" d="M22 12c0-5.5-4.5-10-10-10S2 6.5 2 12c0 5 3.7 9.1 8.4 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7C18.3 21.1 22 17 22 12z"/></svg>
    </button>
    <button type="button" className="auth-switch-social-btn" aria-hidden="true" tabIndex={-1}>
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#1DA1F2" d="M22 5.9c-.7.3-1.5.6-2.4.7.8-.5 1.5-1.3 1.8-2.3-.8.5-1.7.8-2.6 1a4.1 4.1 0 0 0-7 3.7A11.7 11.7 0 0 1 3.2 4.6a4.1 4.1 0 0 0 1.3 5.5c-.7 0-1.3-.2-1.9-.5v.1c0 2 1.4 3.6 3.3 4a4.1 4.1 0 0 1-1.9.1c.5 1.7 2.1 2.9 4 3A8.2 8.2 0 0 1 2 18.6a11.6 11.6 0 0 0 6.3 1.8c7.5 0 11.7-6.3 11.7-11.7v-.5c.8-.6 1.5-1.3 2-2.1z"/></svg>
    </button>
    <button type="button" className="auth-switch-social-btn" aria-hidden="true" tabIndex={-1}>
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#0A66C2" d="M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.5-2.1 3v5.6H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1zM7 20.4H3.6V9H7v11.4z"/></svg>
    </button>
  </div>
);

const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // ---------------------------------------------------------------------
  // Alternancia visual Login <-> passo "Empresa" do Cadastro. So estado
  // local (nunca navigate()) -- e' isso que evita desmontar o componente
  // e permite o painel de destaque deslizar com transicao CSS. A URL e'
  // sincronizada via history.replaceState pra manter link direto/recarregar
  // funcionando, sem disparar uma navegacao real do react-router.
  // ---------------------------------------------------------------------
  const [mode, setMode] = useState<AuthMode>(() => (location.pathname === '/cadastro' ? 'signup' : 'login'));

  const handleToggleMode = () => {
    const next: AuthMode = mode === 'login' ? 'signup' : 'login';
    setMode(next);
    window.history.replaceState(null, '', next === 'signup' ? '/cadastro' : '/login');
  };

  // ---------------------------------------------------------------------
  // Login (logica identica a antiga Login.tsx)
  // ---------------------------------------------------------------------
  const [empresa, setEmpresa] = useState(() => localStorage.getItem('nexus_login_cnpj') || '');
  const [loginStr, setLoginStr] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loginError, setLoginError] = useState('');
  const [showSplash, setShowSplash] = useState(false);

  useEffect(() => {
    if (!loginLoading) {
      setLoadingStep(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setLoadingStep(currentStep => (currentStep + 1) % LOGIN_LOADING_STEPS.length);
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [loginLoading]);

  const loadingMessage = LOGIN_LOADING_STEPS[loadingStep];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginStr || !password) {
      setLoginError('Preencha todos os campos.');
      return;
    }

    setLoginLoading(true);
    setLoginError('');
    let finalEmail = loginStr.trim().toLowerCase();

    try {
      // Se não tem '@', assume que é Usuário funcionário
      if (!finalEmail.includes('@')) {
        if (!empresa) {
          setLoginError('Para login de funcionário, informe o CNPJ da Empresa.');
          setLoginLoading(false);
          return;
        }

        const cnpjLimpo = empresa.replace(/\D/g, '');
        const fullUsername = `${cnpjLimpo}-${finalEmail}`;

        const usernameDoc = await getDoc(doc(db, 'usernames', fullUsername));
        if (usernameDoc.exists()) {
          finalEmail = usernameDoc.data().email;
        } else {
          setLoginError('Usuário ou CNPJ da Empresa não encontrado.');
          setLoginLoading(false);
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
            setLoginError('Cadastro ainda nao validado. Confirme CNPJ e e-mail antes de acessar.');
            setLoginLoading(false);
            return;
          }

          userTenantId = typeof userData.tenantId === 'string' ? userData.tenantId : 'geral';
          activeSessionId = typeof userData.activeSessionId === 'string' ? userData.activeSessionId : '';
          activeSession = (userData.activeSession as ActiveSessionInfo | undefined) || null;
        } else if (!isPlatformLogin) {
          clearStoredSessionId();
          await signOut(auth);
          setLoginError('Usuario sem perfil ativo. Fale com o administrador.');
          setLoginLoading(false);
          return;
        }
      } catch (e) {
        console.error('Erro ao obter tenantId para log de login:', e);
        clearStoredSessionId();
        await signOut(auth);
        setLoginError('Nao foi possivel validar seu perfil de acesso. Tente novamente.');
        setLoginLoading(false);
        return;
      }

      // Login de plataforma nao escolhe empresa aqui (ver comentario no topo
      // do arquivo). userTenantId segue 'geral' pro log de auditoria, que e' o
      // certo: e' um acesso de plataforma, nao de uma empresa especifica.

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
          setLoginLoading(false);
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
        setLoginError('Nao foi possivel registrar a sessao. Tente novamente.');
        setLoginLoading(false);
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

      // Splash de transicao. Antes daqui saia um setTimeout fixo de 2s --
      // tempo morto que nao media nada e, pior, ficava invisivel no login
      // (o splash so era renderizado no return do fluxo de cadastro, nunca
      // no early return do painel dividido). Agora: dispara o carregamento
      // do chunk do Dashboard em paralelo e navega assim que ele estiver
      // pronto, com um piso curto pra animacao nao dar um flash. O
      // ProtectedRoute continua exibindo o MESMO splash enquanto o
      // AuthContext resolve perfil/tenant, entao a tela nao pisca no meio.
      // Quem e' da plataforma cai no Painel da Plataforma, nao no ERP de um
      // tenant: entrar e ver o sistema de um cliente qualquer era justamente
      // a confusao relatada pelo usuario. O ERP continua a um clique, pelo
      // botao "Ir para o ERP" do painel.
      const destino = isPlatformLogin ? '/superadmin' : '/dashboard';
      setShowSplash(true);
      const splashFloor = new Promise((resolve) => window.setTimeout(resolve, 600));
      const telaChunk = (isPlatformLogin
        ? import('../Admin/SuperAdmin')
        : import('../Dashboard/Dashboard')
      ).catch(() => {
        // Falha de preload nao bloqueia o login -- o Suspense do App cobre.
      });
      await Promise.all([splashFloor, telaChunk]);
      navigate(destino, { replace: true });

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
        setLoginError('Login ou senha incorretos.');
      } else {
        setLoginError('Erro ao fazer login. Tente novamente.');
      }
    } finally {
      setLoginLoading(false);
    }
  };

  // ---------------------------------------------------------------------
  // Cadastro (logica identica a antiga Register.tsx)
  // ---------------------------------------------------------------------
  const [signupStep, setSignupStep] = useState<RegisterStep>('company');
  const [nomeOficina, setNomeOficina] = useState('');
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [onboarding, setOnboarding] = useState<StartOnboardingResponse | null>(null);
  const [cnpjInfo, setCnpjInfo] = useState<PublicCnpjData | null>(null);
  // Telefone e' coletado no cadastro (contato/WhatsApp) mas nao exige mais
  // codigo de verificacao (2026-08-27) -- so o e-mail passa por esse fluxo.
  const [emailVerified, setEmailVerified] = useState(false);
  const [devCodes, setDevCodes] = useState<{ email?: string }>({});
  const [signupLoading, setSignupLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState('');

  const clearMessages = () => {
    setSignupError('');
    setSignupSuccess('');
  };

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();

    const cnpjDigits = cnpj.replace(/\D/g, '');
    const phoneDigits = telefone.replace(/\D/g, '');

    if (!nomeOficina.trim() || !nomeResponsavel.trim() || !cnpjDigits || !email.trim() || !phoneDigits) {
      setSignupError('Preencha todos os campos obrigatorios.');
      return;
    }
    if (cnpjDigits.length !== 14) {
      setSignupError('O CNPJ deve conter 14 digitos validos.');
      return;
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setSignupError('Informe um telefone celular valido com DDD.');
      return;
    }

    setSignupLoading(true);
    try {
      const response = await onboardingService.start({
        nomeOficina: nomeOficina.trim(),
        nomeResponsavel: nomeResponsavel.trim(),
        cnpj: cnpjDigits,
        email: email.trim(),
        telefone: phoneDigits
      });

      setOnboarding(response);
      setCnpjInfo(response.cnpj);
      setDevCodes(response.devCodes || {});
      setEmailVerified(false);
      setEmailCode('');
      setSignupStep('codes');
      setSignupSuccess('CNPJ validado. Enviamos o codigo de confirmacao.');
    } catch (err) {
      setSignupError(getErrorMessage(err, 'Nao foi possivel iniciar o cadastro seguro.'));
    } finally {
      setSignupLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!onboarding?.onboardingId) return;

    if (emailCode.trim().length < 6) {
      setSignupError('Informe o codigo de 6 digitos.');
      return;
    }

    clearMessages();
    setVerifying(true);
    try {
      await onboardingService.verifyEmail({ onboardingId: onboarding.onboardingId, code: emailCode.trim() });
      setEmailVerified(true);
      setSignupStep('password');
      setSignupSuccess('E-mail confirmado. Agora crie a senha de acesso.');
    } catch (err) {
      setSignupError(getErrorMessage(err, 'Codigo invalido ou expirado.'));
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!onboarding?.onboardingId) return;

    clearMessages();
    setResending(true);
    try {
      const response = await onboardingService.resendCode(onboarding.onboardingId);
      if (response.devCode) {
        setDevCodes(current => ({ ...current, email: response.devCode }));
      }
      setSignupSuccess('Novo codigo enviado para o e-mail.');
    } catch (err) {
      setSignupError(getErrorMessage(err, 'Nao foi possivel reenviar o codigo.'));
    } finally {
      setResending(false);
    }
  };

  const handleComplete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onboarding?.onboardingId) return;

    clearMessages();
    const passwordError = getPasswordError(signupPassword, confirmPassword);
    if (passwordError) {
      setSignupError(passwordError);
      return;
    }

    setSignupLoading(true);
    try {
      await onboardingService.complete({
        onboardingId: onboarding.onboardingId,
        password: signupPassword
      });

      try {
        await authPersistenceReady;
        const userCredential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), signupPassword);
        const user = userCredential.user;

        const newSessionId = createSessionId();
        setStoredSessionId(newSessionId);
        const sessionMetadata = await buildSessionMetadata(user);
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

        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId: user.uid,
          usuarioId: user.uid,
          usuarioEmail: user.email || user.uid,
          modulo: 'autenticacao',
          acao: 'cadastro',
          descricao: 'Usuário criou a conta e acessou o sistema pela primeira vez.',
          status: 'sucesso'
        });

        setSignupSuccess('Cadastro aprovado! Entrando no sistema...');
        window.setTimeout(() => navigate('/dashboard', { replace: true }), 1000);
      } catch (sessionErr) {
        console.error('Erro ao entrar automaticamente apos o cadastro:', sessionErr);
        setSignupSuccess('Cadastro aprovado. Faca login para acessar o sistema.');
        window.setTimeout(() => navigate('/login', { replace: true }), 1300);
      }
    } catch (err) {
      setSignupError(getErrorMessage(err, 'Nao foi possivel finalizar o cadastro.'));
    } finally {
      setSignupLoading(false);
    }
  };

  const renderStepHeader = () => (
    <div className="auth-steps" aria-label="Etapas do cadastro">
      <span className={`auth-step-pill ${signupStep === 'company' ? 'active' : ''} ${signupStep !== 'company' ? 'done' : ''}`}>
        <Building2 size={14} />
        Empresa
      </span>
      <span className={`auth-step-pill ${signupStep === 'codes' ? 'active' : ''} ${signupStep === 'password' ? 'done' : ''}`}>
        <ShieldCheck size={14} />
        Validacao
      </span>
      <span className={`auth-step-pill ${signupStep === 'password' ? 'active' : ''}`}>
        <KeyRound size={14} />
        Senha
      </span>
    </div>
  );

  const renderCodesStep = () => (
    <div className="auth-form">
      {cnpjInfo && (
        <div className="auth-info-panel">
          <strong>{cnpjInfo.nomeFantasia || cnpjInfo.razaoSocial}</strong>
          <span>{cnpjInfo.municipio}/{cnpjInfo.uf} - CNPJ {formatCnpj(cnpjInfo.cnpj)}</span>
        </div>
      )}

      <div className="auth-code-grid">
        <div className={`auth-code-card ${emailVerified ? 'verified' : ''}`}>
          <div className="auth-code-title">
            <Mail size={18} />
            <div>
              <strong>E-mail</strong>
              <span>{onboarding?.maskedEmail}</span>
            </div>
            {emailVerified && <CheckCircle2 size={18} />}
          </div>
          <div className="auth-code-row">
            <input
              className="auth-input auth-code-input"
              placeholder="000000"
              value={emailCode}
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={emailVerified || verifying}
              inputMode="numeric"
            />
            <button
              type="button"
              className="auth-mini-button"
              onClick={() => handleVerifyCode()}
              disabled={emailVerified || verifying}
            >
              {verifying ? <Loader2 size={16} className="spin-icon" /> : 'OK'}
            </button>
          </div>
          <button
            type="button"
            className="auth-text-button"
            onClick={() => handleResend()}
            disabled={emailVerified || resending}
          >
            {resending ? 'Reenviando...' : 'Reenviar codigo'}
          </button>
        </div>
      </div>

      {devCodes.email && (
        <div className="auth-dev-codes">
          <strong>Codigos de desenvolvimento</strong>
          <span>E-mail: {devCodes.email}</span>
        </div>
      )}

      <div className="auth-actions-row">
        <button type="button" className="auth-secondary-button" onClick={() => setSignupStep('company')}>
          Voltar
        </button>
        <button
          type="button"
          className="auth-button"
          disabled={!emailVerified}
          onClick={() => setSignupStep('password')}
        >
          Continuar
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );

  const renderPasswordStep = () => (
    <form className="auth-form" onSubmit={handleComplete}>
      <div className="auth-info-panel">
        <strong>Validacoes concluidas</strong>
        <span>Crie uma senha forte para liberar o acesso da empresa.</span>
      </div>

      <div className="auth-input-group">
        <label>Senha *</label>
        <div className="auth-input-wrapper">
          <KeyRound size={18} className="auth-input-icon" />
          <input
            type="password"
            className="auth-input"
            placeholder="Minimo 8, letra maiuscula, minuscula e numero"
            value={signupPassword}
            onChange={(event) => setSignupPassword(event.target.value)}
            disabled={signupLoading}
          />
        </div>
      </div>

      <div className="auth-input-group">
        <label>Confirmar senha *</label>
        <div className="auth-input-wrapper">
          <KeyRound size={18} className="auth-input-icon" />
          <input
            type="password"
            className="auth-input"
            placeholder="Repita a senha"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={signupLoading}
          />
        </div>
      </div>

      <button type="submit" className={`auth-button ${signupLoading ? 'auth-button-loading' : ''}`} disabled={signupLoading}>
        {signupLoading ? <Loader2 size={18} className="spin-icon" /> : <CheckCircle2 size={18} />}
        {signupLoading ? 'Criando acesso seguro...' : 'Finalizar Cadastro'}
      </button>
    </form>
  );

  // ---------------------------------------------------------------------
  // Painel dividido (Login <-> passo Empresa do cadastro)
  // ---------------------------------------------------------------------
  const renderLoginFormPanel = () => (
    <>
      <div className="auth-switch-header">
        <img src={hennderIcon} alt="Hennder ERP" className="auth-switch-logo" />
        <h1>Entrar</h1>
      </div>

      {loginError && <div className="auth-error">{loginError}</div>}

      {loginLoading && (
        <div className="auth-loading-panel" aria-live="polite">
          <div className="auth-loading-orbit">
            <span className="auth-loading-ring" aria-hidden="true" />
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
          <label>CNPJ da Empresa <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Deixe em branco se for logar com E-mail)</span></label>
          <div className="auth-input-wrapper">
            <span className="auth-input-icon" style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 'bold' }}>#</span>
            <input
              type="text"
              className="auth-input"
              placeholder="00.000.000/0000-00"
              value={empresa}
              disabled={loginLoading}
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
              style={{ textTransform: 'none' }}
              placeholder="Dono: seu@email.com / Funcionário: joao"
              value={loginStr}
              disabled={loginLoading}
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
              disabled={loginLoading}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className={`auth-button ${loginLoading ? 'auth-button-loading' : ''}`} disabled={loginLoading}>
          {loginLoading ? <span className="auth-btn-spinner" aria-hidden="true" /> : <LogIn size={18} />}
          {loginLoading ? loadingMessage : 'Entrar no Sistema'}
        </button>
      </form>

      <p className="auth-switch-social-label">Ou entre com</p>
      <SocialIcons />
    </>
  );

  const renderCompanyFormPanel = () => (
    <>
      <div className="auth-switch-header">
        <img src={hennderIcon} alt="Hennder ERP" className="auth-switch-logo" />
        <h1>Criar conta</h1>
      </div>

      {signupError && <div className="auth-error">{signupError}</div>}
      {signupSuccess && <div className="auth-success">{signupSuccess}</div>}

      <form className="auth-form" onSubmit={handleStart}>
        <div className="auth-input-group">
          <label>Nome da Empresa / Negocio *</label>
          <div className="auth-input-wrapper">
            <Store size={18} className="auth-input-icon" />
            <input
              type="text"
              className="auth-input"
              placeholder="Ex: Mercado Central, Loja Aurora"
              value={nomeOficina}
              onChange={(event) => setNomeOficina(event.target.value)}
              disabled={signupLoading}
            />
          </div>
        </div>

        <div className="auth-input-group">
          <label>CNPJ da Empresa *</label>
          <div className="auth-input-wrapper">
            <span className="auth-input-icon" style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>#</span>
            <input
              type="text"
              className="auth-input"
              placeholder="00.000.000/0000-00"
              value={cnpj}
              onChange={(event) => setCnpj(formatCnpj(event.target.value))}
              disabled={signupLoading}
              maxLength={18}
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="auth-input-group">
          <label>Seu Nome *</label>
          <div className="auth-input-wrapper">
            <User size={18} className="auth-input-icon" />
            <input
              type="text"
              className="auth-input"
              placeholder="Joao da Silva"
              value={nomeResponsavel}
              onChange={(event) => setNomeResponsavel(event.target.value)}
              disabled={signupLoading}
            />
          </div>
        </div>

        <div className="auth-input-group">
          <label>E-mail para login *</label>
          <div className="auth-input-wrapper">
            <Mail size={18} className="auth-input-icon" />
            <input
              type="email"
              className="auth-input"
              placeholder="seu@email.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={signupLoading}
            />
          </div>
        </div>

        <div className="auth-input-group">
          <label>Telefone com WhatsApp *</label>
          <div className="auth-input-wrapper">
            <Phone size={18} className="auth-input-icon" />
            <input
              type="tel"
              className="auth-input"
              placeholder="(27) 99999-9999"
              value={telefone}
              onChange={(event) => setTelefone(formatPhone(event.target.value))}
              disabled={signupLoading}
              maxLength={15}
              inputMode="tel"
            />
          </div>
        </div>

        <button type="submit" className={`auth-button ${signupLoading ? 'auth-button-loading' : ''}`} disabled={signupLoading}>
          {signupLoading ? <Loader2 size={18} className="spin-icon" /> : <ShieldCheck size={18} />}
          {signupLoading ? 'Validando empresa...' : 'Validar e Enviar Codigo'}
        </button>
      </form>

      <p className="auth-switch-social-label">Ou cadastre-se com</p>
      <SocialIcons />
    </>
  );

  const isSplitView = mode === 'login' || (mode === 'signup' && signupStep === 'company');

  // O splash precisa ser renderizado nos DOIS returns: o login sai por este
  // early return, e antes ele nao mostrava splash nenhum -- ficava 2s parado
  // no formulario, que era a "travada" relatada.
  if (isSplitView) {
    return (
      <>
        {showSplash && <BootSplash />}
        <div className="auth-switch-container" style={{ display: showSplash ? 'none' : undefined }}>
        <div className={`auth-switch-card mode-${mode}`}>
          <div className="auth-switch-form-panel">
            {mode === 'login' ? renderLoginFormPanel() : renderCompanyFormPanel()}
          </div>

          <div className="auth-switch-accent-panel">
            {mode === 'login' ? (
              <>
                <h2>Novo por aqui?</h2>
                <p>Cadastre sua empresa e comece a usar o Hennder ERP em minutos.</p>
                <button type="button" className="auth-switch-ghost-button" onClick={handleToggleMode}>
                  Criar Conta
                </button>
              </>
            ) : (
              <>
                <h2>Já tem uma conta?</h2>
                <p>Entre com seu e-mail e senha para acessar o sistema.</p>
                <button type="button" className="auth-switch-ghost-button" onClick={handleToggleMode}>
                  Entrar
                </button>
              </>
            )}
          </div>
        </div>
        </div>
      </>
    );
  }

  // Passos de Validacao/Senha do cadastro -- nao cabem no painel dividido,
  // continuam no layout de card unico (identico ao Register.tsx de antes).
  return (
    <>
      {showSplash && <BootSplash />}

      <div className="auth-container" style={{ display: showSplash ? 'none' : 'flex' }}>
        <div className={`auth-card auth-register-card ${signupLoading ? 'auth-card-loading' : ''}`}>
          <div className="auth-header">
            <img src={hennderIcon} alt="Hennder ERP" className="auth-logo" />
            <h1>Crie sua conta</h1>
            <p>Cadastre sua empresa com validacao de CNPJ e e-mail.</p>
          </div>

          {renderStepHeader()}

          {signupError && <div className="auth-error">{signupError}</div>}
          {signupSuccess && <div className="auth-success">{signupSuccess}</div>}

          {signupStep === 'codes' && renderCodesStep()}
          {signupStep === 'password' && renderPasswordStep()}

          <div className="auth-footer">
            Ja tem uma conta?
            <button className="auth-link" onClick={() => { setSignupStep('company'); handleToggleMode(); }} disabled={signupLoading}>
              Fazer login
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default AuthPage;
