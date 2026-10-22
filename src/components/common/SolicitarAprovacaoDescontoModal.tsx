import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { X, ShieldAlert, Loader2, Smartphone } from 'lucide-react';
import { db } from '../../services/firebase';
import { confirmarSenhaDoUsuario as validarSenha } from '../../services/confirmacaoSenhaService';
import { cancelarLiberacao, consultarLiberacao, pedirLiberacaoAoGerente } from '../../services/liberacaoRemotaService';
import {
  INTERVALO_CONSULTA_ESTACAO_MS,
  MINUTOS_DE_VALIDADE_DO_PEDIDO,
  segundosRestantes,
  textoDoTempoRestante,
  type TelaDoPedidoRemoto,
} from '../../utils/liberacaoRemotaDomain';
import { hasModuleAccess } from '../../utils/roles';
import { isRegistroDeVendedor } from '../../utils/vendedorCadastroDomain';
import { normalizarCodigoVendedor } from '../../utils/vendedorPinDomain';
import { validarVendedor, VendedorPinError } from '../../services/vendedorPinService';
import { liberarDescontoNoServidor } from '../../services/liberacaoDescontoService';
import { VendaServidorError } from '../../services/vendaServidorService';
import type { TelaDoDesconto } from '../../utils/conferenciaDescontoDomain';
import { showError } from '../../utils/alerts';
import { useAuth } from '../../contexts/AuthContext';
import { createAuditLog } from '../../services/logService';

