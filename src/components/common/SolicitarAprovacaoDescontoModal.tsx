import React, { useEffect, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { X, ShieldAlert, Loader2 } from 'lucide-react';
import { db, firebaseConfig } from '../../services/firebase';
import { hasModuleAccess } from '../../utils/roles';
import { showError } from '../../utils/alerts';

const SECONDARY_APP_NAME = 'DescontoApprovalApp';

/** Autentica um usuario do tenant num app Firebase SECUNDARIO, sem afetar a
 * sessao principal (mesmo padrao de UsuarioForm.tsx ao criar funcionario).
 * Reaproveita a mesma instancia nomeada entre chamadas -- initializeApp com
 * um nome ja usado lanca erro, e este modal pode abrir varias vezes na
 * mesma sessao de venda. */
const validarSenha = async (email: string, senha: string): Promise<string> => {
  const existente = getApps().find((app) => app.name === SECONDARY_APP_NAME);
  const secondaryApp = existente || initializeApp(firebaseConfig, SECONDARY_APP_NAME);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const credential = await signInWithEmailAndPassword(secondaryAuth, email, senha);
    return credential.user.uid;
  } finally {
    // Sempre desloga o app secundario, mesmo em falha -- nunca deixa uma
    // sessao paralela pendurada.
    await signOut(secondaryAuth).catch(() => {});
  }
};

interface Aprovador {
  id: string;
  nome: string;
  email: string;
}

export interface AprovacaoDesconto {
  aprovadoPorId: string;
  aprovadoPorNome: string;
}

interface SolicitarAprovacaoDescontoModalProps {
  open: boolean;
  tenantId: string | null | undefined;
  /** Texto explicando o que esta sendo liberado (ex: "Desconto de 15% em
   * um pedido com limite de 10%."). */
  motivo: string;
  onClose: () => void;
  onAprovado: (aprovacao: AprovacaoDesconto) => void;
}

/**
 * Modal reusado por Pedido de Venda, OS, Orcamento e PDV: pede a senha de
 * um aprovador (quem tem vendas.liberar_desconto, ou e' Admin/Master/dono)
 * pra liberar um desconto acima do limite configurado (nivel 2, modo
 * "senha"). Nao mexe na sessao de quem esta vendendo.
 */
const SolicitarAprovacaoDescontoModal: React.FC<SolicitarAprovacaoDescontoModalProps> = ({
  open,
  tenantId,
  motivo,
  onClose,
  onAprovado,
}) => {
  const [aprovadores, setAprovadores] = useState<Aprovador[]>([]);
  const [isLoadingAprovadores, setIsLoadingAprovadores] = useState(false);
  const [aprovadorId, setAprovadorId] = useState('');
  const [senha, setSenha] = useState('');
  const [isValidando, setIsValidando] = useState(false);

  useEffect(() => {
    if (!open || !tenantId) return;
    setAprovadorId('');
    setSenha('');
    setIsLoadingAprovadores(true);

    const carregarAprovadores = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId)));
        const lista: Aprovador[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const podeAprovar = hasModuleAccess({
            role: data.role,
            isOwner: docSnap.id === tenantId,
            permissions: data.permissoes,
            requiredPermission: 'vendas.liberar_desconto',
          });
          if (podeAprovar && data.email) {
            lista.push({ id: docSnap.id, nome: data.nome || data.nomeResponsavel || data.email, email: data.email });
          }
        });
        lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        setAprovadores(lista);
      } catch (error) {
        console.error('Erro ao carregar aprovadores de desconto:', error);
      } finally {
        setIsLoadingAprovadores(false);
      }
    };

    void carregarAprovadores();
  }, [open, tenantId]);

  if (!open) return null;

  const handleConfirmar = async () => {
    const aprovador = aprovadores.find((item) => item.id === aprovadorId);
    if (!aprovador) {
      showError('Atenção', 'Selecione quem está liberando o desconto.');
      return;
    }
    if (!senha) {
      showError('Atenção', 'Digite a senha do aprovador.');
      return;
    }

    setIsValidando(true);
    try {
      const uid = await validarSenha(aprovador.email, senha);
      if (uid !== aprovador.id) {
        // Nao deveria acontecer (email e' unico por usuario), mas se
        // acontecer e' mais seguro recusar do que aprovar com identidade
        // incerta.
        showError('Erro', 'Não foi possível confirmar a identidade do aprovador.');
        return;
      }
      onAprovado({ aprovadoPorId: aprovador.id, aprovadoPorNome: aprovador.nome });
      onClose();
    } catch (error: any) {
      const codigo = error?.code || '';
      const mensagem = codigo.includes('wrong-password') || codigo.includes('invalid-credential')
        ? 'Senha incorreta.'
        : 'Não foi possível validar a senha. Tente novamente.';
      showError('Aprovação recusada', mensagem);
    } finally {
      setIsValidando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div className="card" style={{
        backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '100%', maxWidth: '440px', overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-primary)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <ShieldAlert size={20} color="#f59e0b" />
            Liberar desconto
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{motivo}</p>

          {isLoadingAprovadores ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <Loader2 size={16} className="spin-animation" /> Carregando aprovadores...
            </div>
          ) : aprovadores.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#ef4444' }}>
              Nenhum usuário tem permissão para aprovar desconto. Conceda "Vendas: Aprovar Desconto Acima do Limite"
              a alguém em Configurações → Permissão de Usuários, ou peça a um Admin/Master.
            </p>
          ) : (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aprovador</label>
                <select
                  value={aprovadorId}
                  onChange={(e) => setAprovadorId(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
                >
                  <option value="">Selecione...</option>
                  {aprovadores.map((aprovador) => (
                    <option key={aprovador.id} value={aprovador.id}>{aprovador.nome}</option>
                  ))}
                </select>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Senha</label>
                <input
                  type="password"
                  autoFocus
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleConfirmar(); } }}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
                />
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleConfirmar()}
            disabled={isValidando || aprovadores.length === 0}
            style={{ opacity: (isValidando || aprovadores.length === 0) ? 0.6 : 1 }}
          >
            {isValidando ? 'Validando...' : 'Liberar desconto'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SolicitarAprovacaoDescontoModal;
