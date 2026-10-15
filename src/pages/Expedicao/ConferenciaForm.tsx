import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, CheckCircle2, AlertTriangle, XCircle, Loader2, PackageCheck } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError } from '../../utils/alerts';
import {
  aplicarBipagem,
  computeStatusFinal,
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  encontrarItemPorCodigo,
  ordenarPorLocalizacao,
  podeLancarManual,
  reconciliarItensDaConferencia,
  type BipagemResultado,
  type ConferenciaItem,
  type StatusConferencia,
} from '../../utils/conferenciaDomain';
import { TrocaError } from '../../services/trocaService';
// Abrir, gravar e fechar ficam no servico (15/10/2026): o app Vendas confere com a MESMA regra.
import {
  abrirConferencia,
  assinaturaDosItens,
  FEEDBACK_COLORS,
  FEEDBACK_LABELS,
  fecharConferencia,
  gravarProgressoDaConferencia,
  montarItensDaConferencia,
  playFeedbackSound,
  STATUS_COLORS,
  STATUS_LABELS,
  type AlvoDaConferencia,
} from '../../services/conferenciaService';
import { usePodeLiberarTrava, useTravaDeEdicao } from '../../hooks/useTravaDeEdicao';
import TravaDeEdicaoAviso from '../../components/common/TravaDeEdicaoAviso';

