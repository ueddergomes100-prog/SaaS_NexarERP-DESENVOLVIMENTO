import React, { useState } from 'react';
import { Hash, KeyRound, Loader2, LogIn } from 'lucide-react';
import { ErroDoServidor } from '../../services/apiServidor';
import { limparCodigoDoOperador } from '../../utils/terminalCaixaDomain';
import '../../pages/Auth/Auth.css';

/**
 * Entrar com CODIGO + SENHA num computador ativado (22/11/2026). Usado pela
 * Frente de Caixa e pelo login do sistema: o que muda e' so' o `entrar`
 * (o caixa pede a senha a partir de 2 digitos; o sistema, de 4 -- regra no servidor).
 */
interface Props {
  entrar: (codigo: string, pin: string) => Promise<void>;
  onUsarSenha: () => void;
  textoDoBotao: string;
  aviso?: string;
  /** Mensagem extra embaixo dos campos (ex.: senha de 4 digitos no sistema). */
  dica?: string;
}

const EntrarComCodigoForm: React.FC<Props> = ({ entrar, onUsarSenha, textoDoBotao, aviso, dica }) => {
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (!codigo || !pin) {
      setErro('Digite o seu código e a sua senha.');
      return;
    }
    setCarregando(true);
    try {
      await entrar(codigo, pin);
    } catch (error) {
      setPin('');
      setErro(error instanceof ErroDoServidor || error instanceof Error
        ? error.message
        : 'Não foi possível entrar. Confira o código e a senha e tente de novo.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={enviar}>
      {aviso && <div className="auth-success">{aviso}</div>}
      <div className="auth-input-group">
        <label htmlFor="entrar-codigo">Seu código</label>
        <div className="auth-input-wrapper">
          <Hash size={18} className="auth-input-icon" />
          <input id="entrar-codigo" className="auth-input" type="text" inputMode="numeric" autoComplete="off" maxLength={2}
            value={codigo} onChange={(e) => setCodigo(limparCodigoDoOperador(e.target.value))} disabled={carregando} autoFocus />
        </div>
      </div>
      <div className="auth-input-group">
        <label htmlFor="entrar-pin">Sua senha</label>
        <div className="auth-input-wrapper">
          <KeyRound size={18} className="auth-input-icon" />
          <input id="entrar-pin" className="auth-input" type="password" inputMode="numeric" autoComplete="off" maxLength={10}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} disabled={carregando} />
        </div>
      </div>
      {dica && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '-6px' }}>{dica}</span>}

      {erro && <div className="auth-error">{erro}</div>}

      <button className="auth-button" type="submit" disabled={carregando}>
        {carregando ? <Loader2 size={18} className="spin-icon" /> : <LogIn size={18} />}
        {carregando ? 'Entrando...' : textoDoBotao}
      </button>
      <button type="button" className="auth-link" style={{ margin: '0 auto' }} onClick={onUsarSenha} disabled={carregando}>
        Entrar com usuário e senha
      </button>
    </form>
  );
};

export default EntrarComCodigoForm;
