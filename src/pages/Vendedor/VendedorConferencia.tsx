import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Camera, CheckCircle2, Loader2, Minus, PackageCheck, Plus, ScanLine, XCircle } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import VendedorHeader from './VendedorHeader';
import TravaDeEdicaoAviso from '../../components/common/TravaDeEdicaoAviso';
import LeitorCameraCodigo, { cameraLeCodigo } from '../../components/common/LeitorCameraCodigo';
import { usePodeLiberarTrava, useTravaDeEdicao } from '../../hooks/useTravaDeEdicao';
import { NexusSwal, showError } from '../../utils/alerts';
import { hasTenantFullAccess } from '../../utils/roles';
import {
  aplicarBipagem,
  computeStatusFinal,
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  encontrarItemPorCodigo,
  ordenarPorLocalizacao,
  podeConferirNoApp,
  podeLancarManual,
  reconciliarItensDaConferencia,
  type BipagemResultado,
  type ConferenciaItem,
  type StatusConferencia,
} from '../../utils/conferenciaDomain';
import {
  abrirConferencia,
  assinaturaDosItens,
  FEEDBACK_COLORS,
  fecharConferencia,
  gravarProgressoDaConferencia,
  montarItensDaConferencia,
  playFeedbackSound,
  STATUS_COLORS,
  STATUS_LABELS,
  textoDoFeedback,
  type AlvoDaConferencia,
} from '../../services/conferenciaService';
import { TrocaError } from '../../services/trocaService';

/**
 * CONFERENCIA PELO CELULAR (pedido do dono, 15/10/2026). Mesma regra e mesmos
 * dados da conferencia do computador (conferenciaService.ts): gravacao a cada
 * bipe, bipagem em duas etapas (le o codigo -> confirma a quantidade), manual
 * so' onde a configuracao deixa, pedido alterado com a conferencia aberta e
 * fechamento Conferido/Divergente. Leitura pela camera (LeitorCameraCodigo)
 * ou digitando. Uma pessoa por vez (trava de edicao).
 */

const campo: React.CSSProperties = {
  width: '100%', padding: '13px 14px', borderRadius: '12px', border: '1px solid var(--border-color)',
  backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '16px',
};
const cartao: React.CSSProperties = {
  flexShrink: 0, borderRadius: 'var(--app-raio-linha)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', border: '1px solid var(--border-color)',
};

