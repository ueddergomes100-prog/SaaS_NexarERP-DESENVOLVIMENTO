import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  Store,
  User
} from 'lucide-react';
import {
  onboardingService,
  type OnboardingCodeType,
  type PublicCnpjData,
  type StartOnboardingResponse
} from '../../services/onboardingService';
import './Auth.css';

type RegisterStep = 'company' | 'codes' | 'password';

type CodeVerification = {
  email: boolean;
  phone: boolean;
};

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

const Register: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<RegisterStep>('company');
  const [nomeOficina, setNomeOficina] = useState('');
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [onboarding, setOnboarding] = useState<StartOnboardingResponse | null>(null);
  const [cnpjInfo, setCnpjInfo] = useState<PublicCnpjData | null>(null);
  const [verified, setVerified] = useState<CodeVerification>({ email: false, phone: false });
  const [devCodes, setDevCodes] = useState<{ email?: string; phone?: string }>({});
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState<OnboardingCodeType | null>(null);
  const [resending, setResending] = useState<OnboardingCodeType | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();

    const cnpjDigits = cnpj.replace(/\D/g, '');
    const phoneDigits = telefone.replace(/\D/g, '');

    if (!nomeOficina.trim() || !nomeResponsavel.trim() || !cnpjDigits || !email.trim() || !phoneDigits) {
      setError('Preencha todos os campos obrigatorios.');
      return;
    }
    if (cnpjDigits.length !== 14) {
      setError('O CNPJ deve conter 14 digitos validos.');
      return;
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      setError('Informe um telefone celular valido com DDD.');
      return;
    }

    setLoading(true);
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
      setVerified({ email: false, phone: false });
      setEmailCode('');
      setPhoneCode('');
      setStep('codes');
      setSuccess('CNPJ validado. Enviamos os codigos de confirmacao.');
    } catch (err) {
      setError(getErrorMessage(err, 'Nao foi possivel iniciar o cadastro seguro.'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (type: OnboardingCodeType) => {
    if (!onboarding?.onboardingId) return;

    const code = type === 'email' ? emailCode : phoneCode;
    if (code.trim().length < 6) {
      setError('Informe o codigo de 6 digitos.');
      return;
    }

    clearMessages();
    setVerifying(type);
    try {
      if (type === 'email') {
        await onboardingService.verifyEmail({ onboardingId: onboarding.onboardingId, code: code.trim() });
      } else {
        await onboardingService.verifyPhone({ onboardingId: onboarding.onboardingId, code: code.trim() });
      }

      const nextVerified: CodeVerification = { ...verified, [type]: true };
      setVerified(nextVerified);
      setSuccess(type === 'email' ? 'E-mail confirmado com sucesso.' : 'Telefone confirmado com sucesso.');

      if (nextVerified.email && nextVerified.phone) {
        setStep('password');
        setSuccess('Validacoes concluidas. Agora crie a senha de acesso.');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Codigo invalido ou expirado.'));
    } finally {
      setVerifying(null);
    }
  };

  const handleResend = async (type: OnboardingCodeType) => {
    if (!onboarding?.onboardingId) return;

    clearMessages();
    setResending(type);
    try {
      const response = await onboardingService.resendCode(onboarding.onboardingId, type);
      if (response.devCode) {
        setDevCodes(current => ({ ...current, [type]: response.devCode }));
      }
      setSuccess(type === 'email' ? 'Novo codigo enviado para o e-mail.' : 'Novo codigo enviado para o telefone.');
    } catch (err) {
      setError(getErrorMessage(err, 'Nao foi possivel reenviar o codigo.'));
    } finally {
      setResending(null);
    }
  };

  const handleComplete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onboarding?.onboardingId) return;

    clearMessages();
    const passwordError = getPasswordError(password, confirmPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    try {
      await onboardingService.complete({
        onboardingId: onboarding.onboardingId,
        password
      });
      setSuccess('Cadastro aprovado. Voce ja pode entrar no sistema.');
      window.setTimeout(() => navigate('/login', { replace: true }), 1300);
    } catch (err) {
      setError(getErrorMessage(err, 'Nao foi possivel finalizar o cadastro.'));
    } finally {
      setLoading(false);
    }
  };

  const renderStepHeader = () => (
    <div className="auth-steps" aria-label="Etapas do cadastro">
      <span className={`auth-step-pill ${step === 'company' ? 'active' : ''} ${step !== 'company' ? 'done' : ''}`}>
        <Building2 size={14} />
        Empresa
      </span>
      <span className={`auth-step-pill ${step === 'codes' ? 'active' : ''} ${step === 'password' ? 'done' : ''}`}>
        <ShieldCheck size={14} />
        Validacao
      </span>
      <span className={`auth-step-pill ${step === 'password' ? 'active' : ''}`}>
        <KeyRound size={14} />
        Senha
      </span>
    </div>
  );

  const renderCompanyStep = () => (
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
            disabled={loading}
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
            disabled={loading}
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
            disabled={loading}
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
            disabled={loading}
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
            disabled={loading}
            maxLength={15}
            inputMode="tel"
          />
        </div>
      </div>

      <button type="submit" className={`auth-button ${loading ? 'auth-button-loading' : ''}`} disabled={loading}>
        {loading ? <Loader2 size={18} className="spin-icon" /> : <ShieldCheck size={18} />}
        {loading ? 'Validando empresa...' : 'Validar e Enviar Codigos'}
      </button>
    </form>
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
        <div className={`auth-code-card ${verified.email ? 'verified' : ''}`}>
          <div className="auth-code-title">
            <Mail size={18} />
            <div>
              <strong>E-mail</strong>
              <span>{onboarding?.maskedEmail}</span>
            </div>
            {verified.email && <CheckCircle2 size={18} />}
          </div>
          <div className="auth-code-row">
            <input
              className="auth-input auth-code-input"
              placeholder="000000"
              value={emailCode}
              onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={verified.email || verifying === 'email'}
              inputMode="numeric"
            />
            <button
              type="button"
              className="auth-mini-button"
              onClick={() => handleVerifyCode('email')}
              disabled={verified.email || verifying === 'email'}
            >
              {verifying === 'email' ? <Loader2 size={16} className="spin-icon" /> : 'OK'}
            </button>
          </div>
          <button
            type="button"
            className="auth-text-button"
            onClick={() => handleResend('email')}
            disabled={verified.email || resending === 'email'}
          >
            {resending === 'email' ? 'Reenviando...' : 'Reenviar codigo'}
          </button>
        </div>

        <div className={`auth-code-card ${verified.phone ? 'verified' : ''}`}>
          <div className="auth-code-title">
            <Phone size={18} />
            <div>
              <strong>Telefone</strong>
              <span>{onboarding?.maskedPhone}</span>
            </div>
            {verified.phone && <CheckCircle2 size={18} />}
          </div>
          <div className="auth-code-row">
            <input
              className="auth-input auth-code-input"
              placeholder="000000"
              value={phoneCode}
              onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={verified.phone || verifying === 'phone'}
              inputMode="numeric"
            />
            <button
              type="button"
              className="auth-mini-button"
              onClick={() => handleVerifyCode('phone')}
              disabled={verified.phone || verifying === 'phone'}
            >
              {verifying === 'phone' ? <Loader2 size={16} className="spin-icon" /> : 'OK'}
            </button>
          </div>
          <button
            type="button"
            className="auth-text-button"
            onClick={() => handleResend('phone')}
            disabled={verified.phone || resending === 'phone'}
          >
            {resending === 'phone' ? 'Reenviando...' : 'Reenviar codigo'}
          </button>
        </div>
      </div>

      {(devCodes.email || devCodes.phone) && (
        <div className="auth-dev-codes">
          <strong>Codigos de desenvolvimento</strong>
          {devCodes.email && <span>E-mail: {devCodes.email}</span>}
          {devCodes.phone && <span>Telefone: {devCodes.phone}</span>}
        </div>
      )}

      <div className="auth-actions-row">
        <button type="button" className="auth-secondary-button" onClick={() => setStep('company')}>
          Voltar
        </button>
        <button
          type="button"
          className="auth-button"
          disabled={!verified.email || !verified.phone}
          onClick={() => setStep('password')}
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={loading}
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
            disabled={loading}
          />
        </div>
      </div>

      <button type="submit" className={`auth-button ${loading ? 'auth-button-loading' : ''}`} disabled={loading}>
        {loading ? <Loader2 size={18} className="spin-icon" /> : <CheckCircle2 size={18} />}
        {loading ? 'Criando acesso seguro...' : 'Finalizar Cadastro'}
      </button>
    </form>
  );

  return (
    <div className="auth-container">
      <div className={`auth-card auth-register-card ${loading ? 'auth-card-loading' : ''}`}>
        <div className="auth-header">
          <div className="auth-logo">N</div>
          <h1>Crie sua conta</h1>
          <p>Cadastre sua empresa com validacao de CNPJ, e-mail e telefone.</p>
        </div>

        {renderStepHeader()}

        {error && <div className="auth-error">{error}</div>}
        {success && <div className="auth-success">{success}</div>}

        {step === 'company' && renderCompanyStep()}
        {step === 'codes' && renderCodesStep()}
        {step === 'password' && renderPasswordStep()}

        <div className="auth-footer">
          Ja tem uma conta?
          <button className="auth-link" onClick={() => navigate('/login')} disabled={loading}>
            Fazer login
          </button>
        </div>
      </div>
    </div>
  );
};

export default Register;
