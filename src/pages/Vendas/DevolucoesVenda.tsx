import React, { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { Timestamp, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { NexusSwal, escaparHtml, showError, showSuccess } from '../../utils/alerts';
import { useLinhasEmBlocos } from '../../hooks/useLinhasEmBlocos';
import MostrarMaisLinhas from '../../components/common/MostrarMaisLinhas';
import ComprovanteDevolucao from './ComprovanteDevolucao';
import { isPlatformAdminRole } from '../../utils/roles';
import { dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { dentroDoPeriodo } from '../../utils/filtroListaDomain';
import { assinarComReserva } from '../../services/consultaComReserva';
import { BotaoFiltros, CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import DevolucaoNfeModal from '../../components/common/DevolucaoNfeModal';
import DevolucaoVendaModal from './DevolucaoVendaModal';
import EscolherPedidoDevolucaoModal, { type PedidoParaDevolucao } from './EscolherPedidoDevolucaoModal';
import {
  LIMITE_MOTIVO_RECUSA,
  ROTULO_DESTINO_DEVOLUCAO,
  ROTULO_ORIGEM_DEVOLUCAO,
  ROTULO_SITUACAO_DEVOLUCAO,
  STATUS_DEVOLUCAO,
  destinoDaDevolucao,
  origemDaDevolucao,
  situacaoDaDevolucao,
  type DestinoDevolucao,
  type OrigemDevolucao,
  type StatusDevolucao,
} from '../../utils/devolucaoVendaDomain';
import { efetivarDevolucaoVenda, recusarDevolucaoVenda, registrarHistoricoDaDevolucao } from '../../services/devolucaoVendaService';

/**
 * DEVOLUCOES DE VENDA (24/11/2026).
 *
 * A tela lista as devolucoes FEITAS (colecao devolucoes_venda), do sistema e
 * do app Vendas, com a situacao de cada uma. A devolucao pedida pelo app nasce
 * "Aguardando confirmacao": aqui o escritorio Confirma (mesmo codigo da
 * devolucao feita no sistema -- services/devolucaoVendaService.ts) ou Recusa
 * com o motivo, que o vendedor ve no app. "Fazer devolucao" abre a escolha do
 * pedido e, dai', o DevolucaoVendaModal de sempre. O estorno continua na tela
 * do pedido.
 *
 * Leitura: os ultimos DIAS_PADRAO dias, ou desde o "De" do filtro quando ele
 * e' mais antigo.
 */
const DIAS_PADRAO = 180;
const inicioPadrao = (): string => {
  const d = new Date(`${getDateInputInTimeZone()}T12:00:00`);
  d.setDate(d.getDate() - DIAS_PADRAO);
  return d.toISOString().slice(0, 10);
};

interface ItemDaLinha {
  nome: string;
  quantidadeDevolvida: number;
  unidadeMedidaSigla?: string;
}

interface LinhaDevolucao {
  id: string;
  pedidoId: string;
  numeroPedido: string;
  clienteNome: string;
  vendedorNome: string;
  solicitadoPorNome: string;
  valor: number;
  destino: DestinoDevolucao;
  bancoNome: string;
  formaDevolucao: string;
  situacao: StatusDevolucao;
  origem: OrigemDevolucao;
  motivo: string;
  observacao: string;
  motivoRecusa: string;
  foraDoPrazo: boolean;
  itens: ItemDaLinha[];
  createdAt?: { seconds?: number; toMillis?: () => number };
}

const ESTILO_SITUACAO: Record<StatusDevolucao, { cor: string; fundo: string }> = {
  aguardando_confirmacao: { cor: '#d97706', fundo: 'rgba(245, 158, 11, 0.15)' },
  concluida: { cor: '#10b981', fundo: 'rgba(16, 185, 129, 0.15)' },
  recusada: { cor: '#ef4444', fundo: 'rgba(239, 68, 68, 0.15)' },
  estornada: { cor: 'var(--text-muted)', fundo: 'rgba(148, 163, 184, 0.18)' },
};

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const dataDaLinha = (l: LinhaDevolucao) => (l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000).toLocaleDateString('pt-BR') : '-');

const paraLinha = (id: string, x: Record<string, unknown>): LinhaDevolucao => ({
  id,
  pedidoId: String(x.pedidoVendaId || x.pedidoOrigemId || ''),
  numeroPedido: String(x.numeroPedidoOriginal || ''),
  clienteNome: String(x.clienteNome || ''),
  vendedorNome: String(x.vendedorNome || ''),
  solicitadoPorNome: String(x.solicitadoPorNome || ''),
  valor: Number(x.valorTotalDevolvido || 0),
  destino: destinoDaDevolucao(x.destinoValor),
  bancoNome: String(x.bancoNome || ''),
  formaDevolucao: String(x.formaDevolucao || ''),
  situacao: situacaoDaDevolucao(x),
  origem: origemDaDevolucao(x),
  motivo: String(x.motivo || ''),
  observacao: String(x.observacao || ''),
  motivoRecusa: String(x.motivoRecusa || ''),
  foraDoPrazo: x.foraDoPrazo === true,
  itens: (Array.isArray(x.itensDevolvidos) ? x.itensDevolvidos : []).map((i: Record<string, unknown>) => ({
    nome: String(i.nome || ''),
    quantidadeDevolvida: Number(i.quantidadeDevolvida || 0),
    ...(i.unidadeMedidaSigla ? { unidadeMedidaSigla: String(i.unidadeMedidaSigla) } : {}),
  })),
  createdAt: x.createdAt as LinhaDevolucao['createdAt'],
});

const DevolucoesVenda: React.FC = () => {
  const { tenantId, currentUser, userNome, controlaFiscal, isOwner, userRole, userPermissions } = useAuth();
  const { openTab } = useTabs();
  const podeEmitirNota = Boolean(controlaFiscal) && (isOwner || isPlatformAdminRole(userRole) || Boolean(userPermissions?.includes('fiscal.emitir')));
  const [linhas, setLinhas] = useState<LinhaDevolucao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [situacaoFiltro, setSituacaoFiltro] = useState<'' | StatusDevolucao>('');
  const [origemFiltro, setOrigemFiltro] = useState<'' | OrigemDevolucao>('');
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  const [escolhendoPedido, setEscolhendoPedido] = useState(false);
  const [pedidoSelecionado, setPedidoSelecionado] = useState<PedidoParaDevolucao | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [notaDaDevolucao, setNotaDaDevolucao] = useState<{ id: string; numeroPedido: string } | null>(null);
  /** Comprovante da devolucao (o mesmo do pedido, 25/11/2026). */
  const [comprovanteId, setComprovanteId] = useState<string | null>(null);

  const padrao = inicioPadrao();
  const inicioDaConsulta = /^\d{4}-\d{2}-\d{2}$/.test(periodoDe) && periodoDe < padrao ? periodoDe : padrao;

  useEffect(() => {
    if (!tenantId) return undefined;
    setCarregando(true);
    const todas = query(collection(db, 'devolucoes_venda'), where('tenantId', '==', tenantId));
    const inicio = dateInputToUtcStart(inicioDaConsulta);
    const enxuta = inicio ? query(todas, where('createdAt', '>=', Timestamp.fromDate(inicio))) : todas;
    return assinarComReserva(enxuta, todas, 'Devoluções de venda (período)', (snap) => {
      const lista = snap.docs
        .map((d) => paraLinha(d.id, d.data()))
        // A reserva (sem indice) traz todas: o mesmo corte aqui.
        .filter((l) => dentroDoPeriodo(l.createdAt, inicioDaConsulta, ''));
      lista.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setLinhas(lista);
      setCarregando(false);
    }, (erro) => {
      console.error('Erro ao carregar as devoluções:', erro);
      setCarregando(false);
    });
  }, [tenantId, inicioDaConsulta]);

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => linhas.filter((l) => (
    (!termo || l.numeroPedido.toLowerCase().includes(termo) || l.clienteNome.toLowerCase().includes(termo)
      || l.vendedorNome.toLowerCase().includes(termo) || l.solicitadoPorNome.toLowerCase().includes(termo))
    && (!situacaoFiltro || l.situacao === situacaoFiltro)
    && (!origemFiltro || l.origem === origemFiltro)
    && dentroDoPeriodo(l.createdAt, periodoDe, periodoAte)
  )), [linhas, termo, situacaoFiltro, origemFiltro, periodoDe, periodoAte]);

  // Velocidade: a tabela desenha em blocos; o contador usa a lista inteira.
  const blocos = useLinhasEmBlocos(filtradas);
  const aguardando = linhas.filter((l) => l.situacao === STATUS_DEVOLUCAO.aguardando).length;
  const filtrosAtivos = (situacaoFiltro ? 1 : 0) + (origemFiltro ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => {
    setSituacaoFiltro('');
    setOrigemFiltro('');
    setPeriodoDe('');
    setPeriodoAte('');
  };

  const quem = () => (currentUser && tenantId ? {
    tenantId,
    usuarioId: currentUser.uid,
    usuarioNome: userNome || currentUser.email || currentUser.uid,
    usuarioEmail: currentUser.email || currentUser.uid,
  } : null);

  const pedidoTemNotaAutorizada = async (pedidoId: string): Promise<boolean> => {
    try {
      const snap = await getDocs(query(collection(db, 'notas_fiscais'), where('tenantId', '==', tenantId), where('pedidoId', '==', pedidoId)));
      return snap.docs.some((d) => {
        const nota = d.data();
        return nota.status === 'authorized' && ['NF-e', 'NFC-e'].includes(nota.tipo) && nota.finalidade !== 'devolucao';
      });
    } catch (erro) {
      console.error('Erro ao consultar as notas do pedido:', erro);
      return false;
    }
  };

  const resumoHtml = (l: LinhaDevolucao) => {
    const destino = `${ROTULO_DESTINO_DEVOLUCAO[l.destino]}${l.destino === 'banco' ? ` — ${l.formaDevolucao || 'Pix'}${l.bancoNome ? ` (${l.bancoNome})` : ''}` : ''}`;
    const itens = l.itens.map((i) => `<li>${escaparHtml(`${i.quantidadeDevolvida.toLocaleString('pt-BR')} ${i.unidadeMedidaSigla || ''} ${i.nome}`)}</li>`).join('');
    return `<div style="text-align:left;font-size:14px;line-height:1.5">`
      + `<p style="margin:0 0 6px"><strong>Pedido #${escaparHtml(l.numeroPedido)}</strong> — ${escaparHtml(l.clienteNome)}</p>`
      + `<p style="margin:0 0 6px">Pedida por ${escaparHtml(l.solicitadoPorNome || l.vendedorNome || 'vendedor')}. Motivo: ${escaparHtml(l.motivo)}</p>`
      + `<ul style="margin:0 0 6px;padding-left:20px">${itens}</ul>`
      + `<p style="margin:0 0 6px">Valor: <strong>${moeda(l.valor)}</strong> · ${escaparHtml(destino)}</p>`
      + (l.observacao ? `<p style="margin:0 0 6px">Obs.: ${escaparHtml(l.observacao)}</p>` : '')
      + (l.foraDoPrazo ? '<p style="margin:0;color:#d97706"><strong>Atenção:</strong> foi pedida fora do prazo de devolução da filial.</p>' : '')
      + '</div>';
  };

  const confirmar = async (l: LinhaDevolucao) => {
    const q = quem();
    if (!q || processandoId) return;
    const escolha = await NexusSwal.fire({
      icon: 'question',
      title: 'Confirmar a devolução?',
      html: `${resumoHtml(l)}<p style="margin:12px 0 0;font-size:13px">Ao confirmar, a mercadoria volta para o estoque e o valor ${l.destino === 'credito' ? 'vira crédito do cliente' : l.destino === 'caixa' ? 'sai do caixa' : 'sai do banco'} hoje.</p>`,
      showCancelButton: true,
      confirmButtonText: 'Confirmar devolução',
      cancelButtonText: 'Voltar',
    });
    if (!escolha.isConfirmed) return;
    setProcessandoId(l.id);
    try {
      const resultado = await efetivarDevolucaoVenda(q, { pendenteId: l.id });
      registrarHistoricoDaDevolucao(q, resultado, 'confirmada');
      // Pedido com NF-e/NFC-e autorizada: a devolucao tambem precisa de nota fiscal (como na devolucao feita aqui).
      if (podeEmitirNota && await pedidoTemNotaAutorizada(resultado.pedidoId)) {
        const nota = await NexusSwal.fire({
          icon: 'question',
          title: 'Emitir a NF-e de devolução agora?',
          text: 'Este pedido tem nota fiscal autorizada. Para o fisco, a devolução também precisa ser documentada com uma NF-e de devolução. Você pode emitir agora ou depois, em Notas Fiscais.',
          showCancelButton: true,
          confirmButtonText: 'Emitir agora',
          cancelButtonText: 'Depois',
        });
        if (nota.isConfirmed) {
          setNotaDaDevolucao({ id: resultado.devolucaoId, numeroPedido: resultado.numeroPedido });
          return;
        }
      }
      // Comprovante (o mesmo da devolucao feita no sistema): botao na mensagem de sucesso.
      const fim = await NexusSwal.fire({
        icon: 'success',
        title: 'Devolução confirmada',
        text: resultado.destino === 'credito' ? 'O valor ficou como crédito do cliente.' : 'O valor saiu do caixa/banco escolhido.',
        showCancelButton: true,
        confirmButtonText: 'Imprimir comprovante',
        cancelButtonText: 'Fechar',
      });
      if (fim.isConfirmed) setComprovanteId(resultado.devolucaoId);
    } catch (erro) {
      console.error('Erro ao confirmar a devolução:', erro);
      showError('Não foi possível confirmar a devolução', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setProcessandoId(null);
    }
  };

  const recusar = async (l: LinhaDevolucao) => {
    const q = quem();
    if (!q || processandoId) return;
    const escolha = await NexusSwal.fire({
      icon: 'warning',
      title: 'Recusar a devolução?',
      html: `${resumoHtml(l)}<p style="margin:12px 0 0;font-size:13px">Nada muda no estoque nem no dinheiro. Escreva o motivo: o vendedor vê no aplicativo.</p>`,
      input: 'textarea',
      inputAttributes: { maxlength: String(LIMITE_MOTIVO_RECUSA), 'aria-label': 'Motivo da recusa' },
      showCancelButton: true,
      confirmButtonText: 'Recusar devolução',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      inputValidator: (valor: string) => (String(valor || '').trim().length < 3 ? 'Escreva o motivo da recusa.' : null),
    });
    if (!escolha.isConfirmed) return;
    setProcessandoId(l.id);
    try {
      await recusarDevolucaoVenda(q, l.id, String(escolha.value || ''));
      showSuccess('Devolução recusada. O vendedor vê o motivo no aplicativo.');
    } catch (erro) {
      console.error('Erro ao recusar a devolução:', erro);
      showError('Não foi possível recusar a devolução', erro instanceof Error ? erro.message : 'Tente de novo.');
    } finally {
      setProcessandoId(null);
    }
  };

  const abrirPedido = (l: LinhaDevolucao) => {
    if (l.pedidoId) void openTab(`/pedidos-venda/visualizar/${l.pedidoId}`, `Pedido #${l.numeroPedido}`);
  };

  const th: React.CSSProperties = { padding: '12px 14px' };
  const td: React.CSSProperties = { padding: '12px 14px', fontSize: '14px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RotateCcw size={28} color="var(--accent-purple)" />
            Devolução de Venda
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            Devoluções feitas no sistema e pedidas pelo aplicativo.
            {aguardando > 0 && <strong style={{ color: '#d97706' }}> {aguardando} aguardando confirmação.</strong>}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setEscolhendoPedido(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <RotateCcw size={18} /> Fazer devolução
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div className="search-bar" style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
        </div>
        <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
          <CampoFiltro rotulo="Situação">
            <select value={situacaoFiltro} onChange={(e) => setSituacaoFiltro(e.target.value as '' | StatusDevolucao)} style={estiloCampoFiltro}>
              <option value="">Todas</option>
              {(Object.keys(ROTULO_SITUACAO_DEVOLUCAO) as StatusDevolucao[]).map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_DEVOLUCAO[s]}</option>)}
            </select>
          </CampoFiltro>
          <CampoFiltro rotulo="Origem">
            <select value={origemFiltro} onChange={(e) => setOrigemFiltro(e.target.value as '' | OrigemDevolucao)} style={estiloCampoFiltro}>
              <option value="">Todas</option>
              {(Object.keys(ROTULO_ORIGEM_DEVOLUCAO) as OrigemDevolucao[]).map((o) => <option key={o} value={o}>{ROTULO_ORIGEM_DEVOLUCAO[o]}</option>)}
            </select>
          </CampoFiltro>
          <CampoPeriodo rotulo="Data da devolução" de={periodoDe} ate={periodoAte} onChangeDe={setPeriodoDe} onChangeAte={setPeriodoAte} />
        </PainelFiltros>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={th}>Data</th>
                <th style={th}>Nº Pedido</th>
                <th style={th}>Cliente</th>
                <th style={th}>Vendedor</th>
                <th style={{ ...th, textAlign: 'right' }}>Valor</th>
                <th style={th}>Destino</th>
                <th style={th}>Situação</th>
                <th style={th}>Origem</th>
                <th style={{ ...th, textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px' }}>Carregando devoluções...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <RotateCcw size={44} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p style={{ margin: 0 }}>Nenhuma devolução encontrada.</p>
                  </td>
                </tr>
              ) : blocos.visiveis.map((l) => {
                const estilo = ESTILO_SITUACAO[l.situacao];
                const ocupado = processandoId === l.id;
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={td}>{dataDaLinha(l)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>#{l.numeroPedido}</td>
                    <td style={td}>{l.clienteNome}</td>
                    <td style={td}>{l.vendedorNome || '-'}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{moeda(l.valor)}</td>
                    <td style={td}>{ROTULO_DESTINO_DEVOLUCAO[l.destino]}{l.destino === 'banco' && l.bancoNome ? ` (${l.bancoNome})` : ''}</td>
                    <td style={td}>
                      <span
                        title={l.situacao === STATUS_DEVOLUCAO.recusada && l.motivoRecusa ? `Motivo da recusa: ${l.motivoRecusa}` : undefined}
                        style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, color: estilo.cor, backgroundColor: estilo.fundo, whiteSpace: 'nowrap' }}
                      >
                        {ROTULO_SITUACAO_DEVOLUCAO[l.situacao]}
                      </span>
                    </td>
                    <td style={td}>{ROTULO_ORIGEM_DEVOLUCAO[l.origem]}</td>
                    <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {l.situacao === STATUS_DEVOLUCAO.aguardando ? (
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button type="button" className="btn-primary" disabled={ocupado} onClick={() => void confirmar(l)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}>
                            <Check size={16} /> {ocupado ? 'Aguarde...' : 'Confirmar'}
                          </button>
                          <button type="button" className="btn-secondary" disabled={ocupado} onClick={() => void recusar(l)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', color: '#ef4444' }}>
                            <X size={16} /> Recusar
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="btn-secondary" disabled={!l.pedidoId} onClick={() => abrirPedido(l)} title="Abrir o pedido (o estorno da devolução fica na tela do pedido)" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}>
                          <ExternalLink size={16} /> Abrir pedido
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <MostrarMaisLinhas blocos={blocos} />
      </div>

      {escolhendoPedido && (
        <EscolherPedidoDevolucaoModal
          onClose={() => setEscolhendoPedido(false)}
          onEscolher={(p) => { setEscolhendoPedido(false); setPedidoSelecionado(p); }}
        />
      )}

      {pedidoSelecionado && (
        <DevolucaoVendaModal
          pedidoId={pedidoSelecionado.id}
          numeroPedido={pedidoSelecionado.numeroPedido}
          clienteNome={pedidoSelecionado.clienteNome || ''}
          dataVenda={pedidoSelecionado.dataVenda}
          itens={pedidoSelecionado.itens || []}
          onClose={() => setPedidoSelecionado(null)}
          onSuccess={() => undefined}
          onComprovante={(id) => setComprovanteId(id)}
        />
      )}

      {comprovanteId && <ComprovanteDevolucao devolucaoId={comprovanteId} onFechar={() => setComprovanteId(null)} />}

      {notaDaDevolucao && (
        <DevolucaoNfeModal devolucaoId={notaDaDevolucao.id} numeroPedido={notaDaDevolucao.numeroPedido} onClose={() => setNotaDaDevolucao(null)} />
      )}
    </div>
  );
};

export default DevolucoesVenda;