const VendedorConferencia: React.FC = () => {
  const { pedidoId: pedidoIdDaRota, trocaId } = useParams();
  const ehTroca = Boolean(trocaId);
  const id = trocaId || pedidoIdDaRota || '';
  const navigate = useNavigate();
  const { currentUser, tenantId, userRole, isOwner, userPermissions, conferenciaMercadoriaAtiva, vendasVisiveisDeUsuarioId } = useAuth();
  const podeVer = podeConferirNoApp({ acessoTotal: hasTenantFullAccess(userRole, isOwner), permissoes: userPermissions, conferenciaAtiva: conferenciaMercadoriaAtiva });
  const alvo: AlvoDaConferencia = { tipo: ehTroca ? 'troca' : 'pedido', id };
  const voltarAFila = useCallback(() => navigate('/vendedor/conferencia'), [navigate]);

  const trava = useTravaDeEdicao({ tipo: 'conferencia', registroId: id, ativa: podeVer });
  const podeLiberarTrava = usePodeLiberarTrava();
  const travaLiberada = trava.situacao === 'minha' || trava.situacao === 'sem_servidor';

  const [carregando, setCarregando] = useState(true);
  const [erroAoAbrir, setErroAoAbrir] = useState<string | null>(null);
  const [numero, setNumero] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [status, setStatus] = useState<StatusConferencia>('em_conferencia');
  const [itens, setItens] = useState<ConferenciaItem[]>([]);
  const [config, setConfig] = useState({ exigirBipagem: DEFAULT_EXIGIR_BIPAGEM, bloquearExcedente: DEFAULT_BLOQUEAR_EXCEDENTE, ordenarMinutaPorLocal: DEFAULT_ORDENAR_MINUTA_POR_LOCAL });
  const [avisoAlteracao, setAvisoAlteracao] = useState<string[] | null>(null);
  const [observacao, setObservacao] = useState('');
  const observacaoTocada = useRef(false);

  const [codigo, setCodigo] = useState('');
  const [cameraAberta, setCameraAberta] = useState(false);
  // Bipagem em duas etapas: o item achado espera a quantidade (manual = lancado sem bipar).
  const [pendente, setPendente] = useState<{ produtoId: string; nome: string; manual: boolean } | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [feedback, setFeedback] = useState<{ resultado: BipagemResultado | 'pendente'; mensagem: string } | null>(null);
  const [fechando, setFechando] = useState(false);

  const [salvamento, setSalvamento] = useState<'ocioso' | 'salvando' | 'salvo' | 'erro'>('ocioso');
  const filaDeGravacao = useRef<Promise<void>>(Promise.resolve());
  const gravacoesPendentes = useRef(0);
  const assinaturaDoPedido = useRef('');
  const itensAtuais = useRef<ConferenciaItem[]>([]);
  useEffect(() => { itensAtuais.current = itens; }, [itens]);

  // Abre so' depois de pegar a vez: quem chega depois nao reabre nem mexe na conferencia do outro.
  useEffect(() => {
    if (!podeVer || !id || !tenantId || !currentUser || !travaLiberada) return;
    let cancelado = false;
    setCarregando(true);
    setErroAoAbrir(null);
    abrirConferencia({ alvo: { tipo: ehTroca ? 'troca' : 'pedido', id }, tenantId, usuario: currentUser, vendasVisiveisDeUsuarioId })
      .then((aberta) => {
        if (cancelado) return;
        setNumero(aberta.numero);
        setClienteNome(aberta.clienteNome || 'Consumidor Final');
        setConfig(aberta.config);
        setItens(aberta.itens);
        setStatus(aberta.status);
        if (aberta.avisos) setAvisoAlteracao(aberta.avisos);
        assinaturaDoPedido.current = aberta.assinaturaDoPedido;
      })
      .catch((erro) => {
        if (cancelado) return;
        console.error('Erro ao abrir a conferência no app:', erro);
        setErroAoAbrir(erro instanceof TrocaError ? erro.message : ((erro as Error).message || 'Não foi possível abrir a conferência.'));
      })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [podeVer, id, ehTroca, tenantId, currentUser, travaLiberada, vendasVisiveisDeUsuarioId]);

  const gravarProgresso = useCallback((itensParaGravar: ConferenciaItem[], observacaoParaGravar: string) => {
    if (!id || !currentUser) return;
    gravacoesPendentes.current += 1;
    setSalvamento('salvando');
    filaDeGravacao.current = filaDeGravacao.current.then(async () => {
      try {
        await gravarProgressoDaConferencia({
          alvo: { tipo: ehTroca ? 'troca' : 'pedido', id },
          uid: currentUser.uid,
          itens: itensParaGravar,
          observacao: observacaoTocada.current ? observacaoParaGravar : undefined,
        });
        gravacoesPendentes.current -= 1;
        setSalvamento(gravacoesPendentes.current > 0 ? 'salvando' : 'salvo');
      } catch (erro) {
        console.error('Erro ao gravar o progresso da conferência no app:', erro);
        gravacoesPendentes.current -= 1;
        setSalvamento('erro');
      }
    });
  }, [id, currentUser, ehTroca]);

  // Pedido alterado (ou cancelado) com a conferencia aberta: a lista acompanha, sem perder o que ja foi bipado.
  useEffect(() => {
    if (!id || ehTroca || carregando || erroAoAbrir || status !== 'em_conferencia') return undefined;
    return onSnapshot(doc(db, 'pedidos_venda', id), (snap) => {
      if (!snap.exists()) return;
      const dados = snap.data();
      if (dados.status === 'Cancelada') {
        setErroAoAbrir('Este pedido foi cancelado e saiu da expedição. Não há mais mercadoria a conferir — guarde de volta o que já foi separado.');
        return;
      }
      const lista = Array.isArray(dados.itens) ? dados.itens : [];
      const assinatura = assinaturaDosItens(lista);
      if (assinatura === assinaturaDoPedido.current) return;
      assinaturaDoPedido.current = assinatura;
      void (async () => {
        const doPedido = await montarItensDaConferencia(lista);
        const reconciliado = reconciliarItensDaConferencia(itensAtuais.current, doPedido);
        if (!reconciliado.mudou) return;
        setItens(reconciliado.itens);
        setAvisoAlteracao(reconciliado.avisos);
        gravarProgresso(reconciliado.itens, observacao);
        playFeedbackSound('excedente');
      })();
    }, (erro) => console.error('Erro ao acompanhar o pedido da conferência:', erro));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ehTroca, carregando, erroAoAbrir, status]);

  // Troca cancelada, recusada ou entregue com a conferencia aberta.
  useEffect(() => {
    if (!id || !ehTroca || carregando || erroAoAbrir || status !== 'em_conferencia') return undefined;
    return onSnapshot(doc(db, 'trocas', id), (snap) => {
      const situacao = snap.exists() ? String(snap.data().status || '').toLowerCase() : '';
      const motivo: Record<string, string> = {
        cancelada: 'Esta troca foi cancelada e saiu da expedição.',
        recusada: 'Esta troca foi recusada e saiu da expedição.',
        entregue: 'Esta troca já foi entregue.',
      };
      if (motivo[situacao]) setErroAoAbrir(`${motivo[situacao]} Não há mais mercadoria a conferir — guarde de volta o que já foi separado.`);
    }, (erro) => console.error('Erro ao acompanhar a troca da conferência:', erro));
  }, [id, ehTroca, carregando, erroAoAbrir, status]);

  /** 1ª etapa: acha o item pelo codigo (bipado, digitado ou lido pela camera), sem aplicar. */
  const resolverCodigo = useCallback((lido: string) => {
    const texto = lido.trim();
    if (!texto) return;
    const item = encontrarItemPorCodigo(itensAtuais.current, texto);
    setCodigo('');
    if (!item) {
      setPendente(null);
      setFeedback({ resultado: 'nao_encontrado', mensagem: textoDoFeedback('nao_encontrado', ehTroca) });
      playFeedbackSound('nao_encontrado');
      return;
    }
    setPendente({ produtoId: item.produtoId, nome: item.nome, manual: false });
    setQuantidade(1);
    setFeedback({ resultado: 'pendente', mensagem: `${item.nome} — confirme a quantidade.` });
  }, [ehTroca]);

  const aoLerPelaCamera = useCallback((lido: string) => {
    setCameraAberta(false);
    resolverCodigo(lido);
  }, [resolverCodigo]);

  /** 2ª etapa: aplica a quantidade confirmada, grava e toca o som. */
  const confirmarPendente = () => {
    if (!pendente) return;
    const { itens: novosItens, resultado } = aplicarBipagem(itens, pendente.produtoId, Math.max(1, quantidade), {
      bloquearExcedente: config.bloquearExcedente,
      exigirBipagem: config.exigirBipagem,
      manual: pendente.manual,
    });
    setItens(novosItens);
    if (resultado !== 'nao_encontrado' && status === 'em_conferencia') gravarProgresso(novosItens, observacao);
    setFeedback({ resultado, mensagem: textoDoFeedback(resultado, ehTroca) });
    playFeedbackSound(resultado);
    if (typeof navigator.vibrate === 'function') navigator.vibrate(resultado === 'ok' ? 40 : [80, 60, 80]);
    setPendente(null);
    setQuantidade(1);
  };

  const fechar = async () => {
    if (!id || !tenantId || !currentUser) return;
    const final = computeStatusFinal(itens);
    const divergentes = itens.filter((item) => item.quantidadeConferida !== item.quantidadePedida);
    const resumo = divergentes.map((item) => `• ${item.nome}: pedido ${item.quantidadePedida}, conferido ${item.quantidadeConferida}`).join('\n');
    const confirmacao = await NexusSwal.fire({
      title: final === 'conferido' ? 'Fechar conferência?' : 'Fechar com divergências?',
      text: final === 'conferido'
        ? 'Todos os itens conferem com o pedido.'
        : `${divergentes.length} de ${itens.length} ${divergentes.length === 1 ? 'item não bateu' : 'itens não bateram'} com o pedido:\n${resumo}`,
      icon: final === 'conferido' ? 'success' : 'warning',
      showCancelButton: true,
      confirmButtonText: final === 'conferido' ? 'Sim, fechar como Conferido' : 'Sim, fechar como Divergente',
      cancelButtonText: 'Voltar e conferir',
    });
    if (!confirmacao.isConfirmed) return;
    setFechando(true);
    try {
      await fecharConferencia({ alvo, tenantId, usuario: currentUser, itens, observacao, numero });
      await NexusSwal.fire({
        title: final === 'conferido' ? 'Conferência concluída!' : 'Conferência fechada com divergências',
        icon: final === 'conferido' ? 'success' : 'warning',
        confirmButtonText: 'Voltar à fila',
      });
      voltarAFila();
    } catch (erro) {
      console.error('Erro ao fechar a conferência no app:', erro);
      showError('Falha ao fechar conferência', (erro as Error).message || 'Não foi possível salvar a conferência.');
    } finally {
      setFechando(false);
    }
  };

  if (!podeVer) return <Navigate to="/vendedor" replace />;

  const titulo = `${ehTroca ? 'Troca' : 'Pedido'} #${numero || '...'}`;
  const comCabecalho = (conteudo: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={`Conferência — ${titulo}`} subtitulo={clienteNome || undefined} aoVoltar={voltarAFila} />
      {conteudo}
    </div>
  );

  if (trava.situacao === 'de_outro') {
    return comCabecalho(
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <TravaDeEdicaoAviso
          rotulo="a conferência"
          mensagem={trava.mensagem}
          onVoltar={voltarAFila}
          onTentarDeNovo={trava.tentarDeNovo}
          onLiberar={podeLiberarTrava ? trava.liberarEAbrir : undefined}
        />
      </div>,
    );
  }
  if (carregando || trava.situacao === 'pegando') {
    return comCabecalho(<div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>Abrindo conferência...</div>);
  }
  if (erroAoAbrir) {
    return comCabecalho(
      <div style={{ padding: '32px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
        <p style={{ color: '#ef4444', margin: 0, fontSize: '15px', lineHeight: 1.45 }}>{erroAoAbrir}</p>
        <button type="button" className="btn-secondary" onClick={voltarAFila}>Voltar à fila</button>
      </div>,
    );
  }

  const exibidos = config.ordenarMinutaPorLocal ? ordenarPorLocalizacao(itens) : itens;
  const conferidos = itens.filter((item) => item.quantidadeConferida === item.quantidadePedida).length;
  const temCamera = cameraLeCodigo();

  return comCabecalho(
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexShrink: 0 }}>
          <span style={{ padding: '4px 12px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[status] }}>{STATUS_LABELS[status]}</span>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600 }}>{conferidos} de {itens.length} itens conferidos</span>
        </div>

        {avisoAlteracao && avisoAlteracao.length > 0 && (
          <div role="alert" style={{ ...cartao, padding: '12px 14px', borderColor: 'rgba(245,158,11,0.6)', backgroundColor: 'rgba(245,158,11,0.12)' }}>
            <strong style={{ color: '#f59e0b', fontSize: '14px' }}>O pedido foi alterado — a lista já está atualizada</strong>
            <ul style={{ margin: '6px 0 8px', paddingLeft: '18px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {avisoAlteracao.map((linha, i) => <li key={i}>{linha}</li>)}
            </ul>
            <button type="button" className="btn-secondary" onClick={() => setAvisoAlteracao(null)} style={{ padding: '6px 14px', fontSize: '13px' }}>Entendi</button>
          </div>
        )}

        {/* Leitura: camera (grande) ou digitar/leitor bluetooth. */}
        <div style={{ ...cartao, padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {temCamera && (
            <button type="button" className="btn-primary" onClick={() => setCameraAberta(true)} disabled={Boolean(pendente)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '14px', fontSize: '16px', borderRadius: '12px' }}>
              <Camera size={20} /> Ler código pela câmera
            </button>
          )}
          <form onSubmit={(e) => { e.preventDefault(); resolverCodigo(codigo); }} style={{ display: 'flex', gap: '8px' }}>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              disabled={Boolean(pendente)}
              placeholder={temCamera ? 'Ou digite o código' : 'Digite o código ou use o leitor'}
              inputMode="text"
              enterKeyHint="go"
              autoComplete="off"
              style={{ ...campo, flex: 1 }}
            />
            <button type="submit" className="btn-secondary" disabled={Boolean(pendente) || !codigo.trim()} aria-label="Procurar código" style={{ padding: '0 16px', borderRadius: '12px', display: 'flex', alignItems: 'center' }}>
              <ScanLine size={20} />
            </button>
          </form>
          {feedback && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: '10px', backgroundColor: `${FEEDBACK_COLORS[feedback.resultado]}20`, color: FEEDBACK_COLORS[feedback.resultado], fontWeight: 600, fontSize: '14px', lineHeight: 1.35 }}>
              {feedback.resultado === 'ok' ? <CheckCircle2 size={18} /> : feedback.resultado === 'excedente' ? <AlertTriangle size={18} /> : feedback.resultado === 'pendente' ? <ScanLine size={18} /> : <XCircle size={18} />}
              <span>{feedback.mensagem}</span>
            </div>
          )}
          <div style={{ fontSize: '12px', fontWeight: 600, color: salvamento === 'erro' ? '#ef4444' : salvamento === 'salvo' ? '#10b981' : 'var(--text-muted)' }}>
            {salvamento === 'salvando' && 'Salvando...'}
            {salvamento === 'salvo' && 'Salvo automaticamente'}
            {salvamento === 'erro' && 'Não foi possível salvar os últimos bipes (verifique a internet). Eles serão salvos no próximo bipe — não feche a tela.'}
          </div>
        </div>

        {exibidos.map((item) => {
          const bate = item.quantidadeConferida === item.quantidadePedida;
          const sobrou = item.quantidadeConferida > item.quantidadePedida;
          const cor = bate ? '#10b981' : sobrou ? '#ef4444' : '#f59e0b';
          const manual = podeLancarManual(item, config.exigirBipagem);
          return (
            <div key={item.produtoId} style={{ ...cartao, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', borderLeft: `4px solid ${cor}` }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, overflowWrap: 'anywhere' }}>{item.nome}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>
                    {[item.localizacaoEstoque && `Local ${item.localizacaoEstoque}`, item.codigo && `Cód. ${item.codigo}`].filter(Boolean).join(' · ') || 'Sem local cadastrado'}
                  </div>
                  {item.removidoDoPedido && <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color: '#ef4444' }}>RETIRADO DO PEDIDO — devolva ao estoque</div>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: cor, fontVariantNumeric: 'tabular-nums' }}>{item.quantidadeConferida}<span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 600 }}> / {item.quantidadePedida}</span></div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.unidadeMedidaSigla || 'UN'} · {bate ? 'OK' : sobrou ? 'Sobrou' : 'Faltou'}</div>
                </div>
              </div>
              {manual && !pendente && (
                <button type="button" className="btn-secondary" onClick={() => { setPendente({ produtoId: item.produtoId, nome: item.nome, manual: true }); setQuantidade(Math.max(1, item.quantidadePedida - item.quantidadeConferida)); setFeedback(null); }} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Plus size={15} /> Lançar sem bipar
                </button>
              )}
            </div>
          );
        })}

        <label style={{ ...cartao, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Observações (opcional)</span>
          <textarea
            value={observacao}
            onChange={(e) => { observacaoTocada.current = true; setObservacao(e.target.value); }}
            onBlur={() => { if (observacaoTocada.current && status === 'em_conferencia') gravarProgresso(itens, observacao); }}
            rows={2}
            title="Alguma observação sobre esta conferência"
            style={{ ...campo, resize: 'vertical', fontSize: '15px' }}
          />
        </label>
      </div>

      {/* Quantidade do item achado (2ª etapa) ou o fechamento, sempre ao alcance do dedo. */}
      <div style={{ flexShrink: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {pendente ? (
          <>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{pendente.nome}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button type="button" className="btn-secondary" aria-label="Diminuir quantidade" onClick={() => setQuantidade((q) => Math.max(1, q - 1))} style={{ width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Minus size={20} /></button>
              <input type="number" inputMode="numeric" min={1} value={quantidade} onChange={(e) => setQuantidade(Math.max(1, Math.floor(Number(e.target.value) || 1)))} onFocus={(e) => e.target.select()} aria-label="Quantidade" style={{ ...campo, width: '90px', textAlign: 'center', fontSize: '20px', fontWeight: 700 }} />
              <button type="button" className="btn-secondary" aria-label="Aumentar quantidade" onClick={() => setQuantidade((q) => q + 1)} style={{ width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Plus size={20} /></button>
              <button type="button" className="btn-primary" onClick={confirmarPendente} style={{ flex: 1, height: '48px', borderRadius: '12px', fontSize: '16px' }}>Confirmar</button>
            </div>
            <button type="button" onClick={() => { setPendente(null); setFeedback(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '13px', alignSelf: 'center', padding: '2px 8px' }}>Cancelar este item</button>
          </>
        ) : (
          <button type="button" className="btn-primary" onClick={() => { void fechar(); }} disabled={fechando || status !== 'em_conferencia'} style={{ height: '50px', borderRadius: '12px', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {fechando ? <Loader2 size={20} className="spin-icon" /> : <PackageCheck size={20} />}
            {fechando ? 'Fechando...' : 'Fechar conferência'}
          </button>
        )}
      </div>

      <LeitorCameraCodigo aberto={cameraAberta} onLido={aoLerPelaCamera} onFechar={() => setCameraAberta(false)} />
    </>,
  );
};

export default VendedorConferencia;
