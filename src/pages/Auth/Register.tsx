import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, Store, ArrowRight, Loader2 } from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';
import './Auth.css';

const Register: React.FC = () => {
  const navigate = useNavigate();
  const [nomeOficina, setNomeOficina] = useState('');
  const [nomeResponsavel, setNomeResponsavel] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeOficina || !nomeResponsavel || !cnpj || !email || !password) {
      setError('Preencha todos os campos obrigatórios (incluindo CNPJ).');
      return;
    }

    const cnpjLimpo = cnpj.replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) {
      setError('O CNPJ deve conter 14 dígitos válidos.');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Cria o usuário no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Salva os dados da oficina/tenant no Firestore associados ao UID
      await setDoc(doc(db, 'usuarios', user.uid), {
        uid: user.uid,
        nomeOficina,
        nomeResponsavel,
        nome: nomeResponsavel,
        username: nomeResponsavel.split(' ')[0].toLowerCase() + Math.floor(Math.random() * 1000),
        cnpj: cnpjLimpo,
        email,
        role: 'Admin', // Garante que a pessoa nova seja dona da oficina
        tenantId: user.uid, // O tenant da oficina é o próprio UID do criador
        createdAt: serverTimestamp(),
        status: 'Ativo', // Status SaaS
        plano: 'Pro',
        valorMensalidade: 149.90
      });

      // 3. Pré-popula as configurações da oficina
      await setDoc(doc(db, 'configuracoes', user.uid), {
        nomeOficina,
        nomeUsuario: nomeResponsavel,
        cnpj: cnpjLimpo,
        email,
        planoContasReceitas: ['Serviços', 'Venda de Peças', 'Outras Receitas'],
        planoContasDespesas: ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Impostos', 'Fornecedores de Peças', 'Marketing', 'Manutenção', 'Outros'],
        tenantId: user.uid,
        createdAt: serverTimestamp()
      });

      // 4. Redireciona para o painel
      navigate('/dashboard');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este e-mail já está em uso.');
      } else {
        setError('Erro ao criar conta. Verifique os dados e tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: '480px' }}>
        <div className="auth-header">
          <div className="auth-logo">N</div>
          <h1>Crie sua conta</h1>
          <p>Cadastre sua oficina e comece a usar o Nexar ERP.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form className="auth-form" onSubmit={handleRegister}>
          <div className="auth-input-group">
            <label>Nome da Oficina / Auto Center *</label>
            <div className="auth-input-wrapper">
              <Store size={18} className="auth-input-icon" />
              <input 
                type="text" 
                className="auth-input" 
                placeholder="Ex: Oficina do João" 
                value={nomeOficina}
                onChange={(e) => setNomeOficina(e.target.value)}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>CNPJ da Oficina *</label>
            <div className="auth-input-wrapper">
              <span className="auth-input-icon" style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>#</span>
              <input 
                type="text" 
                className="auth-input" 
                placeholder="00.000.000/0000-00" 
                value={cnpj}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  let formatted = val;
                  if (val.length <= 14) {
                    formatted = val.replace(/^(\d{2})(\d)/, '$1.$2')
                                   .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                                   .replace(/\.(\d{3})(\d)/, '.$1/$2')
                                   .replace(/(\d{4})(\d)/, '$1-$2');
                  }
                  setCnpj(formatted);
                }}
                maxLength={18}
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
                placeholder="João da Silva" 
                value={nomeResponsavel}
                onChange={(e) => setNomeResponsavel(e.target.value)}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>E-mail (para login) *</label>
            <div className="auth-input-wrapper">
              <Mail size={18} className="auth-input-icon" />
              <input 
                type="email" 
                className="auth-input" 
                placeholder="seu@email.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="auth-input-group">
            <label>Senha *</label>
            <div className="auth-input-wrapper">
              <Lock size={18} className="auth-input-icon" />
              <input 
                type="password" 
                className="auth-input" 
                placeholder="Mínimo de 6 caracteres" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button type="submit" className="auth-button" disabled={loading} style={{ marginTop: '16px' }}>
            {loading ? <Loader2 size={18} className="spin-icon" /> : 'Criar Conta e Acessar'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div className="auth-footer">
          Já tem uma conta? 
          <button className="auth-link" onClick={() => navigate('/login')}>
            Fazer login
          </button>
        </div>
      </div>
    </div>
  );
};

export default Register;
