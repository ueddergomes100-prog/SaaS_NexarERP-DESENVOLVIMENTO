import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Loader2, Lock, LogIn, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { entrarComUsuarioESenha, LoginFuncionarioError } from '../../services/loginFuncionarioService';
import { CNPJ_LEMBRADO_STORAGE_KEY, formatarCnpj, normalizarCnpj } from '../../utils/loginIdentidadeDomain';
import { CAMINHO_APP_CAIXA } from '../../utils/frenteDeCaixaDomain';
import wordmarkDark from '../../assets/hennder-wordmark-dark.webp';
import wordmarkLight from '../../assets/hennder-wordmark-light.webp';
import '../Auth/Auth.css';

/**
 * Login da Frente de Caixa como app separado (/caixa/login, 19/10/2026):
 * CNPJ da empresa + usuario + senha -- o MESMO par do sistema e do app do
 * vendedor (loginFuncionarioService). Esta tela so' autentica; quem decide
 * se a pessoa entra e' o CaixaShell.
 */
const CaixaLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, loading } = useAuth();
  // O CNPJ do caixa nao muda: vem preenchido do ultimo acesso, mesma chave
  // que a tela de login do sistema usa.
  const [cnpj, setCnpj] = useState(() => formatarCnpj(localStorage.getItem(CNPJ_LEMBRADO_STORAGE_KEY) || ''));
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const cnpjLembrado = normalizarCnpj(cnpj).length === 14;

  // Ja' logado (o app instalado continua logado): nada a fazer aqui.
  if (!loading && currentUser) {
    return <Navigate to={CAMINHO_APP_CAIXA} replace />;
  }

  const handleCnpjChange = (valor: string) => {
    const formatado = formatarCnpj(valor);
    setCnpj(formatado);
    if (normalizarCnpj(formatado).length === 14) {
      localStorage.setItem(CNPJ_LEMBRADO_STORAGE_KEY, formatado);
    }
  };

  const handleEntrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await entrarComUsuarioESenha({ cnpj, usuario, senha });
      navigate(CAMINHO_APP_CAIXA, { replace: true });
    } catch (error) {
      setErro(error instanceof LoginFuncionarioError ? error.message : 'Não foi possível entrar. Tente novamente.');
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
          <h1>Frente de Caixa</h1>
          <p>Entre com o mesmo usuário e senha do sistema</p>
        </div>

        <form className="auth-form" onSubmit={handleEntrar}>
          <div className="auth-input-group">
            <label htmlFor="caixa-cnpj">CNPJ da empresa</label>
            <div className="auth-input-wrapper">
              <Building2 size={18} className="auth-input-icon" />
              <input
                id="caixa-cnpj"
                className="auth-input"
                type="text"
                inputMode="numeric"
                value={cnpj}
                onChange={(e) => handleCnpjChange(e.target.value)}
                disabled={carregando}
                autoFocus={!cnpjLembrado}
              />
            </div>
          </div>
          <div className="auth-input-group">
            <label htmlFor="caixa-usuario">Usuário</label>
            <div className="auth-input-wrapper">
              <User size={18} className="auth-input-icon" />
              <input
                id="caixa-usuario"
                className="auth-input"
                type="text"
                autoComplete="username"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                disabled={carregando}
                autoFocus={cnpjLembrado}
                style={{ textTransform: 'none' }}
              />
            </div>
          </div>
          <div className="auth-input-group">
            <label htmlFor="caixa-senha">Senha</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input
                id="caixa-senha"
                className="auth-input"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                disabled={carregando}
              />
            </div>
          </div>

          {erro && <div className="auth-error">{erro}</div>}

          <button className="auth-button" type="submit" disabled={carregando}>
            {carregando ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
            {carregando ? 'Entrando...' : 'Entrar no caixa'}
          </button>
        </form>

        <div className="auth-footer">O caixa fica aberto neste computador; o sistema completo pode ficar em outra aba.</div>
      </div>
    </div>
  );
};

export default CaixaLoginPage;
