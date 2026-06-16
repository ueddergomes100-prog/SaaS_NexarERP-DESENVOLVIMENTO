import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, LogIn, Loader2 } from 'lucide-react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from '../../services/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import Swal from 'sweetalert2';
import { createSessionId } from '../../utils/session';
import './Auth.css';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [empresa, setEmpresa] = useState(() => localStorage.getItem('nexus_login_cnpj') || '');
  const [loginStr, setLoginStr] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSplash, setShowSplash] = useState(false);

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

      const userCredential = await signInWithEmailAndPassword(auth, finalEmail, password);
      const user = userCredential.user;
      
      // Buscar tenantId do usuario no Firestore para salvar o log na empresa correta
      let userTenantId = 'geral';
      let activeSessionId = '';
      try {
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          userTenantId = userData.tenantId || 'geral';
          activeSessionId = userData.activeSessionId || '';
        }
      } catch (e) {
        console.error('Erro ao obter tenantId para log de login:', e);
      }

      if (activeSessionId) {
        const result = await Swal.fire({
          title: 'Sessão Ativa Detectada',
          text: 'Esta conta já possui uma sessão ativa em outro dispositivo ou navegador. Deseja encerrar a outra sessão e entrar aqui?',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#8b5cf6',
          cancelButtonColor: '#d33',
          confirmButtonText: 'Sim, derrubar a outra e entrar',
          cancelButtonText: 'Não, manter a outra ativa'
        });

        if (!result.isConfirmed) {
          // Desloga o usuário e aborta o login
          await signOut(auth);
          setLoading(false);
          return;
        }
      }

      // Cria um ID de sessão local único
      const newSessionId = createSessionId();
      localStorage.setItem('nexus_session_id', newSessionId);

      // Atualiza no Firestore
      try {
        await updateDoc(doc(db, 'usuarios', user.uid), {
          activeSessionId: newSessionId
        });
      } catch (e) {
        console.error('Erro ao registrar nova sessao no firestore:', e);
        localStorage.removeItem('nexus_session_id');
        await signOut(auth);
        setError('Nao foi possivel registrar a sessao. Tente novamente.');
        setLoading(false);
        return;
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
      } catch (logErr) {}

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
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">N</div>
          <h1>Bem-vindo ao Nexar ERP</h1>
          <p>Faça login para acessar o sistema da sua empresa.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

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
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="auth-button" disabled={loading}>
            {loading ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
            {loading ? 'Entrando...' : 'Entrar no Sistema'}
          </button>
        </form>

        <div className="auth-footer">
          Não tem uma conta? 
          <button className="auth-link" onClick={() => navigate('/cadastro')}>
            Cadastre-se grátis
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

export default Login;