// A senha do aprovador e' conferida num app Firebase secundario
// (confirmacaoSenhaService.ts): o token da sessao recem-aberta e' a prova que
// o servidor confere; a senha em si nao sai daqui.

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
  /** Venda pelo servidor: comprovante da liberacao, gasto no Finalizar. */
  comprovanteId?: string;
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
  /**
   * Venda pelo servidor (19/10/2026): a senha/PIN e' conferida pelo servidor,
   * que devolve o comprovante desta liberacao (tela e valores do desconto).
   * Sem isto (chave desligada, Orcamento), a tela confere como sempre.
   */
  liberacaoNoServidor?: { tela: TelaDoDesconto; baseCentavos: number; descontoCentavos: number } | null;
  /**
   * Liberacao pelo celular (21/10/2026, liberacaoRemotaDomain.ts): com isto a
   * janela ganha "Pedir ao gerente pelo celular". O pedido vai ao servidor,
   * quem pode liberar recebe o aviso no app e responde com PIN/senha; esta
   * tela acompanha e segue sozinha. `documento` = "Pedido #0231 — JOÃO".
   */
  pedirAoGerente?: { tela: TelaDoPedidoRemoto; baseCentavos: number; descontoCentavos: number; documento: string } | null;
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
  liberacaoNoServidor = null,
  pedirAoGerente = null,
}) => {
  const { currentUser } = useAuth();
  const [aprovadores, setAprovadores] = useState<Aprovador[]>([]);
  const [isLoadingAprovadores, setIsLoadingAprovadores] = useState(false);
  const [aprovadorId, setAprovadorId] = useState('');
  const [senha, setSenha] = useState('');
  const [isValidando, setIsValidando] = useState(false);
  // Pedido ao gerente pelo celular: enquanto `remoto` existe, a janela espera
  // (consulta o servidor a cada 3 s) e mostra o tempo que falta.
  const [remoto, setRemoto] = useState<{ id: string; expiraEmMs: number } | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [pedindoAoGerente, setPedindoAoGerente] = useState(false);
  const [avisoDoPedido, setAvisoDoPedido] = useState('');

  useEffect(() => {
    if (!open) setRemoto(null);
  }, [open]);

  useEffect(() => {
    if (!remoto) return undefined;
    let vivo = true;
    const relogio = window.setInterval(() => setSegundos(segundosRestantes(remoto, Date.now())), 1000);
    const consultar = async () => {
      try {
        const r = await consultarLiberacao(remoto.id);
        if (!vivo) return;
        if (r.status === 'aprovada') {
          setRemoto(null);
          onAprovado({ aprovadoPorId: r.aprovadorId || '', aprovadoPorNome: r.aprovadorNome || 'Gerente', ...(r.comprovanteId ? { comprovanteId: r.comprovanteId } : {}) });
          onClose();
        } else if (r.status === 'recusada') {
          setRemoto(null);
          showError('Desconto recusado', `${r.aprovadorNome || 'O gerente'} recusou o desconto${r.motivoRecusa ? `: ${r.motivoRecusa}` : '.'}`);
        } else if (r.status === 'vencida') {
          setRemoto(null);
          showError('Sem resposta', `O gerente não respondeu em ${MINUTOS_DE_VALIDADE_DO_PEDIDO} minutos. Peça de novo ou digite a senha aqui.`);
        } else if (r.status === 'cancelada') {
          setRemoto(null);
        }
      } catch {
        // Sem resposta agora: tenta no proximo ciclo.
      }
    };
    const consulta = window.setInterval(() => { void consultar(); }, INTERVALO_CONSULTA_ESTACAO_MS);
    return () => { vivo = false; window.clearInterval(relogio); window.clearInterval(consulta); };
  }, [remoto]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePedirAoGerente = async () => {
    if (!pedirAoGerente) return;
    setPedindoAoGerente(true);
    try {
      const r = await pedirLiberacaoAoGerente({ ...pedirAoGerente, motivo });
      setSegundos(segundosRestantes({ expiraEmMs: r.expiraEmMs }, Date.now()));
      setAvisoDoPedido(r.avisosDesligados
        ? 'Pedido enviado. Os avisos no celular ainda não estão configurados: o gerente precisa abrir o app em Liberações.'
        : r.aparelhosAvisados === 0
          ? 'Pedido enviado. Nenhum celular ativou os avisos: o gerente precisa abrir o app em Liberações.'
          : `Pedido enviado para ${r.aparelhosAvisados === 1 ? '1 celular' : `${r.aparelhosAvisados} celulares`}.`);
      setRemoto({ id: r.id, expiraEmMs: r.expiraEmMs });
    } catch (erro) {
      showError('Não foi possível pedir ao gerente', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setPedindoAoGerente(false);
    }
  };

  const desistirDoPedido = () => {
    if (remoto) void cancelarLiberacao(remoto.id).catch(() => undefined);
    setRemoto(null);
  };

  const fechar = () => {
    desistirDoPedido();
    onClose();
  };

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
      let idConfirmado: string;
      let comprovanteId = '';
      if (liberacaoNoServidor) {
        // Venda pelo servidor: quem decide e' o servidor (confere o PIN, ou a
        // sessao recem-aberta com a senha, e a permissao de liberar).
        const resultado = await liberarDescontoNoServidor({
          ...liberacaoNoServidor,
          aprovador: aprovador.tipo === 'vendedor'
            ? { tipo: 'vendedor', codigo: aprovador.codigoVendedor || '', pin: senha }
            : { tipo: 'login', idToken: (await validarSenha(aprovador.email || '', senha)).idToken },
        });
        idConfirmado = resultado.aprovadoPorId;
        comprovanteId = resultado.comprovanteId;
      } else {
        idConfirmado = aprovador.tipo === 'vendedor'
          ? (await validarVendedor(aprovador.codigoVendedor || '', senha)).vendedorId
          : (await validarSenha(aprovador.email || '', senha)).uid;
      }

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
      // Pelo servidor, quem grava o log da liberacao e' o proprio servidor.
      if (!liberacaoNoServidor) {
        registrarLogDeAprovacao({
          status: 'sucesso',
          descricao: `${motivo} Liberado por ${aprovador.nome}.`,
        });
      }

      onAprovado({ aprovadoPorId: aprovador.id, aprovadoPorNome: aprovador.nome, ...(comprovanteId ? { comprovanteId } : {}) });
      onClose();
    } catch (error: any) {
      const ehVendedor = aprovador.tipo === 'vendedor';
      const codigo = error?.code || '';
      // O backend do PIN ja devolve recado pronto e especifico (senha errada,
      // vendedor bloqueado por tentativas, vendedor sem PIN cadastrado) --
      // trocar por um texto generico aqui jogaria fora a parte util.
      // Recusa do servidor (venda pelo servidor) ja' vem em portugues e diz o motivo.
      const recusaDoServidor = error instanceof VendaServidorError;
      const senhaErrada = ehVendedor
        ? (error instanceof VendedorPinError || recusaDoServidor) && error.status === 401
        : codigo.includes('wrong-password') || codigo.includes('invalid-credential');
      const mensagem = ehVendedor || recusaDoServidor
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
          <button type="button" onClick={fechar} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>{motivo}</p>

          {remoto ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
              <Smartphone size={36} color="var(--accent-purple)" />
              <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>Aguardando o gerente no celular…</strong>
              <span style={{ fontSize: '30px', fontWeight: 800, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{textoDoTempoRestante(segundos)}</span>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {avisoDoPedido} Assim que ele responder, esta tela segue sozinha.
              </p>
              <button type="button" className="btn-secondary" onClick={desistirDoPedido} style={{ marginTop: '4px' }}>
                Cancelar o pedido e digitar a senha aqui
              </button>
            </div>
          ) : isLoadingAprovadores ? (
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

          {!remoto && pedirAoGerente && (
            <button
              type="button"
              onClick={() => void handlePedirAoGerente()}
              disabled={pedindoAoGerente}
              title={`O gerente recebe um aviso no celular e responde pelo app com o PIN/senha dele; esta tela segue sozinha. Ele tem ${MINUTOS_DE_VALIDADE_DO_PEDIDO} minutos.`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', padding: '11px 12px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--accent-purple)', background: 'transparent', color: 'var(--accent-purple)', fontWeight: 600, fontSize: '14px', cursor: pedindoAoGerente ? 'default' : 'pointer', opacity: pedindoAoGerente ? 0.6 : 1 }}
            >
              {pedindoAoGerente ? <Loader2 size={18} className="spin-animation" /> : <Smartphone size={18} />}
              {pedindoAoGerente ? 'Enviando o pedido...' : 'Pedir ao gerente pelo celular'}
            </button>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: 'var(--bg-primary)' }}>
          <button type="button" className="btn-secondary" onClick={fechar}>Cancelar</button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleConfirmar()}
            disabled={isValidando || aprovadores.length === 0 || Boolean(remoto)}
            style={{ opacity: (isValidando || aprovadores.length === 0 || remoto) ? 0.6 : 1 }}
          >
            {isValidando ? 'Validando...' : 'Liberar desconto'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SolicitarAprovacaoDescontoModal;
