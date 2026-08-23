import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ScanLine, CheckCircle2, AlertTriangle, XCircle, Loader2, PackageCheck } from 'lucide-react';
import { doc, getDoc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { NexusSwal, showError } from '../../utils/alerts';
import { buildDocumentMetadata, buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import {
  aplicarBipagem,
  canTransition,
  computeStatusFinal,
  DEFAULT_BLOQUEAR_EXCEDENTE,
  DEFAULT_EXIGIR_BIPAGEM,
  DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
  ordenarPorLocalizacao,
  podeLancarManual,
  type BipagemResultado,
  type ConferenciaItem,
  type StatusConferencia,
} from '../../utils/conferenciaDomain';
import { normalizeEmbalagens } from '../../utils/embalagemDomain';

interface HistoricoEntry {
  de: string;
  para: string;
  em: Timestamp;
  usuarioId: string;
  usuarioNome: string;
}

const STATUS_LABELS: Record<StatusConferencia, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};
const STATUS_COLORS: Record<StatusConferencia, string> = {
  aguardando: '#f59e0b',
  em_conferencia: '#3b82f6',
  conferido: '#10b981',
  divergente: '#ef4444',
};

const FEEDBACK_LABELS: Record<BipagemResultado, string> = {
  ok: 'Item conferido.',
  nao_encontrado: 'Código não encontrado neste pedido.',
  excedente: 'Quantidade já bateu o pedido — bipagem recusada.',
  bloqueado_manual: 'Este produto tem código de barras cadastrado — bipe em vez de lançar manual.',
};
const FEEDBACK_COLORS: Record<BipagemResultado, string> = {
  ok: '#10b981',
  nao_encontrado: '#ef4444',
  excedente: '#f59e0b',
  bloqueado_manual: '#f59e0b',
};

// Web Audio API pra feedback sonoro -- o separador normalmente nao esta
// olhando pra tela enquanto bipa (decisao do plano). Sem dependencia nova,
// so osciladores simples -- nenhum arquivo de audio embutido.
const playTone = (frequency: number, durationMs: number) => {
  try {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.18;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
    oscillator.onended = () => ctx.close();
  } catch {
    // Ambiente sem suporte a Web Audio -- o feedback visual continua sozinho.
  }
};

// Padroes DISTINTOS entre nao_encontrado e excedente (exigencia do plano):
// nao_encontrado e um zumbido longo grave; excedente e dois bipes curtos.
const playFeedbackSound = (resultado: BipagemResultado) => {
  if (resultado === 'ok') playTone(880, 110);
  else if (resultado === 'excedente') { playTone(300, 90); setTimeout(() => playTone(300, 90), 150); }
  else playTone(220, 220);
};

const ConferenciaForm: React.FC = () => {
  const { pedidoId } = useParams();
  const navigate = useNavigate();
  const { currentUser, tenantId } = useAuth();

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
  const [feedback, setFeedback] = useState<{ resultado: BipagemResultado; mensagem: string } | null>(null);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Busca o nome de exibicao do usuario atual pra auditoria (nome legivel,
  // nao so uid) -- mesmo fallback de tres niveis usado pro vendedor em
  // PedidoVendaForm.tsx.
  const resolveUsuarioNome = useCallback(async (): Promise<string> => {
    if (!currentUser) return 'Desconhecido';
    let nome = currentUser.displayName || currentUser.email || currentUser.uid;
    try {
      const perfilSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
      if (perfilSnap.exists()) {
        const perfil = perfilSnap.data();
        nome = perfil.nome || perfil.nomeResponsavel || nome;
      }
    } catch {
      // Segue com o fallback -- nao bloqueia a operacao.
    }
    return nome;
  }, [currentUser]);

  useEffect(() => {
    const abrirConferencia = async () => {
      if (!pedidoId || !tenantId || !currentUser) return;
      setIsLoading(true);
      setLoadError(null);
      try {
        const usuarioNome = await resolveUsuarioNome();

        const pedidoSnap = await getDoc(doc(db, 'pedidos_venda', pedidoId));
        if (!pedidoSnap.exists() || pedidoSnap.data().tenantId !== tenantId) {
          setLoadError('Pedido não encontrado.');
          return;
        }
        const pedidoData = pedidoSnap.data();
        if (!pedidoData.statusConferencia) {
          setLoadError('Este pedido não está habilitado para conferência de mercadoria.');
          return;
        }
        setPedido({ numeroPedido: pedidoData.numeroPedido, clienteNome: pedidoData.clienteNome });

        let configData: any = {};
        const configSnap = await getDoc(doc(db, 'configuracoes', tenantId));
        if (configSnap.exists()) configData = configSnap.data();
        const configAtual = {
          exigirBipagem: configData.exigirBipagem ?? DEFAULT_EXIGIR_BIPAGEM,
          bloquearExcedente: configData.bloquearExcedente ?? DEFAULT_BLOQUEAR_EXCEDENTE,
          ordenarMinutaPorLocal: configData.ordenarMinutaPorLocal ?? DEFAULT_ORDENAR_MINUTA_POR_LOCAL,
        };
        setConfig(configAtual);

        // Enriquece cada item com estoque/{id} (codigo/codigoBarras/
        // localizacaoEstoque) FORA da transacao -- mesmo padrao ja usado em
        // MinutaPrint.tsx (Fatia 2). So usado se a expedicao ainda nao
        // existir; se ja existe, os itens gravados la sao a fonte da verdade.
        const itensPedido = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];
        const itensEnriquecidos: ConferenciaItem[] = await Promise.all(
          itensPedido.map(async (item: any): Promise<ConferenciaItem> => {
            const base: ConferenciaItem = {
              produtoId: item.id,
              nome: item.nome,
              // Quantidade na unidade VENDIDA: bipar 1 saco fecha 1, nao 20.
              quantidadePedida: item.quantidade,
              quantidadeConferida: 0,
              unidadeMedidaSigla: item.unidadeMedidaSigla,
            };
            if (!item.id || item.id === 'avulso') return base;
            try {
              const estoqueSnap = await getDoc(doc(db, 'estoque', item.id));
              if (estoqueSnap.exists()) {
                const produto = estoqueSnap.data();
                // Item vendido em embalagem tem que ser conferido pelo EAN DA
                // EMBALAGEM -- o separador tem um saco na mao, e o EAN da
                // unidade nao esta impresso nele. Sem isso, bipar o saco
                // devolveria "Codigo nao encontrado neste pedido".
                const embalagemDoItem = item.embalagemId
                  ? normalizeEmbalagens(produto.embalagens).find((e) => e.id === item.embalagemId)
                  : null;
                return {
                  ...base,
                  codigo: produto.codigo || '',
                  codigoBarras: (embalagemDoItem?.codigoBarras || produto.codigoBarras || ''),
                  localizacaoEstoque: produto.localizacaoEstoque || '',
                };
              }
            } catch (err) {
              console.error('Erro ao buscar dados de estoque do item da conferência:', err);
            }
            return base;
          })
        );
        const itensIniciais = configAtual.ordenarMinutaPorLocal ? ordenarPorLocalizacao(itensEnriquecidos) : itensEnriquecidos;

        // Abertura sempre em transacao -- toca 2 documentos (expedicoes +
        // pedidos_venda), regra permanente da Secao 1.4. So escreve algo
        // quando o estado realmente precisa mudar (evita historico/log
        // espurio toda vez que a tela e' revisitada ja em_conferencia).
        const resultado = await runTransaction(db, async (transaction) => {
          const pedidoRefTx = doc(db, 'pedidos_venda', pedidoId);
          const expedicaoRefTx = doc(db, 'expedicoes', pedidoId);
          const pedidoSnapTx = await transaction.get(pedidoRefTx);
          const expedicaoSnapTx = await transaction.get(expedicaoRefTx);

          if (!pedidoSnapTx.exists()) throw new Error('Pedido não encontrado.');
          const pedidoDataTx = pedidoSnapTx.data();

          if (expedicaoSnapTx.exists()) {
            const expedicaoDataTx = expedicaoSnapTx.data();

            if (expedicaoDataTx.status === 'em_conferencia') {
              return {
                itens: (expedicaoDataTx.itens as ConferenciaItem[]) || itensIniciais,
                status: 'em_conferencia' as StatusConferencia,
                abertoPorNome: expedicaoDataTx.abertoPorNome || usuarioNome,
              };
            }

            const de = expedicaoDataTx.status as StatusConferencia;
            if (!canTransition(de, 'em_conferencia')) throw new Error('Transição de status inválida para reabrir esta conferência.');

            const novoHistorico = [
              ...(expedicaoDataTx.historico || []),
              { de, para: 'em_conferencia', em: Timestamp.now(), usuarioId: currentUser.uid, usuarioNome },
            ];
            transaction.update(expedicaoRefTx, {
              status: 'em_conferencia',
              historico: novoHistorico,
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
            });
            transaction.update(pedidoRefTx, {
              statusConferencia: 'em_conferencia',
              ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
            });
            return {
              itens: (expedicaoDataTx.itens as ConferenciaItem[]) || itensIniciais,
              status: 'em_conferencia' as StatusConferencia,
              abertoPorNome: expedicaoDataTx.abertoPorNome || usuarioNome,
            };
          }

          // Primeira vez que este pedido e' aberto pra conferencia.
          const de = (pedidoDataTx.statusConferencia as StatusConferencia) || 'aguardando';
          const historicoInicial: HistoricoEntry[] = [
            { de, para: 'em_conferencia', em: Timestamp.now(), usuarioId: currentUser.uid, usuarioNome },
          ];
          transaction.set(expedicaoRefTx, {
            tenantId,
            pedidoId,
            numeroPedido: pedidoDataTx.numeroPedido,
            clienteNome: pedidoDataTx.clienteNome || '',
            status: 'em_conferencia',
            itens: itensIniciais,
            abertoPor: currentUser.uid,
            abertoPorNome: usuarioNome,
            abertoEm: serverTimestamp(),
            observacao: '',
            historico: historicoInicial,
            ...buildDocumentMetadata(currentUser.uid, serverTimestamp()),
          });
          transaction.update(pedidoRefTx, {
            statusConferencia: 'em_conferencia',
            ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
          });
          return { itens: itensIniciais, status: 'em_conferencia' as StatusConferencia, abertoPorNome: usuarioNome };
        });

        setItens(resultado.itens);
        setStatus(resultado.status);
        setAbertoPorNome(resultado.abertoPorNome);

        try {
          const { createAuditLog } = await import('../../services/logService');
          createAuditLog({
            tenantId,
            usuarioId: currentUser.uid,
            usuarioEmail: currentUser.email || currentUser.uid,
            modulo: 'expedicao',
            acao: 'conferencia_aberta',
            descricao: `Conferência do pedido #${pedidoData.numeroPedido} aberta.`,
            registroRelacionadoId: pedidoId,
            status: 'sucesso',
          });
        } catch (err) {
          console.error('Erro ao registrar log de abertura de conferência:', err);
        }
      } catch (err) {
        console.error('Erro ao abrir conferência:', err);
        setLoadError((err as Error).message || 'Não foi possível abrir a conferência.');
      } finally {
        setIsLoading(false);
      }
    };
    abrirConferencia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId, tenantId, currentUser]);

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
    setFeedback({ resultado, mensagem: FEEDBACK_LABELS[resultado] });
    playFeedbackSound(resultado);

    if (!isManual) {
      setCodigoInput('');
      setMultiplicador(1); // decisao 5 do plano: o multiplicador zera a cada leitura
      scanInputRef.current?.focus();
    } else if (resultado === 'ok') {
      setManualInputs((prev) => ({ ...prev, [manualProdutoId!]: '' }));
    }
  }, [itens, codigoInput, multiplicador, config]);

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
      const usuarioNome = await resolveUsuarioNome();

      await runTransaction(db, async (transaction) => {
        const pedidoRefTx = doc(db, 'pedidos_venda', pedidoId);
        const expedicaoRefTx = doc(db, 'expedicoes', pedidoId);
        const pedidoSnapTx = await transaction.get(pedidoRefTx);
        const expedicaoSnapTx = await transaction.get(expedicaoRefTx);
        if (!pedidoSnapTx.exists()) throw new Error('Pedido não encontrado.');
        if (!expedicaoSnapTx.exists()) throw new Error('Registro de conferência não encontrado.');

        const historicoAtual = expedicaoSnapTx.data().historico || [];
        const novoHistorico = [
          ...historicoAtual,
          { de: 'em_conferencia', para: final, em: Timestamp.now(), usuarioId: currentUser.uid, usuarioNome },
        ];

        transaction.update(expedicaoRefTx, {
          status: final,
          itens,
          observacao,
          conferidoPor: currentUser.uid,
          conferidoPorNome: usuarioNome,
          conferidoEm: serverTimestamp(),
          historico: novoHistorico,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
        // Restrito aos campos liberados por canCloseConferenciaOnPedido()
        // nas firestore.rules -- nunca adicionar outro campo aqui sem
        // atualizar a regra junto (ver Modulo 12 no plano).
        transaction.update(pedidoRefTx, {
          statusConferencia: final,
          conferidoPor: currentUser.uid,
          conferidoPorNome: usuarioNome,
          conferidoEm: serverTimestamp(),
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp()),
        });
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || currentUser.uid,
          modulo: 'expedicao',
          acao: 'conferencia_fechada',
          descricao: `Conferência do pedido #${pedido.numeroPedido} fechada como ${STATUS_LABELS[final]}.`,
          registroRelacionadoId: pedidoId,
          valorAnterior: 'em_conferencia',
          valorNovo: final,
          status: 'sucesso',
        });
      } catch (err) {
        console.error('Erro ao registrar log de fechamento de conferência:', err);
      }

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
              Conferência — Pedido #{pedido?.numeroPedido}
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

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '90px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Qtd</label>
            <input
              type="number"
              min={1}
              value={multiplicador}
              onChange={(e) => setMultiplicador(e.target.value)}
              style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '260px' }}>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Bipar ou digitar código de barras</label>
            <input
              ref={scanInputRef}
              type="text"
              value={codigoInput}
              onChange={(e) => setCodigoInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleScan(); } }}
              placeholder="Aponte o leitor ou digite o código..."
              style={{ padding: '10px 12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: '15px' }}
            />
          </div>
          <button className="btn-primary" onClick={() => handleScan()} style={{ height: '42px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ScanLine size={18} /> Confirmar
          </button>
        </div>

        {feedback && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px',
            borderRadius: 'var(--radius-md)', backgroundColor: `${FEEDBACK_COLORS[feedback.resultado]}20`,
            color: FEEDBACK_COLORS[feedback.resultado], fontWeight: 600, fontSize: '14px',
          }}>
            {feedback.resultado === 'ok' ? <CheckCircle2 size={20} /> : feedback.resultado === 'excedente' ? <AlertTriangle size={20} /> : <XCircle size={20} />}
            {feedback.mensagem}
          </div>
        )}

        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
          {itensConferidos} de {totalItens} itens conferidos exatamente.
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
                    <td>{item.nome}</td>
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
                            type="number"
                            min={1}
                            placeholder="Qtd"
                            value={manualInputs[item.produtoId] || ''}
                            onChange={(e) => setManualInputs((prev) => ({ ...prev, [item.produtoId]: e.target.value }))}
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
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
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