const ConferenciaForm: React.FC = () => {
  // A MESMA tela confere pedido/pre-venda e TROCA (pedido do dono, 2026-09-24).
  // Na troca, quem escreve e' o servidor (a colecao `trocas` e' so' leitura para o app).
  const { pedidoId: pedidoIdDaRota, trocaId } = useParams();
  const ehTroca = Boolean(trocaId);
  const pedidoId = trocaId || pedidoIdDaRota;
  const alvo: AlvoDaConferencia = { tipo: ehTroca ? 'troca' : 'pedido', id: pedidoId || '' };
  const navigate = useNavigate();
  const { currentUser, tenantId, vendasVisiveisDeUsuarioId } = useAuth();
  // Trava de edicao (15/10/2026): uma pessoa por conferencia, no computador ou no celular.
  // A vez e' pega ANTES de abrir: quem chega depois nao reabre nem mexe no que o outro esta conferindo.
  const trava = useTravaDeEdicao({ tipo: 'conferencia', registroId: pedidoId, ativa: true });
  const podeLiberarTrava = usePodeLiberarTrava();
  const travaLiberada = trava.situacao === 'minha' || trava.situacao === 'sem_servidor';

  const [isLoading, setIsLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pedido, setPedido] = useState<{ numeroPedido: string; clienteNome?: string } | null>(null);
  const [status, setStatus] = useState<StatusConferencia>('em_conferencia');
  const [itens, setItens] = useState<ConferenciaItem[]>([]);
  const [abertoPorNome, setAbertoPorNome] = useState('');
  const [observacao, setObservacao] = useState('');

  const [config, setConfig] = useState({
    exigirBipagem: DEFAULT_EXIGIR_BIPAGEM,
    bloquearExcedente: DEFAULT_BLOQUEAR_EXCEDENTE,
    ordenarMinutaPorLocal: DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  });

  const [codigoInput, setCodigoInput] = useState('');
  const [multiplicador, setMultiplicador] = useState<number | string>(1);
  /**
   * Bipagem em duas etapas (2026-09-29, pedido do dono, video de referencia do sistema antigo):
   * bipa o codigo -> acha o item e trava aqui SEM aplicar -> foco pula pra Qtd, valor "1" ja
   * selecionado -> Enter na Qtd e' que aplica de verdade e devolve o foco pro codigo de barras.
   * Sem item pendente, Enter na Qtd so' move o foco (mesmo fallback de antes).
   */
  const [itemPendente, setItemPendente] = useState<{ produtoId: string; nome: string } | null>(null);
  const [feedback, setFeedback] = useState<{ resultado: BipagemResultado | 'pendente'; mensagem: string } | null>(null);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});

  /**
   * GRAVACAO AUTOMATICA (2026-09-25, pedido do cliente): cada bipagem e' gravada na hora em
   * expedicoes/{id}. Antes o progresso so' ia para o banco ao fechar a conferencia: se a tela
   * recarregasse, o computador dormisse ou a internet caisse no meio, o separador perdia tudo e
   * refazia o pedido. Agora reabrir a conferencia retoma exatamente do ultimo item bipado.
   * As gravacoes entram numa fila (uma por vez, sempre com a lista COMPLETA), entao uma falha de
   * rede e' corrigida sozinha pela bipagem seguinte.
   */
  const [salvamento, setSalvamento] = useState<{ estado: 'ocioso' | 'salvando' | 'salvo' | 'erro'; em?: string }>({ estado: 'ocioso' });
  const filaDeGravacao = useRef<Promise<void>>(Promise.resolve());
  const gravacoesPendentes = useRef(0);
  // A observacao so' entra na gravacao automatica depois que a pessoa mexe nela (nao apaga a que ja estava salva).
  const observacaoTocada = useRef(false);
  // Itens do pedido como estavam da ultima vez que a conferencia olhou; e a lista atual da tela, para o ouvinte do pedido.
  const assinaturaDoPedido = useRef('');
  const itensAtuais = useRef<ConferenciaItem[]>([]);
  const [avisoAlteracao, setAvisoAlteracao] = useState<string[] | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const qtdInputRef = useRef<HTMLInputElement>(null);
  const observacaoRef = useRef<HTMLTextAreaElement>(null);
  // Um campo "Qtd" manual por linha, para o Enter poder ir de linha em linha.
  const manualRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const abrir = async () => {
      if (!pedidoId || !tenantId || !currentUser || !travaLiberada) return;
      setIsLoading(true);
      setLoadError(null);
      try {
        const aberta = await abrirConferencia({ alvo, tenantId, usuario: currentUser, vendasVisiveisDeUsuarioId });
        setPedido({ numeroPedido: aberta.numero, clienteNome: aberta.clienteNome });
        setConfig(aberta.config);
        if (aberta.avisos) setAvisoAlteracao(aberta.avisos);
        assinaturaDoPedido.current = aberta.assinaturaDoPedido;
        setItens(aberta.itens);
        setStatus(aberta.status);
        setAbertoPorNome(aberta.abertoPorNome);
      } catch (err) {
        console.error('Erro ao abrir conferência:', err);
        setLoadError(err instanceof TrocaError ? err.message : ((err as Error).message || 'Não foi possível abrir a conferência.'));
      } finally {
        setIsLoading(false);
      }
    };
    void abrir();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId, tenantId, currentUser, travaLiberada]);

  const gravarProgresso = useCallback((itensParaGravar: ConferenciaItem[], observacaoParaGravar: string) => {
    if (!pedidoId || !currentUser) return;
    gravacoesPendentes.current += 1;
    setSalvamento((atual) => ({ ...atual, estado: 'salvando' }));
    filaDeGravacao.current = filaDeGravacao.current.then(async () => {
      try {
        await gravarProgressoDaConferencia({
          alvo: { tipo: ehTroca ? 'troca' : 'pedido', id: pedidoId },
          uid: currentUser.uid,
          itens: itensParaGravar,
          observacao: observacaoTocada.current ? observacaoParaGravar : undefined,
        });
        gravacoesPendentes.current -= 1;
        setSalvamento({ estado: gravacoesPendentes.current > 0 ? 'salvando' : 'salvo', em: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
      } catch (err) {
        console.error('Erro ao gravar o progresso da conferência:', err);
        gravacoesPendentes.current -= 1;
        setSalvamento({ estado: 'erro' });
      }
    });
  }, [pedidoId, currentUser, ehTroca]);

  useEffect(() => { itensAtuais.current = itens; }, [itens]);

  // PEDIDO ALTERADO COM A CONFERENCIA ABERTA (2026-09-25): o cliente cancela ou acrescenta item no pedido
  // enquanto o separador ainda esta bipando. A lista da tela acompanha, sem perder o que ja foi bipado.
  useEffect(() => {
    if (!pedidoId || !tenantId || ehTroca || isLoading || loadError || status !== 'em_conferencia') return undefined;
    return onSnapshot(doc(db, 'pedidos_venda', pedidoId), (snap) => {
      if (!snap.exists()) return;
      const dados = snap.data();
      if (dados.status === 'Cancelada') {
        setLoadError('Este pedido foi cancelado e saiu da expedição. Não há mais mercadoria a conferir — guarde de volta o que já foi separado.');
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
  }, [pedidoId, tenantId, ehTroca, isLoading, loadError, status]);

  // Troca cancelada, recusada ou entregue com a conferencia aberta: mesma trava do pedido cancelado.
  useEffect(() => {
    if (!pedidoId || !tenantId || !ehTroca || isLoading || loadError || status !== 'em_conferencia') return undefined;
    return onSnapshot(doc(db, 'trocas', pedidoId), (snap) => {
      // O status gravado e' 'Cancelada'/'Recusada'/'Entregue' (trocaDomain);
      // comparar sem caixa -- com o valor cru a trava nunca disparava.
      const situacao = snap.exists() ? String(snap.data().status || '').toLowerCase() : '';
      const motivo: Record<string, string> = {
        cancelada: 'Esta troca foi cancelada e saiu da expedição.',
        recusada: 'Esta troca foi recusada e saiu da expedição.',
        entregue: 'Esta troca já foi entregue.',
      };
      if (motivo[situacao]) setLoadError(`${motivo[situacao]} Não há mais mercadoria a conferir — guarde de volta o que já foi separado.`);
    }, (erro) => console.error('Erro ao acompanhar a troca da conferência:', erro));
  }, [pedidoId, tenantId, ehTroca, isLoading, loadError, status]);

  // Nao deixa fechar a aba com bipagem ainda por gravar.
  useEffect(() => {
    const aviso = (evento: BeforeUnloadEvent) => {
      if (gravacoesPendentes.current > 0 || salvamento.estado === 'erro') evento.preventDefault();
    };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [salvamento.estado]);

  useEffect(() => {
    if (!isLoading && !loadError) scanInputRef.current?.focus();
  }, [isLoading, loadError]);

  const handleScan = useCallback((manualProdutoId?: string, manualQuantidade?: number) => {
    const isManual = Boolean(manualProdutoId);
    const codigo = isManual ? manualProdutoId! : codigoInput.trim();
    if (!codigo) return;
    const quantidade = isManual ? (manualQuantidade || 0) : Math.max(1, Number(multiplicador) || 1);
    if (isManual && quantidade <= 0) return;

    const { itens: novosItens, resultado } = aplicarBipagem(itens, codigo, quantidade, {
      bloquearExcedente: config.bloquearExcedente,
      exigirBipagem: config.exigirBipagem,
      manual: isManual,
    });

    setItens(novosItens);
    // So' grava quando a bipagem mudou alguma quantidade (codigo nao encontrado nao altera nada).
    if (resultado !== 'nao_encontrado' && status === 'em_conferencia') gravarProgresso(novosItens, observacao);
    setFeedback({ resultado, mensagem: ehTroca ? FEEDBACK_LABELS[resultado].replace('neste pedido', 'nesta troca') : FEEDBACK_LABELS[resultado] });
    playFeedbackSound(resultado);

    if (!isManual) {
      setCodigoInput('');
      setMultiplicador(1); // decisao 5 do plano: o multiplicador zera a cada leitura
      scanInputRef.current?.focus();
    } else if (resultado === 'ok') {
      setManualInputs((prev) => ({ ...prev, [manualProdutoId!]: '' }));
    }
  }, [itens, codigoInput, multiplicador, config, ehTroca, status, observacao, gravarProgresso]);

  /**
   * 1ª etapa da bipagem em duas etapas: so' ACHA o item pelo codigo, sem aplicar nada. Se achar,
   * trava em itemPendente e joga o foco pra Qtd (com "1" ja selecionado); a 2ª etapa
   * (handleConfirmarPendente) e' quem de fato soma a quantidade. Nao encontrado da' o feedback na
   * hora e mantem o foco no codigo, igual bipagem invalida sempre funcionou.
   */
  const handleResolverCodigo = useCallback(() => {
    const codigo = codigoInput.trim();
    if (!codigo) return;
    const item = encontrarItemPorCodigo(itens, codigo);
    if (!item) {
      setItemPendente(null);
      setFeedback({ resultado: 'nao_encontrado', mensagem: ehTroca ? FEEDBACK_LABELS.nao_encontrado.replace('neste pedido', 'nesta troca') : FEEDBACK_LABELS.nao_encontrado });
      playFeedbackSound('nao_encontrado');
      setCodigoInput('');
      scanInputRef.current?.focus();
      return;
    }
    setItemPendente({ produtoId: item.produtoId, nome: item.nome });
    setFeedback({ resultado: 'pendente', mensagem: `${item.nome} — confirme a quantidade e aperte Enter.` });
    setMultiplicador(1);
    // O campo so' existe depois deste render (nao esta escondido, mas o foco/selecao precisa
    // esperar o valor "1" entrar no DOM pra selecionar o texto certo).
    requestAnimationFrame(() => { qtdInputRef.current?.focus(); qtdInputRef.current?.select(); });
  }, [codigoInput, itens, ehTroca]);

  /** 2ª etapa: aplica a quantidade confirmada no item que a 1ª etapa achou, grava, toca o som e
   *  devolve tudo pro estado inicial (campo do codigo vazio e com foco, pronto pro proximo bipe). */
  const handleConfirmarPendente = useCallback(() => {
    if (!itemPendente) { scanInputRef.current?.focus(); return; }
    const quantidade = Math.max(1, Number(multiplicador) || 1);
    const { itens: novosItens, resultado } = aplicarBipagem(itens, itemPendente.produtoId, quantidade, {
      bloquearExcedente: config.bloquearExcedente,
      exigirBipagem: config.exigirBipagem,
      manual: false,
    });
    setItens(novosItens);
    if (resultado !== 'nao_encontrado' && status === 'em_conferencia') gravarProgresso(novosItens, observacao);
    setFeedback({ resultado, mensagem: ehTroca ? FEEDBACK_LABELS[resultado].replace('neste pedido', 'nesta troca') : FEEDBACK_LABELS[resultado] });
    playFeedbackSound(resultado);
    setItemPendente(null);
    setCodigoInput('');
    setMultiplicador(1);
    // O campo do codigo so' desbloqueia (disabled={itemPendente}) depois do re-render que
    // setItemPendente(null) agenda -- focar sincrono aqui ainda pegaria o campo desabilitado
    // (focus() em input disabled nao faz nada) e o foco ficaria preso na Qtd.
    requestAnimationFrame(() => scanInputRef.current?.focus());
  }, [itemPendente, multiplicador, itens, config, ehTroca, status, observacao, gravarProgresso]);

  const handleFecharConferencia = async () => {
    if (!pedidoId || !tenantId || !currentUser || !pedido) return;
    const final = computeStatusFinal(itens);
    const divergentes = itens.filter((item) => item.quantidadeConferida !== item.quantidadePedida);
    const resumoDivergencias = divergentes
      .map((item) => `• ${item.nome}: pedido ${item.quantidadePedida}, conferido ${item.quantidadeConferida}`)
      .join('\n');

    const confirm = await NexusSwal.fire({
      title: final === 'conferido' ? 'Fechar conferência?' : 'Fechar com divergências?',
      text: final === 'conferido'
        ? 'Todos os itens conferem com o pedido.'
        : `${divergentes.length} de ${itens.length} ${divergentes.length === 1 ? 'item não bateu' : 'itens não bateram'} com o pedido:\n${resumoDivergencias}`,
      icon: final === 'conferido' ? 'success' : 'warning',
      showCancelButton: true,
      confirmButtonText: final === 'conferido' ? 'Sim, fechar como Conferido' : 'Sim, fechar como Divergente',
      cancelButtonText: 'Voltar e conferir',
    });
    if (!confirm.isConfirmed) return;

    setIsClosing(true);
    try {
      await fecharConferencia({ alvo, tenantId, usuario: currentUser, itens, observacao, numero: pedido.numeroPedido });
      await NexusSwal.fire({
        title: final === 'conferido' ? 'Conferência concluída!' : 'Conferência fechada com divergências',
        icon: final === 'conferido' ? 'success' : 'warning',
        confirmButtonText: 'Voltar à fila',
      });
      navigate('/operacoes/expedicao');
    } catch (err) {
      console.error('Erro ao fechar conferência:', err);
      showError('Falha ao fechar conferência', (err as Error).message || 'Não foi possível salvar a conferência.');
    } finally {
      setIsClosing(false);
    }
  };

  if (trava.situacao === 'de_outro') {
    return (
      <TravaDeEdicaoAviso
        rotulo="a conferência"
        mensagem={trava.mensagem}
        onVoltar={() => navigate('/operacoes/expedicao')}
        onTentarDeNovo={trava.tentarDeNovo}
        onLiberar={podeLiberarTrava ? trava.liberarEAbrir : undefined}
      />
    );
  }

  if (isLoading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-primary)' }}>Abrindo conferência...</div>;
  }

  if (loadError) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#ef4444', marginBottom: '16px' }}>{loadError}</p>
        <button className="btn-secondary" onClick={() => navigate('/operacoes/expedicao')}>Voltar à fila</button>
      </div>
    );
  }

  const totalItens = itens.length;
  const itensConferidos = itens.filter((item) => item.quantidadeConferida === item.quantidadePedida).length;
  const displayItens = config.ordenarMinutaPorLocal ? ordenarPorLocalizacao(itens) : itens;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="icon-btn" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }} onClick={() => navigate('/operacoes/expedicao')}>
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }}>
              Conferência — {ehTroca ? 'Troca' : 'Pedido'} #{pedido?.numeroPedido}
              {ehTroca && <span style={{ marginLeft: '10px', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: '#8b5cf6', verticalAlign: 'middle' }}>TROCA</span>}
            </h1>
            <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
              {pedido?.clienteNome || 'Consumidor Final'} · Aberta por {abertoPorNome}
            </p>
          </div>
        </div>
        <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[status] }}>
          {STATUS_LABELS[status]}
        </span>
      </div>

      {avisoAlteracao && avisoAlteracao.length > 0 && (
        <div role="alert" style={{ padding: '16px 20px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(245,158,11,0.6)', backgroundColor: 'rgba(245,158,11,0.12)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
            <strong style={{ color: '#f59e0b' }}>O pedido foi alterado — a lista abaixo já está atualizada</strong>
            <button type="button" className="btn-secondary" onClick={() => setAvisoAlteracao(null)} style={{ padding: '4px 12px', fontSize: '13px' }}>Entendi</button>
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px' }}>
            {avisoAlteracao.map((linha, i) => <li key={i}>{linha}</li>)}
          </ul>
        </div>
      )}

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '260px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Bipar ou digitar código de barras</label>
            <input
              ref={scanInputRef}
              type="text"
              value={codigoInput}
              disabled={Boolean(itemPendente)}
              onChange={(e) => setCodigoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                // Com codigo: acha o item e pula pra Qtd (2ª etapa confirma de verdade).
                // Vazio: Enter e' "proximo campo" -- vai para a primeira quantidade
                // manual ou, se nao ha, para as observacoes.
                if (codigoInput.trim()) { handleResolverCodigo(); return; }
                const primeiroManual = displayItens.find((item) => podeLancarManual(item, config.exigirBipagem));
                (primeiroManual ? manualRefs.current[primeiroManual.produtoId] : observacaoRef.current)?.focus();
              }}
              placeholder="Aponte o leitor ou digite o código..."
              style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '15px' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Qtd</label>
            <input
              ref={qtdInputRef}
              type="number"
              min={1}
              value={multiplicador}
              onChange={(e) => setMultiplicador(e.target.value)}
              onFocus={(e) => e.target.select()}
              // Com item pendente (bipou e caiu aqui): Enter APLICA de verdade e volta pro codigo.
              // Sem item pendente (foco chegou aqui sem bipar nada): Enter so' move o foco, como antes.
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (itemPendente) handleConfirmarPendente();
                else scanInputRef.current?.focus();
              }}
              style={{
                padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
                border: itemPendente ? '1px solid #3b82f6' : '1px solid var(--border-color)',
                boxShadow: itemPendente ? '0 0 0 2px rgba(59,130,246,0.25)' : 'none',
              }}
            />
          </div>
          <button
            className="btn-primary"
            onClick={() => (itemPendente ? handleConfirmarPendente() : handleResolverCodigo())}
            style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <ScanLine size={18} /> {itemPendente ? 'Confirmar quantidade' : 'Confirmar'}
          </button>
        </div>

        {feedback && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
            borderRadius: 'var(--radius-md)', backgroundColor: `${FEEDBACK_COLORS[feedback.resultado]}20`,
            color: FEEDBACK_COLORS[feedback.resultado], fontWeight: 600, fontSize: '14px',
          }}>
            {feedback.resultado === 'ok' ? <CheckCircle2 size={20} />
              : feedback.resultado === 'excedente' ? <AlertTriangle size={20} />
              : feedback.resultado === 'pendente' ? <ScanLine size={20} />
              : <XCircle size={20} />}
            {feedback.mensagem}
          </div>
        )}

        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
          <span>{itensConferidos} de {totalItens} itens conferidos exatamente.</span>
          {salvamento.estado === 'salvando' && <span style={{ color: '#f59e0b' }}>Salvando...</span>}
          {salvamento.estado === 'salvo' && <span style={{ color: '#10b981' }}>Salvo automaticamente às {salvamento.em}</span>}
          {salvamento.estado === 'erro' && (
            <span style={{ color: '#ef4444', fontWeight: 600 }}>
              Não foi possível salvar as últimas bipagens (verifique a internet). Elas continuam na tela e serão salvas na próxima bipagem — não feche a página.
            </span>
          )}
        </p>
      </div>

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Local</th>
                <th>Código</th>
                <th>Produto</th>
                <th style={{ textAlign: 'center' }}>Pedido</th>
                <th style={{ textAlign: 'center' }}>Conferido</th>
                <th style={{ textAlign: 'center' }}>Situação</th>
                <th>Manual</th>
              </tr>
            </thead>
            <tbody>
              {displayItens.map((item) => {
                const bate = item.quantidadeConferida === item.quantidadePedida;
                const podeManual = podeLancarManual(item, config.exigirBipagem);
                return (
                  <tr key={item.produtoId}>
                    <td>{item.localizacaoEstoque || '---'}</td>
                    <td>{item.codigo || '---'}</td>
                    <td>{item.nome}{item.removidoDoPedido && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: '#ef4444' }}>RETIRADO DO PEDIDO — devolva ao estoque</span>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {item.quantidadePedida}
                      {item.unidadeMedidaSigla && <span style={{ color: 'var(--text-muted)' }}> {item.unidadeMedidaSigla}</span>}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.quantidadeConferida}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff',
                        backgroundColor: bate ? '#10b981' : item.quantidadeConferida > item.quantidadePedida ? '#ef4444' : '#f59e0b',
                      }}>
                        {bate ? 'OK' : item.quantidadeConferida > item.quantidadePedida ? 'Sobrou' : 'Faltou'}
                      </span>
                    </td>
                    <td>
                      {podeManual ? (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            ref={(campo) => { manualRefs.current[item.produtoId] = campo; }}
                            type="number"
                            min={1}
                            placeholder="Qtd"
                            value={manualInputs[item.produtoId] || ''}
                            onChange={(e) => setManualInputs((prev) => ({ ...prev, [item.produtoId]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              // Enter lanca a quantidade digitada e pula para a proxima linha
                              // com campo manual; na ultima, volta para o codigo de barras.
                              const quantidadeDigitada = Number(manualInputs[item.produtoId]);
                              if (quantidadeDigitada > 0) handleScan(item.produtoId, quantidadeDigitada);
                              const elegiveis = displayItens.filter((linha) => podeLancarManual(linha, config.exigirBipagem));
                              const proxima = elegiveis[elegiveis.findIndex((linha) => linha.produtoId === item.produtoId) + 1];
                              (proxima ? manualRefs.current[proxima.produtoId] : scanInputRef.current)?.focus();
                            }}
                            style={{ width: '70px', padding: '6px 8px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                          />
                          <button
                            className="btn-secondary"
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => handleScan(item.produtoId, Math.max(1, Number(manualInputs[item.produtoId]) || 0))}
                            disabled={!manualInputs[item.produtoId] || Number(manualInputs[item.produtoId]) <= 0}
                          >
                            Adicionar
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Bipagem obrigatória</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Observações</label>
          <textarea
            ref={observacaoRef}
            value={observacao}
            onChange={(e) => { observacaoTocada.current = true; setObservacao(e.target.value); }}
            onBlur={() => { if (observacaoTocada.current && status === 'em_conferencia') gravarProgresso(itens, observacao); }}
            // Ctrl+Enter fecha a conferencia sem sair do teclado (Enter sozinho quebra linha).
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isClosing) { e.preventDefault(); void handleFecharConferencia(); } }}
            rows={2}
            placeholder="Alguma observação sobre esta conferência (opcional)..."
            style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', resize: 'vertical' }}
          />
        </div>
        <button
          className="btn-primary"
          onClick={handleFecharConferencia}
          disabled={isClosing}
          style={{ alignSelf: 'flex-end', display: 'flex', alignItems: 'center', gap: '8px', opacity: isClosing ? 0.7 : 1 }}
        >
          {isClosing ? <Loader2 size={18} className="spin-icon" /> : <PackageCheck size={18} />}
          {isClosing ? 'Fechando...' : 'Fechar Conferência'}
        </button>
      </div>
    </div>
  );
};

export default ConferenciaForm;
