import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import { Building2, Loader2, Lock, MonitorCheck, User } from 'lucide-react';
import { auth } from '../../services/firebase';
import { entrarComUsuarioESenha, LoginFuncionarioError } from '../../services/loginFuncionarioService';
import { ativarComputadorDoCaixa } from '../../services/terminalCaixaService';
import { ErroDoServidor } from '../../services/apiServidor';
import { formatarCnpj } from '../../utils/loginIdentidadeDomain';
import type { TerminalDoCaixa } from '../../utils/terminalCaixaDomain';
import { guardarTerminal } from '../../utils/terminalCaixaStorage';
import '../../pages/Auth/Auth.css';

/**
 * Ativar ESTE computador (22/11/2026): o dono ou um administrador entra uma
 * vez com usuario e senha; depois, cada funcionario entra neste computador
 * (no sistema e na Frente de Caixa) so' com o codigo e a senha dele.
 *
 * O login do gerente serve so' para ativar: sai dele no fim. Nao troca a
 * filial dele (o computador fica na filial em que ele esta') e, fora do app
 * do caixa, nao mexe no "lembrar login" (o sistema e' por aba).
 */
interface Props {
  cnpjInicial: string;
  /** App do caixa: login persistente. Sistema: false (login por aba). */
  persistenciaLocal: boolean;
  /** Avisa a tela que vai logar so' para ativar (o caixa nao pode redirecionar). */
  onComecar?: () => void;
  onTerminar?: () => void;
  onAtivado: (terminal: TerminalDoCaixa) => void;
  onVoltar: () => void;
}

const AtivarComputadorForm: React.FC<Props> = ({ cnpjInicial, persistenciaLocal, onComecar, onTerminar, onAtivado, onVoltar }) => {
  const [cnpj, setCnpj] = useState(() => formatarCnpj(cnpjInicial));
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [nome, setNome] = useState('Caixa 1');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const ativar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!nome.trim()) {
      setErro('Dê um nome para este computador (por exemplo, "Caixa 1" ou "Balcão").');
      return;
    }
    onComecar?.();
    setCarregando(true);
    try {
      await entrarComUsuarioESenha({ cnpj, usuario, senha }, { persistenciaLocal, filialPadrao: false });
      const ativado = await ativarComputadorDoCaixa(nome);
      await guardarTerminal(ativado);
      await signOut(auth).catch(() => undefined);
      onAtivado(ativado);
    } catch (error) {
      await signOut(auth).catch(() => undefined);
      setErro(error instanceof LoginFuncionarioError || error instanceof ErroDoServidor
        ? error.message
        : 'Não foi possível ativar este computador. Tente novamente.');
    } finally {
      setSenha('');
      setCarregando(false);
      onTerminar?.();
    }
  };

  return (
    <form className="auth-form" onSubmit={ativar}>
      <div className="auth-info-panel">
        <strong>Login do dono ou de um administrador</strong>
        <span>Isso é feito uma vez. O dono entra com o e-mail do cadastro; o administrador, com o usuário dele. Depois, cada funcionário entra neste computador só com o código e a senha dele (cadastrados em Usuários).</span>
      </div>
      <div className="auth-input-group">
        <label htmlFor="ativar-cnpj">CNPJ da empresa</label>
        <div className="auth-input-wrapper">
          <Building2 size={18} className="auth-input-icon" />
          <input id="ativar-cnpj" className="auth-input" type="text" inputMode="numeric" value={cnpj}
            onChange={(e) => setCnpj(formatarCnpj(e.target.value))} disabled={carregando} autoFocus={!cnpj} />
        </div>
      </div>
      <div className="auth-input-group">
        <label htmlFor="ativar-usuario">E-mail ou usuário</label>
        <div className="auth-input-wrapper">
          <User size={18} className="auth-input-icon" />
          <input id="ativar-usuario" className="auth-input" type="text" autoComplete="username" value={usuario}
            onChange={(e) => setUsuario(e.target.value)} disabled={carregando} autoFocus={Boolean(cnpj)} style={{ textTransform: 'none' }} />
        </div>
      </div>
      <div className="auth-input-group">
        <label htmlFor="ativar-senha">Senha</label>
        <div className="auth-input-wrapper">
          <Lock size={18} className="auth-input-icon" />
          <input id="ativar-senha" className="auth-input" type="password" autoComplete="current-password" value={senha}
            onChange={(e) => setSenha(e.target.value)} disabled={carregando} />
        </div>
      </div>
      <div className="auth-input-group">
        <label htmlFor="ativar-nome">Nome deste computador</label>
        <div className="auth-input-wrapper">
          <MonitorCheck size={18} className="auth-input-icon" />
          <input id="ativar-nome" className="auth-input" type="text" maxLength={40} value={nome}
            onChange={(e) => setNome(e.target.value)} disabled={carregando}
            title="Para saber depois qual é qual (por exemplo, Caixa 1, Balcão, Escritório)" />
        </div>
      </div>

      {erro && <div className="auth-error">{erro}</div>}

      <button className="auth-button" type="submit" disabled={carregando}>
        {carregando ? <Loader2 size={18} className="spin-icon" /> : <MonitorCheck size={18} />}
        {carregando ? 'Ativando...' : 'Ativar este computador'}
      </button>
      <button type="button" className="auth-link" style={{ margin: '0 auto' }} onClick={onVoltar} disabled={carregando}>
        Voltar
      </button>
    </form>
  );
};

export default AtivarComputadorForm;
