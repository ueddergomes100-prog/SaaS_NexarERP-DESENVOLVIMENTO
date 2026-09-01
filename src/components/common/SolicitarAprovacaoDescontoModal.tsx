import React, { useEffect, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { X, ShieldAlert, Loader2 } from 'lucide-react';
import { db, firebaseConfig } from '../../services/firebase';
import { hasModuleAccess } from '../../utils/roles';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import { normalizarCodigoVendedor } from '../../utils/vendedorPinDomain';
import { validarVendedor, VendedorPinError } from '../../services/vendedorPinService';
import { showError } from '../../utils/alerts';
import { useAuth } from '../../contexts/AuthContext';
import { createAuditLog } from '../../services/logService';

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
  /** Usuario com login confirma com a SENHA (Firebase Auth). */
  email?: string;
  /** Vendedor de balcao confirma com o PROPRIO PIN (codigo + PIN, validado
   *  no backend). Nao tem login nem senha -- ver VendedoresList.tsx. */
  codigoVendedor?: string;
  tipo: 'login' | 'vendedor';
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
  /** Modulo gravado no log de auditoria. 'vendas' cobre pedido, PDV e
   *  orcamento; a OS passa 'mecanica'. */
  moduloLog?: string;
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
  moduloLog = 'vendas',
}) => {
  const { currentUser } = useAuth();
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
          if (!podeAprovar) return;

          // Vendedor de balcao entra pelo codigo, nao pelo e-mail: ele nao tem
          // login nenhum. Sem PIN cadastrado fica de fora -- apareceria na
          // lista e so daria erro na hora de confirmar.
          const ehVendedorSemLogin = isRegistroDeVendedor(data);
          if (ehVendedorSemLogin) {
            const codigo = normalizarCodigoVendedor(data.codigoVendedor);
            if (codigo && data.pinDefinidoEm) {
              lista.push({
                id: docSnap.id,
                nome: data.nome || `Vendedor ${codigo}`,
                codigoVendedor: codigo,
                tipo: 'vendedor',
              });
            }
            return;
          }

          if (data.email) {
            lista.push({
              id: docSnap.id,
              nome: data.nome || data.nomeResponsavel || data.email,
              email: data.email,
              tipo: 'login',
            });
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

  const aprovadorSelecionado = aprovadores.find((item) => item.id === aprovadorId);

  if (!open) return null;

  const registrarLogDeAprovacao = (args: { status: 'sucesso' | 'negado'; descricao: string }) => {
    createAuditLog({
      tenantId: tenantId || '',
      usuarioId: currentUser?.uid || '',
      usuarioEmail: currentUser?.email || currentUser?.uid || '',
      modulo: moduloLog,
      acao: 'aprovacao_desconto',
      descricao: args.descricao,
      status: args.status,
      critical: true,
    });
  };

  const handleConfirmar = async () => {
    const aprovador = aprovadores.find((item) => item.id === aprovadorId);
    if (!aprovador) {
      showError('Atenção', 'Selecione quem está liberando o desconto.');
      return;
    }
    if (!senha) {
      showError('Atenção', aprovador.tipo === 'vendedor'
        ? 'Digite o PIN do vendedor que está liberando.'
        : 'Digite a senha do aprovador.');
      return;
    }

    setIsValidando(true);
    try {
      // Dois jeitos de provar quem e', mesma permissao dos dois lados: quem
      // tem login digita a senha; o vendedor de balcao digita o proprio PIN,
      // validado no backend (com limite de tentativas -- ver
      // server/services/vendedorPin.js).
      const idConfirmado = aprovador.tipo === 'vendedor'
        ? (await validarVendedor(aprovador.codigoVendedor || '', senha)).vendedorId
        : await validarSenha(aprovador.email || '', senha);

      if (idConfirmado !== aprovador.id) {
        // Nao deveria acontecer (e-mail e codigo sao unicos por empresa), mas
        // se acontecer e' mais seguro recusar do que aprovar com identidade
        // incerta.
        showError('Erro', 'Não foi possível confirmar a identidade do aprovador.');
        return;
      }
      // Liberar desconto acima do limite e alguem usando a propria senha pra
      // autorizar dinheiro a menos -- pertence a trilha critica, nao so ao
      // relatorio de descontos. `critical: true` porque a limpeza automatica
      // de 6 meses nao pode levar isto embora.
      //
      // Registrado AQUI, e nao no salvamento da venda, de proposito: a
      // liberacao concedida numa venda que depois foi abandonada nao vira
      // documento nenhum, e era exatamente o caso que sumia sem deixar
      // rastro.
      registrarLogDeAprovacao({
        status: 'sucesso',
        descricao: `${motivo} Liberado por ${aprovador.nome}.`,
      });

      onAprovado({ aprovadoPorId: aprovador.id, aprovadoPorNome: aprovador.nome });
      onClose();
    } catch (error: any) {
      const ehVendedor = aprovador.tipo === 'vendedor';
      const codigo = error?.code || '';
      // O backend do PIN ja devolve recado pronto e especifico (senha errada,
      // vendedor bloqueado por tentativas, vendedor sem PIN cadastrado) --
      // trocar por um texto generico aqui jogaria fora a parte util.
      const senhaErrada = ehVendedor
        ? error instanceof VendedorPinError && error.status === 401
        : codigo.includes('wrong-password') || codigo.includes('invalid-credential');
      const mensagem = ehVendedor
        ? (error?.message || 'Não foi possível validar o PIN. Tente novamente.')
        : (senhaErrada ? 'Senha incorreta.' : 'Não foi possível validar a senha. Tente novamente.');

      // Tentativa recusada tambem entra no log: senha errada repetida no nome
      // de um aprovador e' exatamente o padrao que uma auditoria procura.
      registrarLogDeAprovacao({
        status: 'negado',
        descricao: senhaErrada
          ? `${motivo} Tentativa recusada: ${ehVendedor ? 'PIN incorreto' : 'senha incorreta'} para ${aprovador.nome}.`
          : `${motivo} Tentativa não concluída: falha ao validar ${ehVendedor ? 'o PIN' : 'a senha'} de ${aprovador.nome} (${mensagem}).`,
      });

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
              Ninguém tem permissão para aprovar desconto. Conceda "Vendas: Aprovar Desconto Acima do Limite" a alguém em
              Configurações → Permissão de Usuários, marque "Pode liberar desconto acima do limite" na ficha de um vendedor
              em Cadastros Auxiliares → Vendedores (ele confirma com o próprio PIN), ou peça a um Admin/Master.
            </p>
          ) : (
            <>
              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aprovador</label>
                <select
                  value={aprovadorId}
                  onChange={(e) => { setAprovadorId(e.target.value); setSenha(''); }}
                  style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
                >
                  <option value="">Selecione...</option>
                  {aprovadores.map((aprovador) => (
                    <option key={aprovador.id} value={aprovador.id}>
                      {aprovador.tipo === 'vendedor'
                        ? `${aprovador.nome} (vendedor ${aprovador.codigoVendedor})`
                        : aprovador.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {/* O rotulo muda com o tipo do aprovador: quem tem login
                    digita senha, o vendedor de balcao digita o PIN dele. */}
                <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {aprovadorSelecionado?.tipo === 'vendedor' ? 'PIN do vendedor' : 'Senha'}
                </label>
                <input
                  type="password"
                  autoFocus
                  inputMode={aprovadorSelecionado?.tipo === 'vendedor' ? 'numeric' : undefined}
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
