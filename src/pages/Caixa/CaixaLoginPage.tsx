import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { Building2, Hash, KeyRound, Loader2, Lock, LogIn, MonitorCheck, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { auth } from '../../services/firebase';
import { entrarComUsuarioESenha, LoginFuncionarioError } from '../../services/loginFuncionarioService';
import { ativarComputadorDoCaixa, entrarNoCaixaComCodigo } from '../../services/terminalCaixaService';
import { ErroDoServidor } from '../../services/apiServidor';
import { CNPJ_LEMBRADO_STORAGE_KEY, formatarCnpj, normalizarCnpj } from '../../utils/loginIdentidadeDomain';
import { CAMINHO_APP_CAIXA } from '../../utils/frenteDeCaixaDomain';
import { limparCodigoDoOperador, type TerminalDoCaixa } from '../../utils/terminalCaixaDomain';
import { guardarTerminal, lerTerminalGuardado } from '../../utils/terminalCaixaStorage';
import wordmarkDark from '../../assets/hennder-wordmark-dark.webp';
import wordmarkLight from '../../assets/hennder-wordmark-light.webp';
import '../Auth/Auth.css';

/**
 * Entrada da Frente de Caixa como app separado (/caixa/login).
 *
 * Tres jeitos (22/11/2026, pedido do dono: 3 funcionarios no mesmo computador
 * durante o dia, sem digitar usuario/e-mail a cada troca):
 *  - CODIGO + SENHA: computador ativado como caixa (terminalCaixaService); cada
 *    funcionario entra com o codigo e a senha do cadastro dele em Usuarios;
 *  - USUARIO E SENHA: o de sempre (CNPJ + usuario + senha do sistema);
 *  - ATIVAR ESTE COMPUTADOR: uma vez, com o login do dono ou de um administrador.
 * Esta tela so' autentica; quem decide se a pessoa entra e' o CaixaShell.
 */
type Modo = 'carregando' | 'codigo' | 'senha' | 'ativar';

const mensagemDoErro = (erro: unknown, padrao: string) => (
  erro instanceof LoginFuncionarioError || erro instanceof ErroDoServidor ? erro.message : padrao
);

const CaixaLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, loading } = useAuth();
  const [modo, setModo] = useState<Modo>('carregando');
  const [terminal, setTerminal] = useState<TerminalDoCaixa | null>(null);
  // O CNPJ do caixa nao muda: vem preenchido do ultimo acesso, mesma chave
  // que a tela de login do sistema usa.
  const [cnpj, setCnpj] = useState(() => {
    try { return formatarCnpj(localStorage.getItem(CNPJ_LEMBRADO_STORAGE_KEY) || ''); } catch { return ''; }
  });
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [nomeDoComputador, setNomeDoComputador] = useState('Caixa 1');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(false);
  // Ativando: o login do gerente e' so' para ativar -- nao pode cair no caixa.
  const [ativando, setAtivando] = useState(false);
  const cnpjLembrado = normalizarCnpj(cnpj).length === 14;

  useEffect(() => {
    let ativo = true;
    void lerTerminalGuardado().then((guardado) => {
      if (!ativo) return;
      setTerminal(guardado);
      if (guardado?.cnpj) setCnpj(formatarCnpj(guardado.cnpj));
      setModo(guardado ? 'codigo' : 'senha');
    });
    return () => { ativo = false; };
  }, []);

  // Ja' logado (o app instalado continua logado): nada a fazer aqui.
  if (!loading && currentUser && !ativando) {
    return <Navigate to={CAMINHO_APP_CAIXA} replace />;
  }

  const trocarModo = (novo: Modo) => {
    setErro('');
    setAviso('');
    setSenha('');
    setPin('');
    setModo(novo);
  };

  const handleCnpjChange = (valor: string) => {
    const formatado = formatarCnpj(valor);
    setCnpj(formatado);
    if (normalizarCnpj(formatado).length === 14) {
      try { localStorage.setItem(CNPJ_LEMBRADO_STORAGE_KEY, formatado); } catch { /* sem armazenamento local */ }
    }
  };

  const handleEntrarComSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    try {
      await entrarComUsuarioESenha({ cnpj, usuario, senha });
      navigate(CAMINHO_APP_CAIXA, { replace: true });
    } catch (error) {
      setErro(mensagemDoErro(error, 'Não foi possível entrar. Tente novamente.'));
    } finally {
      setCarregando(false);
    }
  };

  const handleEntrarComCodigo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminal) return;
    setErro('');
    if (!codigo || !pin) {
      setErro('Digite o seu código e a sua senha.');
      return;
    }
    setCarregando(true);
    try {
      await entrarNoCaixaComCodigo(terminal, codigo, pin);
      navigate(CAMINHO_APP_CAIXA, { replace: true });
    } catch (error) {
      setPin('');
      setErro(mensagemDoErro(error, 'Não foi possível entrar. Confira o código e a senha e tente de novo.'));
    } finally {
      setCarregando(false);
    }
  };

  const handleAtivar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!nomeDoComputador.trim()) {
      setErro('Dê um nome para este computador (por exemplo, "Caixa 1").');
      return;
    }
    setAtivando(true);
    setCarregando(true);
    try {
      await entrarComUsuarioESenha({ cnpj, usuario, senha });
      const ativado = await ativarComputadorDoCaixa(nomeDoComputador);
      await guardarTerminal(ativado);
      setTerminal(ativado);
      setUsuario('');
      trocarModo('codigo');
      setAviso(`Computador ativado como "${ativado.nome}". Agora cada funcionário entra só com o código e a senha dele (cadastrados em Usuários).`);
    } catch (error) {
      setErro(mensagemDoErro(error, 'Não foi possível ativar este computador. Tente novamente.'));
    } finally {
      // O login do gerente serviu so' para ativar: sai dele.
      await signOut(auth).catch(() => undefined);
      setSenha('');
      setCarregando(false);
      setAtivando(false);
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
          <p>
            {modo === 'codigo' && terminal
              ? `${terminal.nome}${terminal.empresa ? ` · ${terminal.empresa}` : ''}`
              : modo === 'ativar'
                ? 'Ativar este computador como caixa'
                : 'Entre com o mesmo usuário e senha do sistema'}
          </p>
        </div>

        {modo === 'carregando' && (
          <div className="auth-form" style={{ alignItems: 'center' }}>
            <Loader2 size={22} className="spin-icon" aria-label="Carregando" />
          </div>
        )}

        {modo === 'codigo' && terminal && (
          <form className="auth-form" onSubmit={handleEntrarComCodigo}>
            {aviso && <div className="auth-success">{aviso}</div>}
            <div className="auth-input-group">
              <label htmlFor="caixa-codigo">Seu código</label>
              <div className="auth-input-wrapper">
                <Hash size={18} className="auth-input-icon" />
                <input
                  id="caixa-codigo"
                  className="auth-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={codigo}
                  onChange={(e) => setCodigo(limparCodigoDoOperador(e.target.value))}
                  disabled={carregando}
                  autoFocus
                />
              </div>
            </div>
            <div className="auth-input-group">
              <label htmlFor="caixa-pin">Sua senha</label>
              <div className="auth-input-wrapper">
                <KeyRound size={18} className="auth-input-icon" />
                <input
                  id="caixa-pin"
                  className="auth-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={10}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  disabled={carregando}
                />
              </div>
            </div>

            {erro && <div className="auth-error">{erro}</div>}

            <button className="auth-button" type="submit" disabled={carregando}>
              {carregando ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
              {carregando ? 'Entrando...' : 'Entrar no caixa'}
            </button>
            <button type="button" className="auth-link" style={{ margin: '0 auto' }} onClick={() => trocarModo('senha')} disabled={carregando}>
              Entrar com usuário e senha
            </button>
          </form>
        )}

        {(modo === 'senha' || modo === 'ativar') && (
          <form className="auth-form" onSubmit={modo === 'ativar' ? handleAtivar : handleEntrarComSenha}>
            {modo === 'ativar' && (
              <div className="auth-info-panel">
                <strong>Login do dono ou de um administrador</strong>
                <span>Isso é feito uma vez. Depois, cada funcionário entra neste computador só com o código e a senha dele (cadastrados em Usuários).</span>
              </div>
            )}
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
            {modo === 'ativar' && (
              <div className="auth-input-group">
                <label htmlFor="caixa-nome-computador">Nome deste computador</label>
                <div className="auth-input-wrapper">
                  <MonitorCheck size={18} className="auth-input-icon" />
                  <input
                    id="caixa-nome-computador"
                    className="auth-input"
                    type="text"
                    maxLength={40}
                    value={nomeDoComputador}
                    onChange={(e) => setNomeDoComputador(e.target.value)}
                    disabled={carregando}
                    title="Para saber depois qual é qual (por exemplo, Caixa 1, Caixa da loja 2)"
                  />
                </div>
              </div>
            )}

            {erro && <div className="auth-error">{erro}</div>}

            <button className="auth-button" type="submit" disabled={carregando}>
              {carregando ? <Loader2 size={18} className="spin-icon" /> : modo === 'ativar' ? <MonitorCheck size={18} /> : <LogIn size={18} />}
              {carregando ? (modo === 'ativar' ? 'Ativando...' : 'Entrando...') : (modo === 'ativar' ? 'Ativar este computador' : 'Entrar no caixa')}
            </button>
            {modo === 'senha' && terminal && (
              <button type="button" className="auth-link" style={{ margin: '0 auto' }} onClick={() => trocarModo('codigo')} disabled={carregando}>
                Entrar com código e senha
              </button>
            )}
            {modo === 'ativar' && (
              <button type="button" className="auth-link" style={{ margin: '0 auto' }} onClick={() => trocarModo(terminal ? 'codigo' : 'senha')} disabled={carregando}>
                Voltar
              </button>
            )}
          </form>
        )}

        {modo !== 'carregando' && modo !== 'ativar' && (
          <div className="auth-footer">
            {terminal
              ? <>Este computador é o caixa “{terminal.nome}”. <button type="button" className="auth-link" onClick={() => trocarModo('ativar')}>Ativar de novo</button></>
              : <>Vários funcionários usam este computador? <button type="button" className="auth-link" onClick={() => trocarModo('ativar')}>Ative-o como caixa</button> e cada um entra só com código e senha.</>}
          </div>
        )}
      </div>
    </div>
  );
};

export default CaixaLoginPage;
