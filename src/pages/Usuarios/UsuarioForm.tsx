import React, { useState } from 'react';
import { ArrowLeft, Save, UserCog, AlertCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, setDoc, doc, serverTimestamp, getDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { db, firebaseConfig } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showSuccess, showError, NexusSwal } from '../../utils/alerts';
import {
  checarPrefixoDaEmpresa,
  checarUsername,
  montarChaveUsername,
  montarEmailSintetico,
  normalizarUsername,
  type ChecagemPrefixo,
} from '../../utils/loginIdentidadeDomain';
import {
  CODIGO_VENDEDOR_DIGITOS,
  isPinVendedorFraco,
  isPinVendedorValido,
  MENSAGEM_CODIGO_INVALIDO,
  MENSAGEM_PIN_FRACO,
  MENSAGEM_PIN_INVALIDO,
  normalizarCodigoVendedor,
  PIN_VENDEDOR_DIGITOS,
} from '../../utils/vendedorPinDomain';
import { definirPinVendedor, VendedorPinError } from '../../services/vendedorPinService';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { DEFAULT_NIVEL_ACESSO } from '../../utils/visibilidadeVendasDomain';

// Importa app secundário para criar usuário sem deslogar o dono
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';

const UsuarioForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = !!id;
  const { tenantId, currentUser } = useAuth();
  
  const [formData, setFormData] = useState({
    nome: '',
    username: '',
    senha: '',
    codigoVendedor: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  /** Resultado da checagem do CNPJ da empresa -- ver loginIdentidadeDomain.ts.
   *  `null` enquanto carrega. */
  const [checagemPrefixo, setChecagemPrefixo] = useState<ChecagemPrefixo | null>(null);
  const [pinVendedor, setPinVendedor] = useState('');
  const [salvandoPin, setSalvandoPin] = useState(false);

  React.useEffect(() => {
    if (isEditing && id) {
      const fetchUser = async () => {
        const userSnap = await getDoc(doc(db, 'usuarios', id));
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFormData({
            nome: data.nome || '',
            username: data.username || '',
            senha: '',
            codigoVendedor: data.codigoVendedor || ''
          });
        }
      };
      fetchUser();
    }
  }, [id, isEditing]);

  // O prefixo do login do funcionario e' o CNPJ da empresa -- e SO ele.
  //
  // Antes havia dois fallbacks aqui (slug do nome da oficina, e os 4
  // primeiros caracteres do tenantId) para empresa sem CNPJ. Mas a tela de
  // login SEMPRE monta a chave com o CNPJ digitado: o funcionario criado sob
  // um prefixo alternativo era gravado com uma chave que o login nunca
  // conseguiria produzir, e simplesmente NUNCA entrava -- com uma mensagem
  // ("Usuário ou CNPJ não encontrado") que mandava procurar no lugar errado.
  //
  // Agora falha cedo, no cadastro, com instrucao de onde resolver.
  React.useEffect(() => {
    const fetchCnpjEmpresa = async () => {
      if (!tenantId) return;
      try {
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        setChecagemPrefixo(checarPrefixoDaEmpresa(configSnap.exists() ? configSnap.data().cnpj : ''));
      } catch (e) {
        console.error('Erro ao carregar o CNPJ da empresa:', e);
        setChecagemPrefixo(checarPrefixoDaEmpresa(''));
      }
    };
    fetchCnpjEmpresa();
  }, [tenantId]);

  /** O codigo ja esta em uso por OUTRO funcionario da mesma empresa?
   *  Dois vendedores com o mesmo codigo carimbariam venda e comissao na
   *  pessoa errada -- e o backend recusa a validacao nesse caso. */
  const codigoJaEmUso = async (codigo: string): Promise<boolean> => {
    if (!codigo || !tenantId) return false;
    const snap = await getDocs(query(
      collection(db, 'usuarios'),
      where('tenantId', '==', tenantId),
      where('codigoVendedor', '==', codigo),
    ));
    return snap.docs.some((documento) => documento.id !== id);
  };

  /**
   * Grava o PIN pelo backend. Nao passa pelo Firestore: o hash mora numa
   * colecao que as rules negam pra todo mundo, e a comparacao acontece no
   * servidor -- 4 digitos validados no navegador nao valeriam nada.
   */
  const handleSalvarPin = async () => {
    if (!id) return;
    if (!isPinVendedorValido(pinVendedor)) {
      showError('Senha inválida', MENSAGEM_PIN_INVALIDO);
      return;
    }
    const codigoAtual = normalizarCodigoVendedor(formData.codigoVendedor);
    if (!codigoAtual) {
      showError('Falta o código', 'Cadastre e salve o código do vendedor antes de definir a senha dele.');
      return;
    }
    if (isPinVendedorFraco(pinVendedor)) {
      const confirma = await NexusSwal.fire({
        title: 'Senha fácil de adivinhar',
        text: MENSAGEM_PIN_FRACO,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Usar mesmo assim',
        cancelButtonText: 'Escolher outra',
        reverseButtons: true,
      });
      if (!confirma.isConfirmed) return;
    }

    setSalvandoPin(true);
    try {
      await definirPinVendedor(id, pinVendedor);
      setPinVendedor('');
      showSuccess('Senha do vendedor salva!');
    } catch (error) {
      const mensagem = error instanceof VendedorPinError
        ? error.message
        : 'Não foi possível salvar a senha do vendedor.';
      showError('Erro ao salvar senha', mensagem);
    } finally {
      setSalvandoPin(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !currentUser) return;
    
    setIsLoading(true);

    if (isEditing && id) {
      try {
        const codigo = normalizarCodigoVendedor(formData.codigoVendedor);
        if (formData.codigoVendedor && !codigo) {
          showError('Código inválido', MENSAGEM_CODIGO_INVALIDO);
          return;
        }
        if (codigo && await codigoJaEmUso(codigo)) {
          showError('Código já usado', `Outro funcionário desta empresa já usa o código ${codigo}. Escolha um código diferente.`);
          return;
        }

        await updateDoc(doc(db, 'usuarios', id), {
          nome: formData.nome,
          // Campo omitido quando vazio em vez de gravado como undefined --
          // o Firestore recusa undefined e derrubaria o save inteiro.
          ...(codigo ? { codigoVendedor: codigo } : {}),
          updatedAt: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        showSuccess('Usuário atualizado com sucesso!');
        navigate('/usuarios');
      } catch (err) {
        console.error(err);
        showError('Erro', 'Não foi possível atualizar o usuário.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Validação de Limite de Usuários para a Empresa
    try {
      const qUsers = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const qSnap = await getDocs(qUsers);
      const currentCount = qSnap.size;

      // Obtém o limite configurado no documento do dono da oficina (tenantId)
      const ownerDoc = await getDoc(doc(db, 'usuarios', tenantId));
      const limit = ownerDoc.exists() ? (ownerDoc.data().limiteUsuarios !== undefined ? ownerDoc.data().limiteUsuarios : 3) : 3;

      if (currentCount >= limit) {
        showError('Limite Atingido', `Sua empresa atingiu o limite de ${limit} usuários contratados. Entre em contato com o suporte para alterar o limite do seu plano.`);
        setIsLoading(false);
        return;
      }
    } catch (e) {
      console.error("Erro ao validar limite de usuários:", e);
    }

    // Sem CNPJ valido na empresa, o funcionario nasceria incapaz de logar --
    // bloqueia aqui, dizendo onde resolver, em vez de criar um usuario morto.
    const checagem = checagemPrefixo ?? checarPrefixoDaEmpresa('');
    if (!checagem.ok) {
      showError('Cadastro da empresa incompleto', checagem.motivo);
      setIsLoading(false);
      return;
    }

    const checagemUsuario = checarUsername(formData.username);
    if (!checagemUsuario.ok) {
      showError('Atenção', checagemUsuario.motivo);
      setIsLoading(false);
      return;
    }
    if (formData.senha.length < 6) {
      showError('Atenção', 'A senha deve ter pelo menos 6 caracteres.');
      setIsLoading(false);
      return;
    }

    const codigoVendedor = normalizarCodigoVendedor(formData.codigoVendedor);
    if (formData.codigoVendedor && !codigoVendedor) {
      showError('Código inválido', MENSAGEM_CODIGO_INVALIDO);
      setIsLoading(false);
      return;
    }
    if (codigoVendedor && await codigoJaEmUso(codigoVendedor)) {
      showError('Código já usado', `Outro funcionário desta empresa já usa o código ${codigoVendedor}. Escolha um código diferente.`);
      setIsLoading(false);
      return;
    }

    // A MESMA funcao que a tela de login usa pra montar a chave -- e' isso
    // que garante que criacao e login nunca mais divirjam.
    const usernameFinal = montarChaveUsername(checagem.cnpj, checagemUsuario.username);

    setIsLoading(true);

    const fakeEmail = montarEmailSintetico(usernameFinal);

    try {
      // 1. Inicia um App Secundário para não deslogar o dono
      const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
      const secondaryAuth = getAuth(secondaryApp);

      // 2. Cria a conta no Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, fakeEmail, formData.senha);
      const novoUID = userCredential.user.uid;

      // Desloga do app secundário para limpar a sessão paralela
      await signOut(secondaryAuth);

      await setDoc(doc(db, 'usuarios', novoUID), {
        nome: formData.nome,
        username: usernameFinal,
        email: fakeEmail,
        // Codigo do vendedor: chave curta usada no popup de identificacao na
        // venda. Nao e' segredo (o PIN e' que e'). Omitido quando vazio --
        // Firestore recusa undefined.
        ...(codigoVendedor ? { codigoVendedor } : {}),
        role: 'Funcionario',
        // Nivel de visibilidade de vendas. Nasce no nivel mais restrito; quem
        // precisa ver as vendas dos colegas e' promovido a 'administracao'
        // no popup do escudo (tela de Usuarios) ou em Configuracoes >
        // Permissao de Usuarios. Ver src/utils/visibilidadeVendasDomain.ts.
        nivelAcesso: DEFAULT_NIVEL_ACESSO,
        permissoes: [], // Sem acesso a princípio
        tenantId: tenantId, // Vincula à oficina do dono
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid,
        status: 'Ativo',
        ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
      });

      // 4. Salva no índice global de usernames para o Login poder descobrir o email depois
      await setDoc(doc(db, 'usernames', usernameFinal), {
        email: fakeEmail,
        tenantId: tenantId
      });

      showSuccess('Usuário criado com sucesso!');
      navigate('/usuarios');
      
    } catch (error: any) {
      console.error('Erro ao criar usuário:', error);
      if (error.code === 'auth/email-already-in-use') {
        showError('Erro', 'Este nome de usuário já está em uso.');
      } else {
        showError('Erro', 'Não foi possível criar o usuário. Tente novamente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn back-btn" onClick={() => navigate('/usuarios')} title="Voltar"><ArrowLeft size={20} /></button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>{isEditing ? 'Editar Usuário' : 'Novo Usuário'}</h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>{isEditing ? 'Altere o nome do funcionário' : 'Cadastre um funcionário para acessar o sistema'}</p>
          </div>
        </div>
      </div>

          {!isEditing && (
            <div className="card" style={{ marginBottom: '24px', backgroundColor: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              <div style={{ display: 'flex', gap: '12px', padding: '16px' }}>
                <AlertCircle size={24} color="#8b5cf6" style={{ flexShrink: 0 }} />
                <div>
                  <h4 style={{ color: '#8b5cf6', margin: '0 0 4px', fontSize: '14px' }}>Como seu funcionário fará o Login?</h4>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Ele deverá informar o <strong>CNPJ da Empresa</strong> e o nome de usuário (ex: <strong style={{ color: 'var(--text-primary)' }}>{formData.username.trim().toLowerCase().replace(/\s+/g, '') || 'nome'}</strong>).
                  </p>
                </div>
              </div>
            </div>
          )}

      <form onSubmit={handleSubmit} className="card" style={{ padding: '32px', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '24px' }}>
        <div className="section-header" style={{ gridColumn: 'span 12', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)', marginBottom: '8px' }}>
          <UserCog size={20} className="section-icon" />
          <h3>Dados de Acesso</h3>
        </div>

        <div className="input-group" style={{ gridColumn: 'span 6' }}>
          <label>Nome Completo do Funcionário *</label>
          <input 
            type="text" 
            placeholder="Ex: João da Silva"
            value={formData.nome}
            onChange={(e) => setFormData({...formData, nome: e.target.value})}
            required
            style={{ width: '100%' }}
          />
        </div>


        {!isEditing && (
          <>
            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Nome de Usuário para Login *</label>
              <input 
                type="text" 
                placeholder="ex: joao"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
                required
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Na tela de login, ele informará o CNPJ da empresa (<strong>{checagemPrefixo?.cnpj || '—'}</strong>) e o Usuário: <strong>{normalizarUsername(formData.username) || 'joao'}</strong>
              </span>
            </div>

            <div className="input-group" style={{ gridColumn: 'span 6' }}>
              <label>Senha de Acesso *</label>
              <input 
                type="password" 
                placeholder="Mínimo 6 caracteres"
                value={formData.senha}
                onChange={(e) => setFormData({...formData, senha: e.target.value})}
                required
                minLength={6}
                style={{ width: '100%' }}
              />
            </div>
          </>
        )}

        {/* Identificacao do vendedor na venda: codigo publico + PIN secreto.
            O codigo mora no documento do usuario; o PIN vai pro backend e
            NUNCA passa pelo Firestore visivel ao cliente. */}
        <div className="input-group" style={{ gridColumn: 'span 6' }}>
          <label>Código do Vendedor ({CODIGO_VENDEDOR_DIGITOS} dígitos)</label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Ex: 07"
            value={formData.codigoVendedor}
            onChange={(e) => setFormData({ ...formData, codigoVendedor: e.target.value.replace(/\D/g, '').slice(0, CODIGO_VENDEDOR_DIGITOS) })}
            onBlur={(e) => {
              const normalizado = normalizarCodigoVendedor(e.target.value);
              if (normalizado) setFormData((atual) => ({ ...atual, codigoVendedor: normalizado }));
            }}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Usado no popup de identificação a cada venda, quando essa opção estiver ligada em Configurações. Opcional — deixe vazio se este usuário não vende.
          </span>
        </div>

        {isEditing && (
          <div className="input-group" style={{ gridColumn: 'span 6' }}>
            <label>Senha do Vendedor ({PIN_VENDEDOR_DIGITOS} dígitos)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="password"
                inputMode="numeric"
                placeholder="0000"
                value={pinVendedor}
                onChange={(e) => setPinVendedor(e.target.value.replace(/\D/g, '').slice(0, PIN_VENDEDOR_DIGITOS))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={salvandoPin || !pinVendedor}
                onClick={() => void handleSalvarPin()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {salvandoPin ? 'Salvando...' : 'Salvar senha'}
              </button>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Cadastre aqui também quando o funcionário <strong>esquecer a senha</strong> — salvar uma nova substitui a antiga e destrava na hora quem estiver bloqueado por tentativas.
            </span>
          </div>
        )}

        <div className="input-group" style={{ gridColumn: 'span 12', marginTop: '8px' }}>
          <div style={{ padding: '12px 16px', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 'var(--radius-md)', color: '#3b82f6', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserCog size={18} style={{ flexShrink: 0 }} />
            <span>As permissões de acesso deste usuário (Módulos) devem ser configuradas no menu <strong>Configurações &gt; Permissão de Usuários</strong> após a criação.</span>
          </div>
        </div>

        <div style={{ gridColumn: 'span 12', display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-color)' }}>
          <button type="button" className="btn-secondary" onClick={() => navigate('/usuarios')}>Cancelar</button>
          <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} disabled={isLoading}>
            <Save size={20} />
            {isLoading ? 'Salvando...' : 'Salvar Funcionário'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default UsuarioForm;
