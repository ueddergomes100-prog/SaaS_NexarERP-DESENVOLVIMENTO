import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, KeyRound, Loader2, Lock, LogIn, User } from 'lucide-react';
import { browserLocalPersistence, setPersistence, signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import { loginVendedorMobile, VendedorMobileAuthError } from '../../services/vendedorMobileAuthService';
import wordmarkDark from '../../assets/hennder-wordmark-dark.png';
import wordmarkLight from '../../assets/hennder-wordmark-light.png';
import '../Auth/Auth.css';

/**
 * Login do aplicativo do vendedor externo. Dois caminhos, os MESMOS dois
 * jeitos de identidade que o sistema desktop ja tem -- nenhum login novo foi
 * inventado (ver plano em CLAUDE.md / conversa que originou esta feature):
 *
 *  - Vendedor de balcao (sem login no Firebase Auth por desenho): CNPJ +
 *    codigo + PIN, o MESMO que ja usa no balcao. Troca por um custom token
 *    no backend (server/routes/vendedorMobileAuth.routes.js).
 *  - Usuario do sistema (login normal): CNPJ + usuario + senha, exatamente
 *    o mesmo par usado em AuthPage.tsx (mesmo indice `usernames`).
 *
 * Depois do login, quem decide se a pessoa realmente entra e' o
 * VendedorShell (confere `acessoAppMobile` no AuthContext) -- esta tela so
 * autentica.
 */

type Modo = 'vendedor' | 'usuario';

const VendedorLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [modo, setModo] = useState<Modo>('vendedor');
  const [cnpj, setCnpj] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const handleEntrarVendedor = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!cnpj.trim() || !codigo.trim() || !pin.trim()) {
      setErro('Preencha o CNPJ da empresa, o código e a senha.');
      return;
    }
    setCarregando(true);
    try {
      const { token } = await loginVendedorMobile(cnpj, codigo, pin);
      // Persistencia LOCAL (nao a sessionStorage padrao do resto do
      // sistema, ver services/firebase.ts): o app instalado na tela de
      // inicio do celular precisa continuar logado depois de fechado e
      // reaberto, diferente do desktop compartilhado.
      await setPersistence(auth, browserLocalPersistence);
      await signInWithCustomToken(auth, token);
      navigate('/vendedor', { replace: true });
    } catch (error) {
      setErro(error instanceof VendedorMobileAuthError ? error.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  };

  const handleEntrarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const usuarioLimpo = usuario.trim().toLowerCase();
    if (!cnpjLimpo || !usuarioLimpo || !senha) {
      setErro('Preencha o CNPJ da empresa, o usuário e a senha.');
      return;
    }
    setCarregando(true);
    try {
      const chave = `${cnpjLimpo}-${usuarioLimpo}`;
      const usernameDoc = await getDoc(doc(db, 'usernames', chave));
      if (!usernameDoc.exists()) {
        setErro('Usuário ou CNPJ da empresa não encontrado.');
        return;
      }
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, usernameDoc.data().email, senha);
      navigate('/vendedor', { replace: true });
    } catch {
      setErro('Usuário ou senha incorretos.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-aurora" aria-hidden="true">
        <span className="auth-aurora-blob one" />
        <span className="auth-aurora-blob two" />
        <span className="auth-aurora-blob three" />
        <span className="auth-aurora-grid" />
      </div>

      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-brand-mark">
            <img className="auth-brand-img is-dark" src={wordmarkDark} alt="Hennder Company" />
            <img className="auth-brand-img is-light" src={wordmarkLight} alt="Hennder Company" />
          </span>
          <h1>Vendedor Externo</h1>
          <p>Acesso ao aplicativo mobile</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', padding: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '10px' }}>
          <button
            type="button"
            onClick={() => { setModo('vendedor'); setErro(''); }}
            style={{
              flex: 1, padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600,
              backgroundColor: modo === 'vendedor' ? 'var(--brand-600)' : 'transparent',
              color: modo === 'vendedor' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            Vendedor de balcão
          </button>
          <button
            type="button"
            onClick={() => { setModo('usuario'); setErro(''); }}
            style={{
              flex: 1, padding: '10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: 600,
              backgroundColor: modo === 'usuario' ? 'var(--brand-600)' : 'transparent',
              color: modo === 'usuario' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            Usuário do sistema
          </button>
        </div>

        <form className="auth-form" onSubmit={modo === 'vendedor' ? handleEntrarVendedor : handleEntrarUsuario}>
          <div className="auth-input-group">
            <label>CNPJ da empresa</label>
            <div className="auth-input-wrapper">
              <Building2 size={18} className="auth-input-icon" />
              <input
                className="auth-input"
                type="text"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                disabled={carregando}
                autoFocus
              />
            </div>
          </div>

          {modo === 'vendedor' ? (
            <>
              <div className="auth-input-group">
                <label>Código do vendedor</label>
                <div className="auth-input-wrapper">
                  <User size={18} className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 07"
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    disabled={carregando}
                    style={{ letterSpacing: '4px', fontWeight: 700 }}
                  />
                </div>
              </div>
              <div className="auth-input-group">
                <label>Senha</label>
                <div className="auth-input-wrapper">
                  <KeyRound size={18} className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type="password"
                    inputMode="numeric"
                    placeholder="Senha do balcão"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    disabled={carregando}
                    style={{ letterSpacing: '4px', fontWeight: 700 }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="auth-input-group">
                <label>Usuário</label>
                <div className="auth-input-wrapper">
                  <User size={18} className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type="text"
                    placeholder="Seu usuário"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                    disabled={carregando}
                    style={{ textTransform: 'none' }}
                  />
                </div>
              </div>
              <div className="auth-input-group">
                <label>Senha</label>
                <div className="auth-input-wrapper">
                  <Lock size={18} className="auth-input-icon" />
                  <input
                    className="auth-input"
                    type="password"
                    placeholder="Sua senha"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    disabled={carregando}
                  />
                </div>
              </div>
            </>
          )}

          {erro && <div className="auth-error">{erro}</div>}

          <button className="auth-button" type="submit" disabled={carregando}>
            {carregando ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="auth-footer">Sincroniza direto com o Hennder ERP</div>
      </div>
    </div>
  );
};

export default VendedorLoginPage;
