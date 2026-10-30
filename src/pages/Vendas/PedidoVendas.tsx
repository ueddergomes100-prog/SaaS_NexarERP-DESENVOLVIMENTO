import React, { useState, useEffect, useContext } from 'react';
import { ehPedidoDeBonificacao } from '../../utils/bonificacaoDomain';
import { useNavigate } from 'react-router-dom';
import { compararPorNumero, useOrdemNumero } from '../../hooks/useOrdemNumero';
import { useNaoImpressasPrimeiro } from '../../hooks/useNaoImpressasPrimeiro';
import { compararPorImpressao } from '../../utils/relatorioPreVendasDomain';
import { foiImpresso, OPCOES_FILTRO_IMPRESSAO, passaNoFiltroDeImpressao, rotuloDoFiltroDeImpressao, type FiltroImpressao } from '../../utils/impressaoListaDomain';
import { ShoppingCart, Plus, Search, FileText, Printer, XCircle, UserCheck, Filter, Truck, CheckCircle2, Lock } from 'lucide-react';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, getDocs, serverTimestamp, Timestamp, type QuerySnapshot, type DocumentData } from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { diasDoPeriodoLista, PERIODO_LISTA_PADRAO, type PresetPeriodoLista } from '../../utils/periodoListaDomain';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs, TabActiveContext } from '../../contexts/TabsContext';
import { showSuccess, showError, NexusSwal, escaparHtml } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { spedyService } from '../../services/spedyService';
import { isPlatformAdminRole } from '../../utils/roles';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from './pedidoPrintLoteConstants';
import {
  contaComoFaturamento,
  isPedidoAberto,
  STATUS_CANCELADA,
  STATUS_EM_ANALISE,
  STATUS_PEDIDO_ABERTO,
  STATUS_PRE_VENDA,
} from '../../utils/preVendaDomain';
import {
  listaGeralDeVendasEscondidaParaFuncionario,
  parseExigirIdentificacaoVendedor,
} from '../../utils/vendedorPinDomain';
import { rotuloNotaFiscalPedido } from '../../utils/pedidoVendedorDomain';
import { tomDoStatusPedido, type TomChip } from '../../utils/chipStatusDomain';
import AvatarIniciais from '../../components/common/AvatarIniciais';
import AlcaLarguraColuna, { useLarguraColuna } from '../../components/common/AlcaLarguraColuna';
import { useTravasAtivas } from '../../hooks/useTravaDeEdicao';
import { descreverTrava, mensagemDeBloqueio } from '../../utils/travaEdicaoDomain';
import { FiltroColuna, itemOpcaoStyle, OpcoesFiltro } from '../../components/common/FiltroColuna';
import {
  addDaysToDateInput,
  dateInputToUtcEnd,
  dateInputToUtcStart,
  formatDateInputPtBr,
  getDashboardPeriodRange,
  getDateInputInTimeZone,
  isWithinDateRange,
} from '../../utils/dateTime';

interface ItemVenda {
  id: string;
  nome: string;
  quantidade: number;
  precoUnitario: number;
}

interface PedidoVendaData {
  id: string;
  numeroPedido: string;
  createdAt?: { seconds?: number; nanoseconds?: number };
  dataVenda?: string;
  clienteNome?: string;
  formaPagamento?: string;
  status: string;
  valorTotal: number;
  itens?: ItemVenda[];
  tenantId: string;
  statusConferencia?: string;
  /** Marca do vendedor externo (COM/SEM nota fiscal); ausente = nao informado. */
  comNotaFiscal?: boolean;
  /** true depois da 1a impressao do Recibo/Pre-venda -- ver PedidoPrint.tsx. */
  impresso?: boolean;
  /** true depois da 1a impressao da Minuta -- ver MinutaPrint.tsx. */
  minutaImpressa?: boolean;
  vendedorId?: string;
  vendedorNome?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
}

/**
 * A mesma data que o Relatorio de Vendas usa pra filtrar por periodo
 * (`dataVenda`, com `createdAt` so' como fallback pra pedido antigo sem
 * o campo) -- nao a data de CRIACAO do documento. Foi divergencia entre
 * "esta tela mostra uma data" e "o relatorio filtra por outra" que fez o
 * pedido #0154 do Shopping Rural parecer normal aqui e sumir de la (ver
 * VerificadorDataDoSistema.tsx). Mostrar e filtrar pelo mesmo campo do
 * financeiro fecha essa divergencia por completo.
 */
const dataEfetivaPedido = (p: PedidoVendaData): Date | null => {
  if (p.dataVenda) return dateInputToUtcStart(p.dataVenda);
  if (p.createdAt?.seconds) return new Date(p.createdAt.seconds * 1000);
  return null;
};

const formatarDataEfetiva = (p: PedidoVendaData): string => {
  if (p.dataVenda) return formatDateInputPtBr(p.dataVenda);
  if (p.createdAt?.seconds) return new Date(p.createdAt.seconds * 1000).toLocaleDateString('pt-BR');
  return '-';
};

/**
 * Chave pra AGRUPAR vendedor no filtro por nome (maiuscula/minuscula e
 * espaco nao contam) -- 2026-09-23, bug relatado: renomear um vendedor
 * (so a caixa mudou, "antonio tato" -> "ANTONIO TATO") fazia o dropdown
 * mostrar as duas grafias como pessoas diferentes, porque `vendedorNome` e'
 * gravado (snapshot) em cada pedido na hora da venda, nao lido ao vivo do
 * cadastro -- pedido antigo continua com o nome de quando foi feito.
 *
 * So agrupa pra exibir/filtrar; NUNCA reescreve o nome gravado no pedido
 * (seria mexer no historico da venda).
 */
const chaveVendedorFiltro = (nome: string): string => nome.trim().toLowerCase().replace(/\s+/g, ' ');

type FiltroDataPreset = PresetPeriodoLista;

const ROTULO_PRESET_DATA: Record<Exclude<FiltroDataPreset, '' | 'personalizado'>, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7dias': 'Últimos 7 dias',
  mes: 'Este mês',
};


// Modulo 12 (Conferencia de mercadoria) -- rotulos/cores da coluna opcional.
// Fatia 1/4 so grava 'aguardando'; os demais estados existem desde ja pra
// nao precisar voltar neste arquivo nas fatias 3/4.
const CONFERENCIA_STATUS_LABELS: Record<string, string> = {
  aguardando: 'Aguardando Conferência',
  em_conferencia: 'Em Conferência',
  conferido: 'Conferido',
  divergente: 'Divergente',
};
/** Cor do chip da conferencia (.hd-chip, visualDesktop.css). */
const CONFERENCIA_STATUS_TOM: Record<string, TomChip> = {
  aguardando: 'ambar',
  em_conferencia: 'azul',
  conferido: 'verde',
  divergente: 'verm',
};

const PedidoVendas: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  // Trava de edicao (15/10/2026): pedido aberto para editar por outra pessoa fica cinza e nao abre.
  const travasPedidos = useTravasAtivas('pedido_venda');
  const abrirPedido = (pedidoId: string) => {
    const trava = travasPedidos.get(pedidoId);
    if (trava) {
      void NexusSwal.fire({ title: 'Em edição por outra pessoa', text: mensagemDeBloqueio('pedido_venda', trava), icon: 'info', confirmButtonText: 'Entendi' });
      return;
    }
    void openTab(`/pedidos-venda/visualizar/${pedidoId}`);
  };
  const { currentUser, tenantId, userRole, userPermissions, isOwner, vendasVisiveisDeUsuarioId, nivelAcesso, trabalhaComPreVenda, agenteDigitalAtivo, controlaFiscal } = useAuth();
  const isTabActive = useContext(TabActiveContext);

  // Mesma permissao cobre editar/finalizar E recusar um pedido pendente do
  // agente -- nao criar uma permissao a mais so pra recusar.
  const canEditPendenteVenda = isOwner || isPlatformAdminRole(userRole) || (userPermissions && userPermissions.includes('vendas.pedidos_pendentes_editar'));

  const [pedidos, setPedidos] = useState<PedidoVendaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [ordemNumero, inverterOrdemNumero] = useOrdemNumero('pedidos.ordemNumero');
  // Coluna Cliente com largura ajustavel (pedido de cliente, 21/10/2026): arrastar a alca do cabecalho.
  const larguraCliente = useLarguraColuna('pedidos.larguraCliente', 180, 140, 700);
  // Aba Pre-vendas: o que ainda nao saiu no papel fica no topo (pedido do dono,
  // 2026-10-13); o cabecalho "Imp." alterna. "Impresso" aqui e' o mesmo que
  // acende o check da coluna: recibo/pre-venda OU minuta.
  const [naoImpressasPrimeiroPreVendas, alternarNaoImpressasPreVendas] = useNaoImpressasPrimeiro('pedidos.naoImpressasPrimeiro');
  // Nas outras abas (15/10/2026, pedido do cliente) a ordenacao tambem existe,
  // mas comeca desligada para nao mudar a ordem por numero de quem ja' usa.
  const [naoImpressasPrimeiroOutras, alternarNaoImpressasOutras] = useNaoImpressasPrimeiro('pedidos.outrasAbas.naoImpressasPrimeiro', false);
  const [activeTab, setActiveTab] = useState('Ativos');
  const naoImpressasPrimeiro = activeTab === 'PreVendas' ? naoImpressasPrimeiroPreVendas : naoImpressasPrimeiroOutras;
  const alternarNaoImpressas = activeTab === 'PreVendas' ? alternarNaoImpressasPreVendas : alternarNaoImpressasOutras;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Linha destacada por um clique simples (distinta de selectedIds, que sao
   * os checkboxes de impressao em lote). Abrir exige duplo clique ou Enter. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Previa dos itens do pedido, aberta pelo botao "Ver Itens" na barra de
   * acoes -- so aparece com exatamente 1 pedido marcado no checkbox. Fecha
   * sozinha se a selecao deixar de ser exatamente 1. */
  const [showItemPreview, setShowItemPreview] = useState(false);
  const [conferenciaMercadoriaAtiva, setConferenciaMercadoriaAtiva] = useState(false);
  const [exigirIdentificacaoVendedor, setExigirIdentificacaoVendedor] = useState(false);

  // Filtros por coluna (estilo planilha, pedido pela usuaria no video da F27
  // de bugfix da data da venda). Ficam SO' na memoria do componente --
  // nunca em localStorage -- e sao zerados assim que o usuario sai desta
  // tela (troca de aba ou fecha), pra nao repetir o susto do #0154: filtro
  // esquecido ligado faz parecer que pedido sumiu, quando so' esta fora do
  // filtro de ontem.
  const [filtroVendedor, setFiltroVendedor] = useState('');
  const [filtroFormaPagamento, setFiltroFormaPagamento] = useState('');
  const [filtroConferencia, setFiltroConferencia] = useState('');
  // Coluna Imp.: Todos / Impressos / Nao impressos (pedido do cliente de 15/10/2026).
  const [filtroImpressao, setFiltroImpressao] = useState<FiltroImpressao>('');
  // Abre no mes atual (decisao do dono, 14/10): o periodo vai para a consulta.
  const [filtroDataPreset, setFiltroDataPreset] = useState<FiltroDataPreset>(PERIODO_LISTA_PADRAO);
  // A pessoa mexeu no filtro de Data? Nas abas de pedidos em ABERTO
  // (Pre-vendas, Pendentes) o mes atual padrao NAO filtra: pre-venda de
  // setembro ainda em aberto tem de continuar na fila (o susto do #0154).
  const [periodoEscolhido, setPeriodoEscolhido] = useState(false);
  const escolherPeriodo = (preset: FiltroDataPreset) => {
    setFiltroDataPreset(preset);
    setPeriodoEscolhido(true);
  };
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');

  useEffect(() => {
    if (isTabActive) return;
    setFiltroVendedor('');
    setFiltroFormaPagamento('');
    setFiltroConferencia('');
    setFiltroImpressao('');
    setFiltroDataPreset(PERIODO_LISTA_PADRAO);
    setPeriodoEscolhido(false);
    setFiltroDataInicio('');
    setFiltroDataFim('');
  }, [isTabActive]);

  // Lista geral so e' escondida da TELA (nao do Firestore) do funcionario
  // comum quando a empresa liga "Exigir identificacao do vendedor" -- ver
  // vendedorPinDomain.ts. Quem tem acesso total continua vendo tudo.
  const listaEscondida = listaGeralDeVendasEscondidaParaFuncionario({
    exigirIdentificacaoVendedor,
    role: userRole,
    isOwner,
    nivelAcesso,
  });

  // Estado para armazenar IDs dos cupons autorizados
  const [authorizedCupons, setAuthorizedCupons] = useState<Record<string, { spedyId: string; status: string }>>({});

  // Periodo que vai para a CONSULTA (periodoListaDomain.ts). A lista abre no
  // mes atual e o banco devolve so' esses dias -- antes era o historico
  // inteiro da empresa a cada abertura. "Todas" (null) le tudo, como antes.
  const periodoConsulta = diasDoPeriodoLista(filtroDataPreset, getDateInputInTimeZone(), filtroDataInicio, filtroDataFim);
  const periodoDe = periodoConsulta?.de ?? '';
  const periodoAte = periodoConsulta?.ate ?? '';

  useEffect(() => {
    // Sem controle fiscal o botao de cupom nem aparece: nao le nota nenhuma.
    if (!currentUser || !tenantId || !controlaFiscal) {
      setAuthorizedCupons({});
      return undefined;
    }

    // Cupons (NFC-e) das vendas do periodo: o cupom nasce na venda ou depois
    // dela, entao basta createdAt a partir do 1o dia do periodo.
    const todasNfce = query(
      collection(db, 'notas_fiscais'),
      where('tenantId', '==', tenantId),
      where('tipo', '==', 'NFC-e')
    );
    const inicioCupons = periodoDe ? dateInputToUtcStart(periodoDe) : null;
    const qNotas = inicioCupons
      ? query(todasNfce, where('createdAt', '>=', Timestamp.fromDate(inicioCupons)))
      : todasNfce;

    const unsubscribeNotas = assinarComReserva(qNotas, todasNfce, 'Pedidos de Venda (cupons)', (snapshot) => {
      const cupons: Record<string, { spedyId: string; status: string }> = {};
      snapshot.forEach(d => {
        const data = d.data();
        if (data.pedidoId) {
          cupons[data.pedidoId] = {
            spedyId: data.spedyId || '',
            status: data.status || ''
          };
        }
      });
      setAuthorizedCupons(cupons);
    });

    return () => unsubscribeNotas();
  }, [currentUser, tenantId, controlaFiscal, periodoDe]);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : {};
        setConferenciaMercadoriaAtiva(data.conferenciaMercadoria === true);
        setExigirIdentificacaoVendedor(parseExigirIdentificacaoVendedor(data.exigirIdentificacaoVendedor));
      })
      .catch((err) => console.error('Erro ao verificar configuração de conferência de mercadoria:', err));
  }, [currentUser, tenantId]);

  // Duas consultas: (1) pedidos em ABERTO (pre-venda e pendente do agente)
  // por status, de qualquer data -- pendente nunca some por periodo; (2) os do
  // PERIODO por dataVenda, a mesma data que a tela mostra e filtra (ver
  // dataEfetivaPedido). Pedido antigo sem dataVenda so' aparece em "Todas".
  // Sem o indice (tenantId, dataVenda) publicado, a (2) cai na colecao
  // inteira e o filtro de data da tela segura o resultado.
  useEffect(() => {
    if (!currentUser || !tenantId) return undefined;
    setLoading(true);

    const base = collection(db, 'pedidos_venda');
    const todos = query(base, where('tenantId', '==', tenantId));
    const lerPedidos = (snapshot: QuerySnapshot<DocumentData>) => snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PedidoVendaData));
    let abertos: PedidoVendaData[] = [];
    let doPeriodo: PedidoVendaData[] = [];
    let abertosChegaram = !periodoDe; // em "Todas" a consulta do periodo ja' traz os abertos
    let periodoChegou = false;

    const publicar = () => {
      const porId = new Map<string, PedidoVendaData>();
      [...doPeriodo, ...abertos].forEach((pedido) => porId.set(pedido.id, pedido));
      const p = Array.from(porId.values());
      p.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      // Filtra no cliente, e nao com um where(vendedorId) na query, porque
      // venda antiga pode ter so usuarioResponsavelId/criadoPor -- um where
      // num campo so sumiria com pedido que e' do proprio usuario.
      setPedidos(filtrarVendasVisiveis(p, vendasVisiveisDeUsuarioId));
      if (abertosChegaram && periodoChegou) setLoading(false);
    };

    const pararAbertos = periodoDe
      ? onSnapshot(query(base, where('tenantId', '==', tenantId), where('status', 'in', [...STATUS_PEDIDO_ABERTO])), (snapshot) => {
        abertos = lerPedidos(snapshot);
        abertosChegaram = true;
        publicar();
      }, (erro) => {
        console.error('Pedidos de Venda (em aberto):', erro);
        abertosChegaram = true;
        publicar();
      })
      : () => {};

    const doPeriodoQuery = periodoDe
      ? query(base, where('tenantId', '==', tenantId), where('dataVenda', '>=', periodoDe), where('dataVenda', '<=', periodoAte))
      : todos;
    const pararPeriodo = assinarComReserva(doPeriodoQuery, todos, 'Pedidos de Venda', (snapshot) => {
      doPeriodo = lerPedidos(snapshot);
      periodoChegou = true;
      publicar();
    });

    return () => {
      pararAbertos();
      pararPeriodo();
    };
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId, periodoDe, periodoAte]);

  // Pedido "Em Analise" so e gravado por integracao externa (agente de
  // WhatsApp) -- nenhuma tela deste sistema grava esse status (ver
  // handleFinalizarVenda em PedidoVendaForm.tsx, sempre grava 'Finalizada').
  // Fatia 3/4 do recurso de pedidos pendentes vai deixar editar/finalizar.
  const handleRecusar = async (pedido: PedidoVendaData) => {
    if (!currentUser || !tenantId) return;

    const result = await NexusSwal.fire({
      title: 'Recusar Pedido Pendente?',
      html: `O pedido <strong>#${escaparHtml(pedido.numeroPedido)}</strong> (${escaparHtml(pedido.clienteNome || 'sem cliente')}) veio de uma integração externa e ainda não gerou baixa de estoque nem lançamento financeiro — recusar só marca como cancelado, não reverte nada.<br/><br/>Digite o motivo (mínimo 8 caracteres):`,
      input: 'text',
      inputLabel: 'Motivo da recusa',
      inputAttributes: { minlength: '8', required: 'true' },
      showCancelButton: true,
      confirmButtonText: 'Confirmar Recusa',
      cancelButtonText: 'Voltar',
      confirmButtonColor: '#ef4444',
      preConfirm: (motivo) => {
        if (!motivo || motivo.trim().length < 8) {
          NexusSwal.showValidationMessage('O motivo deve ter pelo menos 8 caracteres.');
          return false;
        }
        return motivo;
      },
    });

    if (!result.isConfirmed) return;
    const motivo = (result.value as string).trim();

    try {
      await updateDoc(doc(db, 'pedidos_venda', pedido.id), {
        status: 'Cancelada',
        motivoRecusa: motivo,
        ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), `Pedido pendente recusado: ${motivo}`),
      });

      try {
        const { createAuditLog } = await import('../../services/logService');
        createAuditLog({
          tenantId,
          usuarioId: currentUser.uid,
          usuarioEmail: currentUser.email || '',
          modulo: 'vendas',
          acao: 'recusa_pedido_pendente',
          descricao: `Pedido pendente #${pedido.numeroPedido} recusado. Motivo: ${motivo}`,
          registroRelacionadoId: pedido.id,
          status: 'sucesso',
        });
      } catch {
        // ignore audit log error
      }

      showSuccess('Pedido recusado.');
    } catch {
      showError('Erro', 'Não foi possível recusar o pedido.');
    }
  };

  // Pedidos da aba ativa (Ativos/Pre-vendas/Pendentes/Cancelados) + busca de
  // texto, ANTES dos filtros de coluna -- e' desta lista que as opcoes dos
  // dropdowns (Vendedor, Forma de Pagamento, Conferencia) sao derivadas, pra
  // nunca oferecer uma opcao que nao existe nesta aba.
  // "Ativos / Faturados" = so o que virou venda de verdade. Pedido em
  // aberto (pre-venda do balcao ou pendente do agente) tem aba propria --
  // misturar os dois faria a aba principal mostrar como venda algo que
  // ainda nao faturou.
  const pertenceAAba = (p: PedidoVendaData, aba: string) => (
    aba === 'Ativos'
      ? contaComoFaturamento(p.status)
      : aba === 'PreVendas'
        ? p.status === STATUS_PRE_VENDA
        : aba === 'Pendentes'
          ? p.status === STATUS_EM_ANALISE
          : p.status === STATUS_CANCELADA
  );
  const casaComBusca = (p: PedidoVendaData) => (
    !searchTerm || p.clienteNome?.toLowerCase().includes(searchTerm.toLowerCase()) || p.numeroPedido?.includes(searchTerm)
  );
  const pedidosDoContexto = pedidos.filter(p => pertenceAAba(p, activeTab) && casaComBusca(p));

  // Um vendedor so' aparece uma vez, mesmo com grafias diferentes entre
  // pedidos antigos e novos -- `pedidosDoContexto` ja vem do mais recente
  // pro mais antigo (ver o sort em `pedidos`), entao a primeira grafia
  // encontrada por chave e' sempre a mais atual.
  const opcoesVendedorPorChave = new Map<string, string>();
  pedidosDoContexto.forEach((p) => {
    if (!p.vendedorNome) return;
    const chave = chaveVendedorFiltro(p.vendedorNome);
    if (!opcoesVendedorPorChave.has(chave)) opcoesVendedorPorChave.set(chave, p.vendedorNome);
  });
  const opcoesVendedor = Array.from(opcoesVendedorPorChave.values()).sort((a, b) => a.localeCompare(b));
  const opcoesFormaPagamento = Array.from(new Set(pedidosDoContexto.map(p => p.formaPagamento).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b));
  const opcoesConferencia = Array.from(new Set(pedidosDoContexto.map(p => p.statusConferencia).filter((v): v is string => Boolean(v))));

  // Periodo efetivo do filtro de Data -- presets rapidos ou intervalo
  // personalizado, sempre calculado sobre `dataVenda` (ver dataEfetivaPedido).
  const periodoDataFiltro = (() => {
    if (!filtroDataPreset) return null;
    const hoje = getDateInputInTimeZone();
    if (filtroDataPreset === 'hoje') {
      const inicio = dateInputToUtcStart(hoje);
      const fim = dateInputToUtcEnd(hoje);
      return inicio && fim ? { inicio, fim } : null;
    }
    if (filtroDataPreset === 'ontem') {
      const ontem = addDaysToDateInput(hoje, -1);
      const inicio = dateInputToUtcStart(ontem);
      const fim = dateInputToUtcEnd(ontem);
      return inicio && fim ? { inicio, fim } : null;
    }
    if (filtroDataPreset === '7dias') {
      const inicioInput = addDaysToDateInput(hoje, -6);
      const inicio = dateInputToUtcStart(inicioInput);
      const fim = dateInputToUtcEnd(hoje);
      return inicio && fim ? { inicio, fim } : null;
    }
    if (filtroDataPreset === 'mes') {
      const range = getDashboardPeriodRange('mes');
      const fim = dateInputToUtcEnd(range.endDate);
      return fim ? { inicio: range.start, fim } : null;
    }
    if (filtroDataPreset === 'personalizado') {
      if (!filtroDataInicio || !filtroDataFim) return null;
      const inicio = dateInputToUtcStart(filtroDataInicio);
      const fim = dateInputToUtcEnd(filtroDataFim);
      return inicio && fim ? { inicio, fim } : null;
    }
    return null;
  })();

  const rotuloPeriodoFiltro = filtroDataPreset === 'personalizado'
    ? (filtroDataInicio && filtroDataFim ? `${formatDateInputPtBr(filtroDataInicio)} a ${formatDateInputPtBr(filtroDataFim)}` : 'Personalizado')
    : filtroDataPreset
      ? ROTULO_PRESET_DATA[filtroDataPreset]
      : '';

  const abaDePedidosEmAberto = activeTab === 'PreVendas' || activeTab === 'Pendentes';
  const filtroDataValeNestaAba = !abaDePedidosEmAberto || periodoEscolhido;
  const periodoAplicado = filtroDataValeNestaAba ? periodoDataFiltro : null;

  const filteredPedidos = pedidosDoContexto.filter(p => {
    if (filtroVendedor && chaveVendedorFiltro(p.vendedorNome || '') !== chaveVendedorFiltro(filtroVendedor)) return false;
    if (filtroFormaPagamento && p.formaPagamento !== filtroFormaPagamento) return false;
    if (filtroConferencia && p.statusConferencia !== filtroConferencia) return false;
    if (!passaNoFiltroDeImpressao(foiImpresso(p), filtroImpressao)) return false;
    if (periodoAplicado && !isWithinDateRange(dataEfetivaPedido(p), periodoAplicado.inicio, periodoAplicado.fim)) return false;
    return true;
  }).sort((a, b) => (
    (naoImpressasPrimeiro ? compararPorImpressao({ impressa: foiImpresso(a) }, { impressa: foiImpresso(b) }) : 0)
    || compararPorNumero(a.numeroPedido, b.numeroPedido, ordemNumero)
  ));

  const filtrosDeColunaAtivos = [
    filtroVendedor && { rotulo: 'Vendedor', valor: filtroVendedor, limpar: () => setFiltroVendedor('') },
    filtroFormaPagamento && { rotulo: 'Forma', valor: filtroFormaPagamento, limpar: () => setFiltroFormaPagamento('') },
    filtroConferencia && { rotulo: 'Conferência', valor: CONFERENCIA_STATUS_LABELS[filtroConferencia] || filtroConferencia, limpar: () => setFiltroConferencia('') },
    filtroImpressao && { rotulo: 'Imp.', valor: rotuloDoFiltroDeImpressao(filtroImpressao), limpar: () => setFiltroImpressao('') },
    filtroDataPreset && filtroDataValeNestaAba && { rotulo: 'Data', valor: rotuloPeriodoFiltro, limpar: () => { escolherPeriodo(''); setFiltroDataInicio(''); setFiltroDataFim(''); } },
  ].filter((f): f is { rotulo: string; valor: string; limpar: () => void } => Boolean(f));

  const limparFiltrosDeColuna = () => {
    setFiltroVendedor('');
    setFiltroFormaPagamento('');
    setFiltroConferencia('');
    setFiltroImpressao('');
    setFiltroDataPreset(PERIODO_LISTA_PADRAO);
    setPeriodoEscolhido(false);
    setFiltroDataInicio('');
    setFiltroDataFim('');
  };

  const totalFiltrado = filteredPedidos.reduce((soma, p) => soma + (p.valorTotal || 0), 0);

  const allVisibleSelected = filteredPedidos.length > 0 && filteredPedidos.every(p => selectedIds.has(p.id));

  const toggleSelectOne = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= PEDIDO_PRINT_LOTE_SAFETY_LIMIT) {
        showError('Limite de seleção atingido', `Selecione no máximo ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} pedidos por vez para impressão em lote.`);
        return current;
      }
      next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(current => {
        const next = new Set(current);
        filteredPedidos.forEach(p => next.delete(p.id));
        return next;
      });
      return;
    }

    const idsToSelect = filteredPedidos.map(p => p.id).slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT);
    if (filteredPedidos.length > PEDIDO_PRINT_LOTE_SAFETY_LIMIT) {
      showError('Limite de seleção atingido', `Apenas os primeiros ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} pedidos foram selecionados. Imprima este lote e selecione o restante em seguida.`);
    }
    setSelectedIds(new Set(idsToSelect));
  };

  // Pergunta qual documento antes de imprimir em lote -- antes ia direto pro
  // Recibo/Pre-venda, e quem queria a Minuta de Entrega (papel de separacao,
  // sem valores) tinha que abrir pedido por pedido.
  const handlePrintSelected = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds).join(',');
    const escolha = await NexusSwal.fire({
      title: 'Imprimir o quê?',
      text: `${selectedIds.size} ${selectedIds.size === 1 ? 'pedido selecionado' : 'pedidos selecionados'}.`,
      icon: 'question',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: 'Recibo / Pré-venda',
      denyButtonText: 'Minuta de Entrega',
      cancelButtonText: 'Cancelar',
    });
    if (escolha.isConfirmed) {
      navigate(`/pedidos-venda/print-lote?ids=${ids}`);
    } else if (escolha.isDenied) {
      navigate(`/operacoes/expedicao/minuta-lote?ids=${ids}`);
    }
  };

  // ---------- design novo (14/10/2026): busca + abas com contagem, tabela e rodape de totais ----------
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  // Contagem de cada aba com a MESMA regra da lista (busca e periodo), sem os
  // filtros de coluna -- esses so' valem na aba aberta, que mostra o numero exato.
  const contagemDaAba = (aba: string) => {
    if (aba === activeTab) return filteredPedidos.length;
    const emAberto = aba === 'PreVendas' || aba === 'Pendentes';
    const periodo = !emAberto || periodoEscolhido ? periodoDataFiltro : null;
    return pedidos.filter((p) => (
      pertenceAAba(p, aba)
      && casaComBusca(p)
      && (!periodo || isWithinDateRange(dataEfetivaPedido(p), periodo.inicio, periodo.fim))
    )).length;
  };
  const abasDaLista = [
    { id: 'Ativos', rotulo: 'Ativos / Faturados' },
    ...(trabalhaComPreVenda ? [{ id: 'PreVendas', rotulo: 'Pré-vendas' }] : []),
    ...(agenteDigitalAtivo ? [{ id: 'Pendentes', rotulo: 'Pendentes' }] : []),
    { id: 'Cancelados', rotulo: 'Cancelados' },
  ];
  const somaDe = (filtro: (p: PedidoVendaData) => boolean) => filteredPedidos.filter(filtro).reduce((soma, p) => soma + (p.valorTotal || 0), 0);
  const totalFaturado = somaDe((p) => contaComoFaturamento(p.status));
  const totalEmAberto = somaDe((p) => isPedidoAberto(p.status));
  const totalCancelado = somaDe((p) => p.status === STATUS_CANCELADA);
  const rotuloPeriodoTopo = filtroDataValeNestaAba && rotuloPeriodoFiltro ? rotuloPeriodoFiltro : 'Todo o período';
  const quantidadeColunas = conferenciaMercadoriaAtiva ? 11 : 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>
            Pedidos de Venda
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {loading
              ? 'Carregando pedidos...'
              : `${rotuloPeriodoTopo} · ${filteredPedidos.length} ${filteredPedidos.length === 1 ? 'pedido' : 'pedidos'} · ${moeda.format(totalFiltrado)}`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/pedidos-venda/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Novo pedido
        </button>
      </div>

      {listaEscondida ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <UserCheck size={48} color="var(--accent-purple)" />
          <h2 style={{ fontSize: '18px', margin: 0 }}>Lista geral de pedidos desativada</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '480px', margin: 0 }}>
            Sua empresa ativou "Exigir identificação do vendedor a cada venda". Por isso, esta lista fica disponível só para dono, Master ou Admin. Para consultar e reimprimir suas próprias vendas, use a tela <strong>Minhas Vendas</strong>.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => openTab('/minhas-vendas', 'Minhas Vendas')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <UserCheck size={18} /> Ir para Minhas Vendas
          </button>
        </div>
      ) : (
      <>
      <div className="card" style={{ padding: '18px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px' }}>
          <div className="search-bar" style={{ flex: '1 1 300px', maxWidth: '420px', position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--app-icone-cor, var(--text-muted))' }} />
            <input
              type="text"
              placeholder="Buscar por cliente ou número do pedido"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', height: '46px', padding: '0 16px 0 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '14px', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="tablist" aria-label="Situação dos pedidos">
            {abasDaLista.map((aba) => (
              <button
                key={aba.id}
                type="button"
                role="tab"
                aria-selected={activeTab === aba.id}
                className={`hd-chip hd-chip--grande ${activeTab === aba.id ? 'violeta' : ''}`}
                onClick={() => setActiveTab(aba.id)}
              >
                {aba.rotulo}{loading ? '' : ` · ${contagemDaAba(aba.id)}`}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {selectedIds.size === 1 && (
            <button
              onClick={() => setShowItemPreview((atual) => !atual)}
              className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            >
              <FileText size={18} />
              {showItemPreview ? 'Ocultar Itens' : 'Ver Itens'}
            </button>
          )}
          {selectedIds.size > 0 && (
            <button
              onClick={handlePrintSelected}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            >
              <Printer size={18} />
              Imprimir Selecionados ({selectedIds.size})
            </button>
          )}
        </div>

        {filtrosDeColunaAtivos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '14px', fontSize: '13px' }}>
            <Filter size={14} color="var(--text-muted)" />
            {filtrosDeColunaAtivos.map((f) => (
              <span key={f.rotulo} className="hd-chip violeta">
                {f.rotulo}: <strong>{f.valor}</strong>
                <button
                  type="button"
                  onClick={f.limpar}
                  title={`Remover filtro de ${f.rotulo}`}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'inline-flex', lineHeight: 0 }}
                >
                  <XCircle size={14} />
                </button>
              </span>
            ))}
            <button type="button" className="hd-link" onClick={limparFiltrosDeColuna}>
              Limpar filtros
            </button>
          </div>
        )}

        {showItemPreview && selectedIds.size === 1 && (() => {
          const pedidoPreview = filteredPedidos.find((p) => selectedIds.has(p.id));
          if (!pedidoPreview) return null;
          return (
            <div style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '16px', marginTop: '14px' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
                Itens do pedido #{pedidoPreview.numeroPedido}
              </p>
              {(pedidoPreview.itens || []).length === 0 ? (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Nenhum item encontrado neste pedido.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(pedidoPreview.itens || []).map((item, index) => (
                    <div key={`${item.id}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0', borderBottom: index < (pedidoPreview.itens || []).length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                      <span>{item.nome}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{item.quantidade}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <div className="card" style={{ padding: '16px 14px 6px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="hd-tabela" style={{ ['--largura-cliente' as string]: `${larguraCliente.largura}px` } as React.CSSProperties}>
            <thead>
              <tr>
                <th style={{ width: '1%' }}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    disabled={filteredPedidos.length === 0}
                    title="Selecionar todos"
                    aria-label="Selecionar todos os pedidos visíveis"
                  />
                </th>
                <th>
                  <button type="button" onClick={inverterOrdemNumero} title="Inverter a ordem pelo número"
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Nº Pedido {ordemNumero === 'asc' ? '▲' : '▼'}
                  </button>
                </th>
                <th>
                  Data
                  <FiltroColuna ativo={Boolean(filtroDataPreset)}>
                    {() => (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <button
                          type="button"
                          style={itemOpcaoStyle(filtroDataPreset === '')}
                          onClick={() => { escolherPeriodo(''); setFiltroDataInicio(''); setFiltroDataFim(''); }}
                        >
                          Todas (histórico inteiro)
                        </button>
                        {(Object.keys(ROTULO_PRESET_DATA) as Array<keyof typeof ROTULO_PRESET_DATA>).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            style={itemOpcaoStyle(filtroDataPreset === preset)}
                            onClick={() => escolherPeriodo(preset)}
                          >
                            {ROTULO_PRESET_DATA[preset]}
                          </button>
                        ))}
                        <button
                          type="button"
                          style={itemOpcaoStyle(filtroDataPreset === 'personalizado')}
                          onClick={() => escolherPeriodo('personalizado')}
                        >
                          Período personalizado
                        </button>
                        {filtroDataPreset === 'personalizado' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', paddingTop: '6px', borderTop: '1px solid var(--border-color)' }}>
                            <input
                              type="date"
                              value={filtroDataInicio}
                              onChange={(event) => setFiltroDataInicio(event.target.value)}
                              style={{ padding: '4px 6px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                            />
                            <input
                              type="date"
                              value={filtroDataFim}
                              onChange={(event) => setFiltroDataFim(event.target.value)}
                              style={{ padding: '4px 6px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </FiltroColuna>
                </th>
                <th className="hd-tabela__cliente" style={{ position: 'relative' }}>
                  Cliente
                  <AlcaLarguraColuna coluna={larguraCliente} rotulo="Cliente" />
                </th>
                <th>
                  Vendedor
                  <FiltroColuna ativo={Boolean(filtroVendedor)}>
                    {(fechar) => (
                      <OpcoesFiltro
                        opcoes={opcoesVendedor}
                        valorSelecionado={filtroVendedor}
                        fechar={fechar}
                        onSelecionar={(valor, fecharPainel) => { setFiltroVendedor(valor); fecharPainel(); }}
                      />
                    )}
                  </FiltroColuna>
                </th>
                <th>
                  Pagamento
                  <FiltroColuna ativo={Boolean(filtroFormaPagamento)}>
                    {(fechar) => (
                      <OpcoesFiltro
                        opcoes={opcoesFormaPagamento}
                        valorSelecionado={filtroFormaPagamento}
                        fechar={fechar}
                        onSelecionar={(valor, fecharPainel) => { setFiltroFormaPagamento(valor); fecharPainel(); }}
                      />
                    )}
                  </FiltroColuna>
                </th>
                <th>Status</th>
                {conferenciaMercadoriaAtiva && (
                  <th>
                    Conferência
                    <FiltroColuna ativo={Boolean(filtroConferencia)}>
                      {(fechar) => (
                        <OpcoesFiltro
                          opcoes={opcoesConferencia}
                          valorSelecionado={filtroConferencia}
                          fechar={fechar}
                          formatarRotulo={(valor) => CONFERENCIA_STATUS_LABELS[valor] || valor}
                          onSelecionar={(valor, fecharPainel) => { setFiltroConferencia(valor); fecharPainel(); }}
                        />
                      )}
                    </FiltroColuna>
                  </th>
                )}
                <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }} title="Já foi impresso (recibo/pré-venda ou minuta)?">
                  <button
                    type="button"
                    onClick={alternarNaoImpressas}
                    aria-pressed={naoImpressasPrimeiro}
                    title={naoImpressasPrimeiro ? 'Não impressos no topo. Clique para ordenar só pelo número.' : 'Clique para trazer os não impressos para o topo.'}
                    style={{ background: 'none', border: 'none', padding: 0, color: naoImpressasPrimeiro ? '#f59e0b' : 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    Imp. {naoImpressasPrimeiro ? '▲' : '▼'}
                  </button>
                  <FiltroColuna ativo={Boolean(filtroImpressao)}>
                    {(fechar) => (
                      <OpcoesFiltro
                        opcoes={OPCOES_FILTRO_IMPRESSAO}
                        valorSelecionado={filtroImpressao}
                        fechar={fechar}
                        formatarRotulo={rotuloDoFiltroDeImpressao}
                        onSelecionar={(valor, fecharPainel) => { setFiltroImpressao(valor as FiltroImpressao); fecharPainel(); }}
                      />
                    )}
                  </FiltroColuna>
                </th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={quantidadeColunas} style={{ textAlign: 'center', padding: '40px' }}>Carregando pedidos...</td>
                </tr>
              ) : filteredPedidos.length === 0 ? (
                <tr>
                  <td colSpan={quantidadeColunas} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <ShoppingCart size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Nenhum pedido de venda encontrado.</p>
                  </td>
                </tr>
              ) : (
                filteredPedidos.map(p => (
                  // 1 clique seleciona, 2 cliques abrem o pedido -- mesmo padrao
                  // de Estoque/Clientes/OS/Orcamentos. Esta tela abria com 1
                  // clique so; passou a exigir 2 pra ficar consistente com as
                  // outras e nao abrir aba a cada clique de leitura (o limite de
                  // abas e 8). As celulas de checkbox e de acoes param a
                  // propagacao pra continuarem com o comportamento delas.
                  <tr
                    key={p.id}
                    className={selectedId === p.id ? 'row-selectable is-selected' : 'row-selectable'}
                    onClick={() => setSelectedId(p.id)}
                    onDoubleClick={() => abrirPedido(p.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') abrirPedido(p.id);
                    }}
                    tabIndex={0}
                    title={travasPedidos.get(p.id) ? descreverTrava(travasPedidos.get(p.id)!) : 'Clique para selecionar, duplo clique para visualizar'}
                    style={{ opacity: p.status === 'Cancelada' || travasPedidos.has(p.id) ? 0.55 : 1 }}
                  >
                    <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelectOne(p.id)}
                        aria-label={`Selecionar pedido ${p.numeroPedido}`}
                      />
                    </td>
                    <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                      #{p.numeroPedido}
                      {travasPedidos.get(p.id) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '170px' }}>
                          <Lock size={12} style={{ flex: 'none' }} /> {descreverTrava(travasPedidos.get(p.id)!)}
                        </div>
                      )}
                    </td>
                    <td className="hd-tabela__mudo">{formatarDataEfetiva(p)}</td>
                    <td className="hd-tabela__cliente">
                      <div className="hd-pessoa">
                        <AvatarIniciais nome={p.clienteNome} />
                        <strong>{p.clienteNome || 'Cliente não informado'}</strong>
                      </div>
                    </td>
                    <td className="hd-tabela__mudo">{p.vendedorNome || '—'}</td>
                    <td className="hd-tabela__mudo">{p.formaPagamento || '—'}</td>
                    <td>
                      <span className={`hd-chip ${tomDoStatusPedido(p.status)}`}>{p.status}</span>
                      {ehPedidoDeBonificacao(p as { tipoPedido?: unknown }) && <span className="hd-chip" style={{ marginLeft: '6px', color: '#d97706', borderColor: 'rgba(217,119,6,0.45)', backgroundColor: 'rgba(217,119,6,0.10)' }} title="Pedido de bonificação: só brindes, sem cobrança, nota própria">BONIFICAÇÃO</span>}
                      {rotuloNotaFiscalPedido(p.comNotaFiscal) && (
                        <div style={{ marginTop: '6px' }}>
                          <span
                            title="Marcado pelo vendedor no aplicativo"
                            className={`hd-chip hd-chip--mini ${rotuloNotaFiscalPedido(p.comNotaFiscal)?.tom === 'com' ? 'verde' : ''}`}
                          >
                            {rotuloNotaFiscalPedido(p.comNotaFiscal)?.texto}
                          </span>
                        </div>
                      )}
                    </td>
                    {conferenciaMercadoriaAtiva && (
                      <td>
                        {p.statusConferencia ? (
                          <span className={`hd-chip ${CONFERENCIA_STATUS_TOM[p.statusConferencia] || ''}`}>
                            {CONFERENCIA_STATUS_LABELS[p.statusConferencia] || p.statusConferencia}
                          </span>
                        ) : (
                          <span className="hd-tabela__mudo">—</span>
                        )}
                      </td>
                    )}
                    <td
                      style={{ textAlign: 'center' }}
                      title={p.impresso && p.minutaImpressa ? 'Recibo e minuta já impressos' : p.impresso ? 'Recibo já impresso' : p.minutaImpressa ? 'Minuta já impressa' : 'Ainda não impresso'}
                    >
                      {(p.impresso || p.minutaImpressa) ? <CheckCircle2 size={18} color="#10b981" style={{ display: 'inline-block' }} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {moeda.format(p.valorTotal)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                        <button onClick={() => abrirPedido(p.id)} className="icon-btn" title="Visualizar Pedido" style={{ color: '#3b82f6' }}>
                          <FileText size={18} />
                        </button>
                        {controlaFiscal && authorizedCupons[p.id] && authorizedCupons[p.id].status === 'authorized' ? (
                          <button
                            onClick={() => {
                              // O cupom abre num PDF fora do sistema: marca como impresso
                              // ao abrir, senao esse caminho nunca acenderia o "Imp.".
                              updateDoc(doc(db, 'pedidos_venda', p.id), { impresso: true, impressoEm: serverTimestamp() })
                                .catch((err) => console.error('Erro ao marcar cupom como impresso:', err));
                              const cupom = authorizedCupons[p.id];
                              spedyService.openFiscalFile(cupom.spedyId, 'consumer', 'pdf')
                                .catch(err => showError('Erro ao abrir cupom fiscal', (err as Error).message));
                            }}
                            className="icon-btn"
                            title="Imprimir Cupom Fiscal (NFC-e)"
                            style={{ color: '#8b5cf6' }}
                          >
                            <Printer size={18} />
                          </button>
                        ) : (
                          <button onClick={() => navigate(`/pedidos-venda/print/${p.id}`)} className="icon-btn" title="Imprimir Recibo" style={{ color: '#10b981' }}>
                            <Printer size={18} />
                          </button>
                        )}
                        {(p.status === 'Finalizada' || p.status === 'Pré-venda') && (
                          <button onClick={() => navigate(`/operacoes/expedicao/minuta/${p.id}`)} className="icon-btn" title="Imprimir Minuta de Entrega" style={{ color: '#3b82f6' }}>
                            <Truck size={18} />
                          </button>
                        )}
                        {p.status === 'Em Análise' && canEditPendenteVenda && (
                          <button onClick={() => handleRecusar(p)} className="icon-btn" title="Recusar Pedido Pendente" style={{ color: '#ef4444' }}>
                            <XCircle size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && filteredPedidos.length > 0 && (
        <div className="card" style={{ padding: '14px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>
            Mostrando <strong style={{ color: 'var(--text-primary)' }}>{filteredPedidos.length}</strong> {filteredPedidos.length === 1 ? 'pedido' : 'pedidos'}
          </span>
          {totalFaturado > 0 && <span className="hd-chip verde">Faturado: {moeda.format(totalFaturado)}</span>}
          {totalEmAberto > 0 && <span className="hd-chip azul">Em aberto: {moeda.format(totalEmAberto)}</span>}
          {totalCancelado > 0 && <span className="hd-chip">Cancelado: {moeda.format(totalCancelado)}</span>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 600 }}>
            Total <strong style={{ marginLeft: '6px', fontSize: '17px', color: 'var(--text-primary)', fontWeight: 800 }}>{moeda.format(totalFiltrado)}</strong>
          </span>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default PedidoVendas;
