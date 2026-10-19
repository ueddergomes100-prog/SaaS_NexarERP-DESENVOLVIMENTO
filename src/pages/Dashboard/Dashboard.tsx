import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  MoreVertical,
  Package,
  PackageX,
  Plus,
  ShoppingCart,
  Users,
  Wallet,
  Wrench
} from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import AvatarIniciais from '../../components/common/AvatarIniciais';
import { tomDoContador, tomDoStatusPedido, type TomChip } from '../../utils/chipStatusDomain';
import {
  collection,
  doc,
  onSnapshot,
  query,
  Timestamp,
  where,
  type DocumentData,
  type FirestoreError,
  type QuerySnapshot,
} from 'firebase/firestore';
import { assinarComReserva } from '../../services/consultaComReserva';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { TabActiveContext, useTabs } from '../../contexts/TabsContext';
import {
  dateInputToUtcStart,
  DEFAULT_TIME_ZONE,
  differenceInCalendarDays,
  getDateInputInTimeZone,
  getDashboardPeriodRange,
  getZonedParts,
  isWithinDateRange,
  type DashboardPeriod,
} from '../../utils/dateTime';
import { contaComoFaturamento, isPedidoAberto } from '../../utils/preVendaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { contaComoReceita, fromCents, isRevenueReversal, receitaDoConjuntoCentavos, transactionDueDateInput, transactionNetAmount, type TransacaoDeReceita } from '../../utils/financeDomain';
import { calcularProgressoMeta, faltaParaMeta, parseMetaFaturamentoMensal } from '../../utils/metaFaturamentoDomain';
import './Dashboard.css';

interface OSData {
  id: string;
  clienteNome: string;
  modelo: string;
  placa: string;
  status: string;
  statusColor?: string;
  valorTotal?: number;
  total?: number;
  createdAt?: any;
}

interface TransacaoData {
  id: string;
  descricao?: string;
  valor: number;
  tipo: 'entrada' | 'saida';
  status: 'Paga' | 'Pendente' | 'Cancelada';
  formaPagamento?: string;
  data?: string;
  dataPagamento?: string;
  /** Vencimento real do titulo (pagamento a prazo/boleto). */
  dataVencimento?: string;
  /** Repasse previsto da administradora (cartao) -- e' a data em que o
   * dinheiro entra, nao a da venda. */
  dataPrevistaRecebimento?: string;
  createdAt?: any;
}

interface PedidoVendaData {
  id: string;
  clienteNome?: string;
  numeroPedido?: string;
  status: string;
  valorTotal: number;
  formaPagamento?: string;
  vendedorId?: string;
  vendedorNome?: string;
  usuarioResponsavelId?: string;
  criadoPor?: string;
  comissao?: {
    status?: string;
    valorAtual?: number;
    valorAtualCentavos?: number;
  };
  dataVenda?: string;
  createdAt?: any;
}

interface OrcamentoData {
  id: string;
  status: string;
  valorTotal: number;
  createdAt?: any;
}

interface EstoqueData {
  id: string;
  nome: string;
  quantidade: number;
  estoqueMinimo?: number;
  /** A importacao em massa grava o minimo so aqui dentro, nao no campo
   * de topo -- ver montarProdutoImportado (importacaoEstoqueDomain.ts). */
  estoqueConfig?: { minimo?: number };
  unidadeMedidaSigla?: string;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR');
const dataHoraCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: DEFAULT_TIME_ZONE,
});

/** Paleta do design novo (14/10/2026): violeta, azul, ambar, verde, rosa. */
const CORES_FORMAS_PAGAMENTO = ['#7c3aed', '#3b82f6', '#f59e0b', '#10b981', '#ec4899'];
const LINHAS_ULTIMOS_PEDIDOS = 6;

/** "DESENVOLVIMENTO" ou "maria clara" viram "Desenvolvimento" e "Maria" na saudacao. */
const primeiroNomeDe = (nome?: string | null): string => {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || '';
  return primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : '';
};

const saudacaoDaHora = (hora: number): string => (
  hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
);

const compactCurrency = (value: number) => {
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // virgula decimal (pt-BR): "R$ 1,5 mil", nunca "R$ 1.5 mil"
  if (absValue >= 1000000) return `${sign}R$ ${(absValue / 1000000).toFixed(1).replace('.', ',')} mi`;
  if (absValue >= 1000) return `${sign}R$ ${(absValue / 1000).toFixed(1).replace('.', ',')} mil`;
  return `${sign}R$ ${absValue.toFixed(0)}`;
};

const toDate = (value?: any): Date | null => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateInputToUtcStart(value);
    const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const transactionDate = (t: TransacaoData): Date | null => (
  toDate(t.dataPagamento) || toDate(t.data) || toDate(t.createdAt)
);

/**
 * Data em que o titulo VENCE -- usada so pra decidir se esta atrasado.
 * A precedencia vem de transactionDueDateInput (financeDomain), a MESMA
 * que ContasReceber usa: sem isso, parcela de cartao era marcada como
 * vencida no dia seguinte a venda, porque `data` guarda a data da VENDA e
 * o repasse real fica em dataPrevistaRecebimento (+30 dias, tipicamente),
 * e o numero do Dashboard nunca batia com o da tela de Contas a Receber.
 */
const transactionDueDate = (t: TransacaoData): Date | null => (
  toDate(transactionDueDateInput(t)) || toDate(t.createdAt)
);

const sameDay = (date: Date | null, base: Date) => (
  !!date &&
  getDateInputInTimeZone(date, DEFAULT_TIME_ZONE) ===
    getDateInputInTimeZone(base, DEFAULT_TIME_ZONE)
);

const isBeforeToday = (date: Date | null, today: Date) => {
  if (!date) return false;
  return getDateInputInTimeZone(date, DEFAULT_TIME_ZONE) <
    getDateInputInTimeZone(today, DEFAULT_TIME_ZONE);
};

const daysSince = (date: Date | null, today: Date) => {
  if (!date) return 0;
  return differenceInCalendarDays(
    getDateInputInTimeZone(date, DEFAULT_TIME_ZONE),
    getDateInputInTimeZone(today, DEFAULT_TIME_ZONE),
  ) || 0;
};

const clampPercentage = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

/**
 * Consulta limitada ao periodo (2026-09-30).
 *
 * OS, pedidos e orcamentos so' entram nas metricas quando a data cai no
 * periodo selecionado (hoje / semana / mes). Ate entao a assinatura trazia a
 * colecao INTEIRA da empresa e filtrava na tela: cada abertura do Dashboard
 * baixava o historico todo, e o custo (leituras, memoria, tempo de carga)
 * crescia com os anos de uso. Agora a consulta ja' vem limitada por
 * `createdAt`. Para pedidos ha' uma folga (MARGEM_DIAS_PEDIDOS): a data da
 * venda pode ser retroativa em relacao a criacao, nunca meses depois.
 * `transacoes` continua inteira de proposito -- a data que conta e' a do
 * pagamento, que pode ficar muito depois da criacao do titulo.
 *
 * Precisa do indice composto (tenantId, createdAt) de cada colecao
 * (firestore.indexes.json). Onde ele ainda nao foi publicado, o Firestore
 * responde `failed-precondition` e a tela cai na consulta antiga (colecao
 * inteira) avisando no console -- os numeros continuam certos, so' custam mais.
 */
const MARGEM_DIAS_PEDIDOS = 365;

type ColecaoDoPeriodo = 'ordens_de_servico' | 'pedidos_venda' | 'orcamentos';

const assinarColecaoDoPeriodo = (
  nome: ColecaoDoPeriodo,
  tenantId: string,
  inicio: Date,
  aoReceber: (snapshot: QuerySnapshot<DocumentData>) => void,
  aoFalhar: (erro: FirestoreError) => void,
): (() => void) => {
  const base = collection(db, nome);
  const completa = query(base, where('tenantId', '==', tenantId));
  const limitada = query(base, where('tenantId', '==', tenantId), where('createdAt', '>=', Timestamp.fromDate(inicio)));
  // Mesmo utilitario das outras listas (reserva ligada fora do callback de
  // erro do SDK -- ver services/consultaComReserva.ts).
  return assinarComReserva(limitada, completa, `Dashboard (${nome})`, aoReceber, aoFalhar);
};

const periodBucket = (date: Date, period: DashboardPeriod) => {
  const parts = getZonedParts(date, DEFAULT_TIME_ZONE);
  if (period === 'hoje') {
    return {
      key: `h-${parts.hour}`,
      name: `${String(parts.hour).padStart(2, '0')}h`,
      order: parts.hour,
    };
  }

  return {
    key: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    name: `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}`,
    order: Date.UTC(parts.year, parts.month - 1, parts.day),
  };
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { openTab } = useTabs();
  const [osList, setOsList] = useState<OSData[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [pedidos, setPedidos] = useState<PedidoVendaData[]>([]);
  const [orcamentos, setOrcamentos] = useState<OrcamentoData[]>([]);
  const [estoque, setEstoque] = useState<EstoqueData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriod>(() => {
    const saved = localStorage.getItem('nexus_dashboard_period');
    return saved === 'hoje' || saved === 'semana' || saved === 'mes' ? saved : 'hoje';
  });
  const [tableTab, setTableTab] = useState<'Ativas' | 'Finalizadas'>('Ativas');
  const [hideData, setHideData] = useState(() => localStorage.getItem('nexus_hide_dashboard') === 'true');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [openActionMenu, setOpenActionMenu] = useState<'top' | 'quick' | null>(null);
  /** Meta de faturamento do mes (Configuracoes). 0 = empresa nao trabalha
   * com meta -- o anel mostra o indicador de pipeline no lugar. */
  const [metaFaturamentoMensal, setMetaFaturamentoMensal] = useState(0);
  const [nomeEmpresaConfig, setNomeEmpresaConfig] = useState('');
  const topActionMenuRef = useRef<HTMLDivElement>(null);
  const quickActionMenuRef = useRef<HTMLDivElement>(null);

  const { currentUser, userPermissions, tenantId, isOwner, vendasVisiveisDeUsuarioId, userNome, selectedTenant } = useAuth();
  const isTabActive = useContext(TabActiveContext);
  const hasFinancialAccess = isOwner || userPermissions?.includes('dashboard.valores');

  // Inicio do periodo como NUMERO: o relogio (currentDate) muda a cada
  // segundo, mas este valor so' muda ao virar o dia ou trocar o periodo --
  // e' o que evita reassinar as consultas do Firestore a cada tique.
  const inicioDoPeriodoMs = useMemo(
    () => getDashboardPeriodRange(dashboardPeriod, currentDate, DEFAULT_TIME_ZONE).start.getTime(),
    [currentDate, dashboardPeriod],
  );

  const newActionOptions = [
    { label: 'Venda', detail: 'Novo pedido de venda', icon: ShoppingCart, route: '/pedidos-venda/novo' },
    { label: 'Cad. Cliente', detail: 'Cadastrar cliente', icon: Users, route: '/clientes/novo' },
    { label: 'OS', detail: 'Nova ordem de serviço', icon: Activity, route: '/os/nova' },
    { label: 'Orçamento', detail: 'Novo orçamento', icon: FileText, route: '/orcamentos/novo' }
  ];

  // O Dashboard fica sempre montado enquanto a aba existir (Sistema de
  // Abas, F19), mesmo escondida -- sem essa guarda, esse relogio re-
  // renderizaria o Dashboard inteiro (com todos os graficos) uma vez
  // por segundo pra sempre em segundo plano, mesmo com o usuario em
  // outra aba, roubando desempenho da tela inteira o tempo todo. So
  // conta o tempo enquanto a aba do Dashboard estiver realmente visivel.
  useEffect(() => {
    if (!isTabActive) return;
    setCurrentDate(new Date());
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, [isTabActive]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        topActionMenuRef.current?.contains(target) ||
        quickActionMenuRef.current?.contains(target)
      ) {
        return;
      }
      setOpenActionMenu(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!currentUser || !tenantId) return;

    setLoading(true);
    setLoadError('');
    const unsubscribes: Array<() => void> = [];
    let loadedSources = 0;
    const markLoaded = () => {
      loadedSources += 1;
      if (loadedSources >= (hasFinancialAccess ? 5 : 4)) setLoading(false);
    };

    const inicioDoPeriodo = new Date(inicioDoPeriodoMs);
    const inicioPedidos = new Date(inicioDoPeriodoMs - MARGEM_DIAS_PEDIDOS * 24 * 60 * 60 * 1000);

    unsubscribes.push(assinarColecaoDoPeriodo(
      'ordens_de_servico',
      tenantId,
      inicioDoPeriodo,
      (snapshot) => {
        const data: OSData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as OSData));
        data.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        setOsList(data);
        markLoaded();
      },
      (error) => {
        console.error('Erro ao carregar ordens da dashboard:', error);
        setLoadError('Não foi possível carregar todos os indicadores da dashboard.');
        markLoaded();
      }
    ));

    unsubscribes.push(assinarColecaoDoPeriodo(
      'pedidos_venda',
      tenantId,
      inicioPedidos,
      (snapshot) => {
        const data: PedidoVendaData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as PedidoVendaData));
        data.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        // Faturamento, ranking e ticket medio da dashboard passam a contar
        // so as vendas que este usuario pode ver -- ver
        // src/utils/visibilidadeVendasDomain.ts.
        setPedidos(filtrarVendasVisiveis(data, vendasVisiveisDeUsuarioId));
        markLoaded();
      },
      (error) => {
        console.error('Erro ao carregar vendas da dashboard:', error);
        setLoadError('Não foi possível carregar todos os indicadores da dashboard.');
        markLoaded();
      }
    ));

    unsubscribes.push(assinarColecaoDoPeriodo(
      'orcamentos',
      tenantId,
      inicioDoPeriodo,
      (snapshot) => {
        const data: OrcamentoData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as OrcamentoData));
        setOrcamentos(data);
        markLoaded();
      },
      (error) => {
        console.error('Erro ao carregar orçamentos da dashboard:', error);
        setLoadError('Não foi possível carregar todos os indicadores da dashboard.');
        markLoaded();
      }
    ));

    unsubscribes.push(onSnapshot(
      query(collection(db, 'estoque'), where('tenantId', '==', tenantId)),
      (snapshot) => {
        const data: EstoqueData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as EstoqueData));
        setEstoque(data);
        markLoaded();
      },
      (error) => {
        console.error('Erro ao carregar estoque da dashboard:', error);
        setLoadError('Não foi possível carregar todos os indicadores da dashboard.');
        markLoaded();
      }
    ));

    if (hasFinancialAccess) {
      unsubscribes.push(onSnapshot(
        doc(db, 'configuracoes', tenantId),
        (snap) => {
          setMetaFaturamentoMensal(parseMetaFaturamentoMensal(snap.data()?.metaFaturamentoMensal));
          // Mesmo documento: o nome da empresa vai no subtitulo da saudacao.
          setNomeEmpresaConfig(String(snap.data()?.nomeOficina || '').trim());
        },
        (error) => console.error('Erro ao carregar a meta de faturamento:', error),
      ));

      unsubscribes.push(onSnapshot(
        query(collection(db, 'transacoes'), where('tenantId', '==', tenantId)),
        (snapshot) => {
          const data: TransacaoData[] = [];
          snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as TransacaoData));
          setTransacoes(data);
          markLoaded();
        },
        (error) => {
          console.error('Erro ao carregar financeiro da dashboard:', error);
          setLoadError('Não foi possível carregar os indicadores financeiros.');
          markLoaded();
        }
      ));
    }

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [currentUser, tenantId, hasFinancialAccess, vendasVisiveisDeUsuarioId, inicioDoPeriodoMs]);

  const toggleHideData = () => {
    const newVal = !hideData;
    setHideData(newVal);
    localStorage.setItem('nexus_hide_dashboard', String(newVal));
  };

  const selectDashboardPeriod = (period: DashboardPeriod) => {
    setDashboardPeriod(period);
    localStorage.setItem('nexus_dashboard_period', period);
  };

  const selectedPeriodRange = useMemo(
    () => getDashboardPeriodRange(dashboardPeriod, currentDate, DEFAULT_TIME_ZONE),
    [currentDate, dashboardPeriod],
  );

  // A meta e' MENSAL, entao o progresso dela sempre olha o mes corrente --
  // independente do filtro de periodo. Sem isso, com o filtro em "hoje" a
  // meta do mes apareceria como quase 0% todo dia de manha.
  const currentMonthRange = useMemo(
    () => getDashboardPeriodRange('mes', currentDate, DEFAULT_TIME_ZONE),
    [currentDate],
  );

  const faturamentoMesCalendario = useMemo(() => {
    const pagasNoMes = transacoes.filter((t) => (
      t.status === 'Paga' && isWithinDateRange(transactionDate(t), currentMonthRange.start, currentMonthRange.end)
    ));
    // Venda/OS cancelada some da receita; so' devolucao abate; nunca negativa (19/10/2026).
    return fromCents(receitaDoConjuntoCentavos(pagasNoMes));
  }, [currentMonthRange, transacoes]);

  const metrics = useMemo(() => {
    const hoje = currentDate;

    const osMesAtual = osList.filter((os) => isWithinDateRange(toDate(os.createdAt), selectedPeriodRange.start, selectedPeriodRange.end));
    const osAtivas = osMesAtual.filter((os) => os.status !== 'Finalizada' && os.status !== 'Cancelada');
    const osFinalizadas = osMesAtual.filter((os) => os.status === 'Finalizada');
    const osFinalizadasMes = osMesAtual.filter((os) => os.status === 'Finalizada');
    const osParadas = osAtivas.filter((os) => daysSince(toDate(os.createdAt), hoje) >= 3);
    const ticketMedioOS = osFinalizadasMes.length
      ? osFinalizadasMes.reduce((acc, os) => acc + Number(os.valorTotal || os.total || 0), 0) / osFinalizadasMes.length
      : 0;

    // Pedido em aberto (pre-venda / pedido do agente) nao e' venda: nao
    // gerou financeiro e nao pode inflar o valor vendido no periodo.
    const vendasMes = pedidos.filter((p) => contaComoFaturamento(p.status) && isWithinDateRange(toDate(p.dataVenda) || toDate(p.createdAt), selectedPeriodRange.start, selectedPeriodRange.end));
    const vendasHoje = vendasMes.filter((p) => sameDay(toDate(p.dataVenda) || toDate(p.createdAt), hoje));
    const valorVendasMes = vendasMes.reduce((acc, p) => acc + Number(p.valorTotal || 0), 0);

    // Clientes atendidos = quem comprou + quem abriu OS. Antes saia so das
    // ordens de servico, entao loja de varejo (que quase nao abre OS)
    // mostrava zero mesmo com dezenas de vendas no periodo.
    //
    // "Consumidor Final" nao entra no conjunto de nomes: 200 vendas de
    // balcao viram 200 pessoas diferentes atendidas, nao 1 cliente
    // chamado "Consumidor Final". Por isso cada venda anonima conta como
    // um atendimento proprio.
    const ehConsumidorFinalNome = (nome?: string) => (
      (nome || '').trim().toUpperCase() === 'CONSUMIDOR FINAL'
    );
    const nomesIdentificados = new Set<string>();
    let atendimentosAnonimos = 0;
    [
      ...osMesAtual.map((os) => os.clienteNome),
      ...vendasMes.map((venda) => venda.clienteNome),
    ].forEach((nome) => {
      const limpo = (nome || '').trim().toUpperCase();
      if (!limpo) return;
      if (ehConsumidorFinalNome(limpo)) atendimentosAnonimos += 1;
      else nomesIdentificados.add(limpo);
    });
    const clientesUnicosMes = nomesIdentificados.size + atendimentosAnonimos;

    const orcamentosMes = orcamentos.filter((o) => isWithinDateRange(toDate(o.createdAt), selectedPeriodRange.start, selectedPeriodRange.end));
    const orcamentosConvertidos = orcamentosMes.filter((o) => ['Finalizado', 'Convertido'].includes(o.status)).length;
    const taxaConversaoOrcamentos = orcamentosMes.length ? (orcamentosConvertidos / orcamentosMes.length) * 100 : 0;
    const valorOrcamentosPendentes = orcamentosMes
      .filter((o) => ['Pendente', 'Aprovado'].includes(o.status))
      .reduce((acc, o) => acc + Number(o.valorTotal || 0), 0);

    const transacoesPagasMes = transacoes.filter((t) => (
      t.status === 'Paga' && isWithinDateRange(transactionDate(t), selectedPeriodRange.start, selectedPeriodRange.end)
    ));
    // Estorno (OS/venda cancelada, devolucao) nao e' despesa. Desde 19/10/2026
    // (decisao do dono) venda/OS cancelada SOME da receita -- o estorno do
    // cancelamento nao conta --, so' a devolucao abate, e a receita nunca fica
    // negativa. Ver receitaDoConjuntoCentavos (financeDomain.ts).
    const faturamentoMes = fromCents(receitaDoConjuntoCentavos(transacoesPagasMes));
    const faturamentoHoje = fromCents(receitaDoConjuntoCentavos(
      transacoesPagasMes.filter((t) => sameDay(transactionDate(t), hoje)),
    ));
    const despesasMes = transacoesPagasMes
      .filter((t) => t.tipo === 'saida' && !isRevenueReversal(t))
      .reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
    // Continua identico ao valor antigo: o que saiu da receita entrou de volta
    // ao sair da despesa. So as duas parcelas ficaram honestas.
    const lucroLiquidoMes = faturamentoMes - despesasMes;
    const contasReceberPeriodo = transacoes.filter((t) => (
      t.tipo === 'entrada' &&
      t.status === 'Pendente' &&
      isWithinDateRange(transactionDate(t), selectedPeriodRange.start, selectedPeriodRange.end)
    ));
    const valorContasReceberPeriodo = contasReceberPeriodo
      .reduce((sum, transaction) => sum + transactionNetAmount(transaction), 0);
    const comissoesPeriodo = vendasMes
      .filter((sale) => sale.comissao?.status === 'gerada')
      .reduce((sum, sale) => (
        sum + Number(
          sale.comissao?.valorAtualCentavos !== undefined
            ? sale.comissao.valorAtualCentavos / 100
            : sale.comissao?.valorAtual || 0,
        )
      ), 0);
    const sellerCounts = new Map<string, { name: string; count: number }>();
    vendasMes.forEach((sale) => {
      const sellerId = sale.vendedorId || sale.usuarioResponsavelId || 'nao_identificado';
      const current = sellerCounts.get(sellerId) || {
        name: sale.vendedorNome || 'Não identificado',
        count: 0,
      };
      current.count += 1;
      sellerCounts.set(sellerId, current);
    });
    const topSeller = Array.from(sellerCounts.values())
      .sort((left, right) => right.count - left.count)[0] || null;
    const contasReceberVencidas = transacoes.filter((t) => (
      t.tipo === 'entrada' && t.status === 'Pendente' && isBeforeToday(transactionDueDate(t), hoje)
    ));
    const contasPagarVencidas = transacoes.filter((t) => (
      t.tipo === 'saida' && t.status === 'Pendente' && isBeforeToday(transactionDueDate(t), hoje)
    ));

    // Alerta de estoque baixo so existe pra produto com minimo REALMENTE
    // cadastrado. Antes, produto sem minimo caia num default 5 inventado
    // aqui -- e produto importado de planilha nunca traz esse campo, entao
    // todo item com 5 unidades ou menos aparecia como "abaixo do minimo"
    // sem ninguem ter definido nada. Produto zerado continua coberto por
    // itensEsgotados, que e' o sinal que nao depende de configuracao.
    // Le os dois lugares onde o minimo e' gravado (EstoqueForm grava nos
    // dois; a importacao em massa so' no estoqueConfig).
    const itensEstoqueBaixo = estoque.filter((item) => {
      const qtd = Number(item.quantidade || 0);
      const minimo = Number(item.estoqueMinimo ?? item.estoqueConfig?.minimo ?? 0);
      return minimo > 0 && qtd <= minimo;
    });
    const itensEsgotados = estoque.filter((item) => Number(item.quantidade || 0) <= 0);

    return {
      clientesUnicosMes,
      contasPagarVencidas,
      contasReceberPeriodo,
      contasReceberVencidas,
      comissoesPeriodo,
      despesasMes,
      faturamentoHoje,
      faturamentoMes,
      itensEsgotados,
      itensEstoqueBaixo,
      lucroLiquidoMes,
      orcamentosConvertidos,
      orcamentosMes,
      osAtivas,
      osFinalizadas,
      osFinalizadasMes,
      osParadas,
      taxaConversaoOrcamentos,
      ticketMedioOS,
      topSeller,
      valorContasReceberPeriodo,
      valorOrcamentosPendentes,
      valorVendasMes,
      vendasHoje,
      vendasMes
    };
  }, [currentDate, estoque, orcamentos, osList, pedidos, selectedPeriodRange, transacoes]);

  const cashFlowData = useMemo(() => {
    const buckets = new Map<string, { name: string; order: number; entradas: number; saidas: number; saldo: number; lancamentos: TransacaoDeReceita[] }>();
    transacoes
      .filter((transaction) => transaction.status === 'Paga' && isWithinDateRange(transactionDate(transaction), selectedPeriodRange.start, selectedPeriodRange.end))
      .forEach((transaction) => {
        const date = transactionDate(transaction);
        if (!date) return;
        const bucket = periodBucket(date, dashboardPeriod);
        const current = buckets.get(bucket.key) || { name: bucket.name, order: bucket.order, entradas: 0, saidas: 0, saldo: 0, lancamentos: [] };
        // Mesmo criterio do bloco de metricas: estorno nao e' despesa, e as
        // entradas de cada ponto sao a receita dele (nunca negativa).
        current.lancamentos.push(transaction);
        if (transaction.tipo === 'saida' && !isRevenueReversal(transaction)) {
          current.saidas += transactionNetAmount(transaction);
        }
        buckets.set(bucket.key, current);
      });
    return Array.from(buckets.values())
      .map(({ lancamentos, ...ponto }) => {
        const entradas = fromCents(receitaDoConjuntoCentavos(lancamentos));
        return { ...ponto, entradas, saldo: entradas - ponto.saidas };
      })
      .sort((a, b) => a.order - b.order);
  }, [dashboardPeriod, selectedPeriodRange, transacoes]);

  const performanceData = useMemo(() => {
    const buckets = new Map<string, { name: string; order: number; receita: number; os: number; finalizadas: number; pedidos: number }>();
    const ensureBucket = (date: Date) => {
      const bucket = periodBucket(date, dashboardPeriod);
      const current = buckets.get(bucket.key) || { name: bucket.name, order: bucket.order, receita: 0, os: 0, finalizadas: 0, pedidos: 0 };
      buckets.set(bucket.key, current);
      return current;
    };

    osList.forEach((serviceOrder) => {
      const date = toDate(serviceOrder.createdAt);
      if (!isWithinDateRange(date, selectedPeriodRange.start, selectedPeriodRange.end) || !date) return;
      const bucket = ensureBucket(date);
      bucket.os += 1;
      if (serviceOrder.status === 'Finalizada') bucket.finalizadas += 1;
    });
    pedidos.forEach((sale) => {
      const date = toDate(sale.dataVenda) || toDate(sale.createdAt);
      // Mesma regra do valor vendido: o grafico conta venda, nao pedido aberto.
      if (!contaComoFaturamento(sale.status) || !isWithinDateRange(date, selectedPeriodRange.start, selectedPeriodRange.end) || !date) return;
      ensureBucket(date).pedidos += 1;
    });
    // Receita de cada ponto: venda/OS cancelada some, devolucao abate, nunca negativa.
    const lancamentosPorPonto = new Map<ReturnType<typeof ensureBucket>, TransacaoDeReceita[]>();
    transacoes.forEach((transaction) => {
      const date = transactionDate(transaction);
      if (
        transaction.status !== 'Paga' ||
        !isWithinDateRange(date, selectedPeriodRange.start, selectedPeriodRange.end) ||
        !date
      ) return;
      const ponto = ensureBucket(date);
      lancamentosPorPonto.set(ponto, [...(lancamentosPorPonto.get(ponto) || []), transaction]);
    });
    lancamentosPorPonto.forEach((lancamentos, ponto) => {
      ponto.receita = fromCents(receitaDoConjuntoCentavos(lancamentos));
    });

    return Array.from(buckets.values()).sort((a, b) => a.order - b.order);
  }, [dashboardPeriod, osList, pedidos, selectedPeriodRange, transacoes]);

  const osStatusData = useMemo(() => {
    const contagemStatus: Record<string, { value: number; color: string }> = {};
    metrics.osAtivas.forEach((os) => {
      if (!contagemStatus[os.status]) {
        contagemStatus[os.status] = { value: 0, color: os.statusColor || '#7c3aed' };
      }
      contagemStatus[os.status].value += 1;
    });
    return Object.keys(contagemStatus).map((status) => ({
      name: status,
      value: contagemStatus[status].value,
      color: contagemStatus[status].color
    }));
  }, [metrics.osAtivas]);

  const paymentData = useMemo(() => {
    const map: Record<string, number> = {};
    transacoes
      .filter((t) => (
        // Venda/OS cancelada nao entra (19/10/2026): mesma regra da receita.
        contaComoReceita(t) &&
        isWithinDateRange(transactionDate(t), selectedPeriodRange.start, selectedPeriodRange.end)
      ))
      .forEach((t) => {
        const name = t.formaPagamento || 'Não informada';
        map[name] = (map[name] || 0) + transactionNetAmount(t);
      });
    // A forma que mais recebeu vem primeiro e fica com o violeta, como nas previas.
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .map(([name, value], index) => ({
        name,
        value,
        color: CORES_FORMAS_PAGAMENTO[index % CORES_FORMAS_PAGAMENTO.length]
      }));
  }, [selectedPeriodRange, transacoes]);

  const maskedMoney = 'R$ •••••';
  const maskedNumber = '•••';

  const formatMoney = (value: number) => hideData ? maskedMoney : currencyFormatter.format(value);
  const formatNumber = (value: number) => hideData ? maskedNumber : numberFormatter.format(value);

  const formattedDate = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(currentDate);

  const formattedTime = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(currentDate);

  const mainMetricKey = hasFinancialAccess ? 'receita' : 'os';
  const selectedPeriodLabel = dashboardPeriod === 'hoje' ? 'hoje' : dashboardPeriod === 'semana' ? 'nesta semana' : 'neste mês';
  const mainMetricLabel = hasFinancialAccess ? 'Receita líquida' : 'OS abertas';
  const mainMetricValue = hasFinancialAccess ? formatMoney(metrics.faturamentoMes) : formatNumber(metrics.osAtivas.length);
  const mainMetricCaption = hasFinancialAccess ? `Receita paga após taxas ${selectedPeriodLabel}` : `Ordens no período (${selectedPeriodLabel})`;
  const osCompletionRate = clampPercentage(
    (metrics.osFinalizadasMes.length / Math.max(metrics.osFinalizadasMes.length + metrics.osAtivas.length, 1)) * 100
  );
  const approvalRate = clampPercentage(metrics.taxaConversaoOrcamentos);
  // Indicador de pipeline: quanto da oportunidade do periodo ja virou
  // dinheiro (receita paga sobre receita paga + orcamentos em aberto).
  // E' o que aparece quando a empresa NAO cadastrou meta -- antes esta
  // mesma conta vinha rotulada como "Meta mensal", o que era falso.
  const oportunidadeTotal = metrics.faturamentoMes + metrics.valorOrcamentosPendentes;
  const pipelineRealizadoRate = hasFinancialAccess
    ? (oportunidadeTotal > 0
      ? clampPercentage((metrics.faturamentoMes / oportunidadeTotal) * 100)
      : 0)
    : osCompletionRate;

  // Meta cadastrada em Configuracoes -> Financeiro. progressoMeta null =
  // nao ha meta, e o anel cai no indicador de pipeline.
  const progressoMeta = hasFinancialAccess
    ? calcularProgressoMeta(faturamentoMesCalendario, metaFaturamentoMensal)
    : null;
  const restanteMeta = faltaParaMeta(faturamentoMesCalendario, metaFaturamentoMensal);
  const metaBatida = progressoMeta !== null && progressoMeta >= 100;

  // ---------- design novo (14/10/2026): o topo e os blocos das previas aprovadas ----------
  const saudacao = saudacaoDaHora(getZonedParts(currentDate, DEFAULT_TIME_ZONE).hour);
  const primeiroNome = primeiroNomeDe(userNome);
  const nomeEmpresa = String(selectedTenant?.nomeOficina || '').trim() || nomeEmpresaConfig;
  const periodoComMaiuscula = selectedPeriodLabel[0].toUpperCase() + selectedPeriodLabel.slice(1);
  const pedidosEmAberto = pedidos.filter((pedido) => isPedidoAberto(pedido.status)).length;
  const valorVencidoReceber = metrics.contasReceberVencidas.reduce((soma, t) => soma + transactionNetAmount(t), 0);
  const ultimosPedidos = pedidos.slice(0, LINHAS_ULTIMOS_PEDIDOS);
  const totalRecebidoFormas = paymentData.reduce((soma, forma) => soma + forma.value, 0);

  type CartaoIndicador = {
    rotulo: string;
    valor: string;
    icone: typeof Activity;
    chip: string;
    tom: TomChip;
    texto: string;
  };
  const cartoesIndicadores: CartaoIndicador[] = [
    hasFinancialAccess
      ? {
        rotulo: `Receita ${selectedPeriodLabel}`,
        valor: formatMoney(metrics.faturamentoMes),
        icone: DollarSign,
        chip: progressoMeta !== null ? `${progressoMeta}% da meta` : `${formatMoney(metrics.faturamentoHoje)} hoje`,
        tom: progressoMeta !== null && metaBatida ? 'verde' : 'violeta',
        texto: progressoMeta !== null ? 'do mês' : 'já descontadas as taxas',
      }
      : {
        rotulo: 'Clientes atendidos',
        valor: formatNumber(metrics.clientesUnicosMes),
        icone: Users,
        chip: `${approvalRate}% conversão`,
        tom: 'violeta',
        texto: 'dos orçamentos',
      },
    {
      rotulo: `Pedidos ${selectedPeriodLabel}`,
      valor: formatNumber(metrics.vendasMes.length),
      icone: ShoppingCart,
      chip: `${formatNumber(pedidosEmAberto)} em aberto`,
      tom: tomDoContador(pedidosEmAberto, 'azul'),
      texto: `${formatNumber(metrics.vendasHoje.length)} faturados hoje`,
    },
    hasFinancialAccess
      ? {
        rotulo: `A receber ${selectedPeriodLabel}`,
        valor: formatMoney(metrics.valorContasReceberPeriodo),
        icone: Wallet,
        chip: metrics.contasReceberVencidas.length
          ? `${formatNumber(metrics.contasReceberVencidas.length)} vencidos`
          : 'Nada vencido',
        tom: metrics.contasReceberVencidas.length ? 'verm' : 'verde',
        texto: metrics.contasReceberVencidas.length ? formatMoney(valorVencidoReceber) : 'em dia',
      }
      : {
        rotulo: `Orçamentos ${selectedPeriodLabel}`,
        valor: formatNumber(metrics.orcamentosMes.length),
        icone: FileText,
        chip: `${formatNumber(metrics.orcamentosConvertidos)} convertidos`,
        tom: tomDoContador(metrics.orcamentosConvertidos, 'verde'),
        texto: `${approvalRate}% de aprovação`,
      },
    {
      rotulo: 'OS em andamento',
      valor: formatNumber(metrics.osAtivas.length),
      icone: Wrench,
      chip: metrics.osParadas.length ? `${formatNumber(metrics.osParadas.length)} paradas` : 'Nenhuma parada',
      tom: metrics.osParadas.length ? 'ambar' : 'verde',
      texto: `${formatNumber(metrics.osFinalizadasMes.length)} finalizadas`,
    },
  ];

  const quickMetrics = [
    {
      label: hasFinancialAccess ? 'Entradas líquidas no período' : 'Vendas no período',
      value: hasFinancialAccess ? formatMoney(metrics.faturamentoMes) : formatNumber(metrics.vendasMes.length)
    },
    {
      label: 'Entregas',
      value: formatNumber(metrics.osFinalizadasMes.length)
    },
    {
      label: 'Orçamentos',
      value: formatNumber(metrics.orcamentosMes.length)
    },
    {
      label: 'Atrasos',
      value: formatNumber(metrics.osParadas.length)
    },
    ...(hasFinancialAccess ? [
      {
        label: 'A receber no período',
        value: formatMoney(metrics.valorContasReceberPeriodo)
      },
      {
        label: 'Comissões registradas',
        value: formatMoney(metrics.comissoesPeriodo)
      }
    ] : []),
    {
      label: 'Vendedor destaque',
      value: metrics.topSeller
        ? `${metrics.topSeller.name} (${formatNumber(metrics.topSeller.count)})`
        : '-'
    }
  ];

  const healthItems = [
    { label: 'Conclusão de OS', value: `${osCompletionRate}%`, progress: osCompletionRate, color: '#7c3aed', hint: '' },
    { label: 'Orçamentos aprovados', value: `${approvalRate}%`, progress: approvalRate, color: '#3b82f6', hint: '' },
    // Com meta cadastrada, o anel vira a meta do mes. O valor pode passar
    // de 100% (bateu e superou); a barra e' que fica limitada a 100.
    progressoMeta !== null
      ? {
        label: 'Meta do mês',
        value: `${progressoMeta}%`,
        progress: clampPercentage(progressoMeta),
        color: metaBatida ? '#10b981' : '#f59e0b',
        hint: metaBatida
          ? `Meta de ${formatMoney(metaFaturamentoMensal)} batida`
          : `Faltam ${formatMoney(restanteMeta)} de ${formatMoney(metaFaturamentoMensal)}`,
      }
      : {
        label: hasFinancialAccess ? 'Receita já realizada vs. em aberto' : 'Ritmo operacional',
        value: `${pipelineRealizadoRate}%`,
        progress: pipelineRealizadoRate,
        color: '#f59e0b',
        hint: '',
      }
  ];

  // Fila operacional: o que pede acao agora, com a quantidade num chip (zerado fica cinza).
  const orcamentosParaConverter = Math.max(metrics.orcamentosMes.length - metrics.orcamentosConvertidos, 0);
  const criticalTasks = [
    {
      title: 'Pré-vendas em aberto',
      count: pedidosEmAberto,
      icon: ClipboardList,
      route: '/pre-vendas',
      tone: 'violeta' as TomChip,
      visible: true
    },
    {
      title: 'Contas a receber vencidas',
      count: metrics.contasReceberVencidas.length,
      icon: AlertTriangle,
      route: '/financeiro/contas-receber',
      tone: 'verm' as TomChip,
      visible: hasFinancialAccess
    },
    {
      title: 'Estoque abaixo do mínimo',
      count: metrics.itensEstoqueBaixo.length,
      icon: Package,
      route: '/estoque',
      tone: 'ambar' as TomChip,
      visible: true
    },
    {
      title: 'Produtos esgotados',
      count: metrics.itensEsgotados.length,
      icon: PackageX,
      route: '/estoque',
      tone: 'verm' as TomChip,
      visible: true
    },
    {
      title: 'OS paradas há 3+ dias',
      count: metrics.osParadas.length,
      icon: Clock,
      route: '/os',
      tone: 'ambar' as TomChip,
      visible: true
    },
    {
      title: 'Orçamentos para converter',
      count: orcamentosParaConverter,
      icon: FileText,
      route: '/orcamentos',
      tone: 'azul' as TomChip,
      visible: true
    }
  ].filter((item) => item.visible);

  const tableRows = (tableTab === 'Ativas' ? metrics.osAtivas : metrics.osFinalizadas).slice(0, 5);

  const renderNewActionMenu = (menuId: 'top' | 'quick', className: string) => (
    <div
      className="dashboard-action-menu"
      ref={menuId === 'top' ? topActionMenuRef : quickActionMenuRef}
    >
      <button
        type="button"
        className={className}
        onClick={() => setOpenActionMenu(openActionMenu === menuId ? null : menuId)}
        aria-haspopup="menu"
        aria-expanded={openActionMenu === menuId}
      >
        <Plus size={18} />
        Nova Ação
        <ChevronDown size={16} />
      </button>

      {openActionMenu === menuId && (
        <div className="dashboard-action-dropdown" role="menu">
          {newActionOptions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.route}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenActionMenu(null);
                  navigate(action.route);
                }}
              >
                <span className="dashboard-action-option-icon">
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="dashboard dashboard-model-two">
      {loadError && (
        <div role="alert" style={{ padding: '12px 16px', borderRadius: '8px', color: '#fecaca', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
          {loadError}
        </div>
      )}
      <header className="dashboard-topline">
        <div>
          <h1 className="page-title">{primeiroNome ? `${saudacao}, ${primeiroNome}` : saudacao}</h1>
          <p className="page-subtitle">{[nomeEmpresa, formattedDate].filter(Boolean).join(' · ')}</p>
        </div>

        <div className="dashboard-actions">
          <div className="dashboard-clock">
            <strong>{formattedTime}</strong>
            <Clock size={18} />
          </div>
          <button
            className="icon-btn dashboard-icon-action"
            onClick={toggleHideData}
            title={hideData ? 'Mostrar valores' : 'Ocultar valores'}
          >
            {hideData ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          {renderNewActionMenu('top', 'btn-primary dashboard-primary-action')}
        </div>
      </header>

      <section className="dash-indicadores">
        {cartoesIndicadores.map((cartao) => {
          const Icone = cartao.icone;
          return (
            <article key={cartao.rotulo} className="card dash-indicador">
              <div className="dash-indicador__topo">
                <span className="hd-rotulo">{cartao.rotulo}</span>
                <span className="hd-circ"><Icone /></span>
              </div>
              <strong className="dash-indicador__valor">{cartao.valor}</strong>
              <div className="dash-indicador__rodape">
                <span className={`hd-chip ${cartao.tom}`}>{cartao.chip}</span>
                <span>{cartao.texto}</span>
              </div>
            </article>
          );
        })}
      </section>

      <section className="dash-linha">
        <article className="card dash-grafico">
          <div className="dash-cab">
            <div>
              <h3>{hasFinancialAccess ? `Receita ${selectedPeriodLabel}` : `Ordens de serviço ${selectedPeriodLabel}`}</h3>
              <p>{mainMetricValue} · {mainMetricCaption.toLowerCase()}</p>
            </div>
            <div className="dash-chips" role="group" aria-label="Período do painel">
              {([['hoje', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês']] as const).map(([periodo, rotulo]) => (
                <button
                  key={periodo}
                  type="button"
                  className={`hd-chip ${dashboardPeriod === periodo ? 'violeta' : ''}`}
                  aria-pressed={dashboardPeriod === periodo}
                  onClick={() => selectDashboardPeriod(periodo)}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          <div
            className="dash-grafico__area"
            style={{
              filter: hideData && hasFinancialAccess ? 'blur(7px)' : 'none',
              pointerEvents: hideData && hasFinancialAccess ? 'none' : 'auto',
              userSelect: hideData && hasFinancialAccess ? 'none' : 'auto'
            }}
          >
            {performanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={performanceData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardAreaVioleta" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 6" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600 }} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11 }}
                    width={hasFinancialAccess ? 72 : 34}
                    tickFormatter={(value) => hasFinancialAccess ? compactCurrency(Number(value)) : numberFormatter.format(Number(value))}
                  />
                  <Tooltip
                    formatter={(value) => {
                      const numero = Number(value || 0);
                      if (!hasFinancialAccess) return numberFormatter.format(numero);
                      return hideData ? maskedMoney : currencyFormatter.format(numero);
                    }}
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: 'var(--shadow-card)' }}
                    itemStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                    labelStyle={{ color: 'var(--text-muted)' }}
                  />
                  <Area
                    type="monotone"
                    dataKey={mainMetricKey}
                    name={mainMetricLabel}
                    stroke="#7c3aed"
                    strokeWidth={3.5}
                    fill="url(#dashboardAreaVioleta)"
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff', fill: '#7c3aed' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">{loading ? 'Carregando dados...' : `Nada registrado ${selectedPeriodLabel} ainda.`}</div>
            )}
          </div>
        </article>

        <article className="card dash-fila">
          <div className="dash-cab">
            <h3>Fila operacional</h3>
          </div>
          <div className="dash-fila__lista">
            {criticalTasks.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.title} type="button" className="dash-fila__item" onClick={() => navigate(item.route)}>
                  <span className="hd-quad"><Icon /></span>
                  <span className="dash-fila__texto">{item.title}</span>
                  <span className={`hd-chip ${tomDoContador(item.count, item.tone)}`}>{formatNumber(item.count)}</span>
                </button>
              );
            })}
          </div>
        </article>
      </section>

      <section className="dash-linha">
        <article className="card dash-pedidos">
          <div className="dash-cab">
            <h3>Últimos pedidos</h3>
            <button type="button" className="hd-link" onClick={() => navigate('/pedidos-venda')}>Ver todos</button>
          </div>
          <div className="table-wrapper">
            <table className="dash-tabela">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Cliente</th>
                  <th className="dash-tabela__vendedor">Vendedor</th>
                  <th>Status</th>
                  {hasFinancialAccess && <th className="dash-tabela__num">Total</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={hasFinancialAccess ? 5 : 4} className="dash-tabela__vazio">Carregando dados...</td></tr>
                ) : ultimosPedidos.length === 0 ? (
                  <tr><td colSpan={hasFinancialAccess ? 5 : 4} className="dash-tabela__vazio">Nenhum pedido de venda ainda.</td></tr>
                ) : (
                  ultimosPedidos.map((pedido) => {
                    const quando = toDate(pedido.createdAt) || toDate(pedido.dataVenda);
                    const titulo = pedido.numeroPedido ? `Pedido #${pedido.numeroPedido}` : 'Pedido';
                    return (
                      <tr
                        key={pedido.id}
                        className="clickable-row"
                        onClick={() => openTab(`/pedidos-venda/visualizar/${pedido.id}`, titulo)}
                        title={`Abrir ${titulo.toLowerCase()}`}
                      >
                        <td className="dash-tabela__numero">{pedido.numeroPedido ? `#${pedido.numeroPedido}` : '—'}</td>
                        <td className="dash-tabela__cliente">
                          <div className="hd-pessoa">
                            <AvatarIniciais nome={pedido.clienteNome} />
                            <div>
                              <strong>{pedido.clienteNome || 'Cliente não informado'}</strong>
                              {quando && <small>{dataHoraCurta.format(quando)}</small>}
                            </div>
                          </div>
                        </td>
                        <td className="dash-tabela__mudo dash-tabela__vendedor">{pedido.vendedorNome || '—'}</td>
                        <td><span className={`hd-chip ${tomDoStatusPedido(pedido.status)}`}>{pedido.status || 'Sem status'}</span></td>
                        {hasFinancialAccess && (
                          <td className="dash-tabela__num">{formatMoney(Number(pedido.valorTotal || 0))}</td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>

        {hasFinancialAccess ? (
          <article className="card dash-rosca">
            <div className="dash-cab">
              <h3>Formas de pagamento</h3>
              <span className="hd-rotulo">{periodoComMaiuscula}</span>
            </div>
            {paymentData.length > 0 ? (
              <div className="dash-rosca__corpo">
                <div className="dash-rosca__grafico">
                  <ResponsiveContainer width="100%" height="100%">
                    {/* Sem animacao: o relogio re-renderiza o painel a cada segundo e a
                        rosca recomecava do zero, ficando so' com uma lasca desenhada. */}
                    <PieChart>
                      <Pie data={paymentData} innerRadius={56} outerRadius={78} paddingAngle={2} dataKey="value" stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
                        {paymentData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="dash-rosca__centro">
                    <strong>{hideData ? maskedMoney : compactCurrency(totalRecebidoFormas)}</strong>
                    <span>recebido</span>
                  </div>
                </div>
                <ul className="dash-rosca__legenda">
                  {paymentData.map((item) => (
                    <li key={item.name}>
                      <span className="dash-rosca__cor" style={{ backgroundColor: item.color }} />
                      <span className="dash-rosca__nome">{item.name}</span>
                      <strong>{totalRecebidoFormas > 0 ? `${Math.round((item.value / totalRecebidoFormas) * 100)}%` : '—'}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="chart-empty dash-rosca__vazio">Nenhum recebimento {selectedPeriodLabel}.</div>
            )}
          </article>
        ) : (
          <article className="card dash-rosca">
            <div className="dash-cab">
              <h3>Status de OS</h3>
              <button type="button" className="hd-link" onClick={() => navigate('/os')}>Ver OS</button>
            </div>
            {osStatusData.length > 0 ? (
              <div className="dash-rosca__corpo">
                <div className="dash-rosca__grafico">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={osStatusData} innerRadius={56} outerRadius={78} paddingAngle={2} dataKey="value" stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
                        {osStatusData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="dash-rosca__centro">
                    <strong>{formatNumber(metrics.osAtivas.length)}</strong>
                    <span>em andamento</span>
                  </div>
                </div>
                <ul className="dash-rosca__legenda">
                  {osStatusData.map((item) => (
                    <li key={item.name}>
                      <span className="dash-rosca__cor" style={{ backgroundColor: item.color }} />
                      <span className="dash-rosca__nome">{item.name}</span>
                      <strong>{formatNumber(item.value)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="chart-empty dash-rosca__vazio">Nenhuma OS em andamento.</div>
            )}
          </article>
        )}
      </section>

      <section className="dashboard-detail-grid">
        <article className="card dashboard-pipeline-card">
          <div className="dashboard-card-heading compact">
            <div>
              <span className="dashboard-eyebrow">Ordens recentes</span>
              <h2>Ordens de serviço</h2>
            </div>
            <div className="dashboard-pipeline-tabs">
              <button
                className={tableTab === 'Ativas' ? 'active' : ''}
                onClick={() => setTableTab('Ativas')}
              >
                Ativas
              </button>
              <button
                className={tableTab === 'Finalizadas' ? 'active success' : ''}
                onClick={() => setTableTab('Finalizadas')}
              >
                Finalizadas
              </button>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table dashboard-pipeline-table">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Cliente</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5}>Carregando dados...</td>
                  </tr>
                ) : tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {tableTab === 'Ativas' ? 'Não há atendimentos em andamento no momento.' : 'Nenhuma OS finalizada recentemente.'}
                    </td>
                  </tr>
                ) : (
                  tableRows.map((vehicle) => {
                    const color = vehicle.statusColor || '#7c3aed';
                    return (
                      <tr key={vehicle.id}>
                        <td className="font-medium">{vehicle.placa || '-'}</td>
                        <td>{vehicle.clienteNome || '-'}</td>
                        <td>
                          <span className="status-badge" style={{ backgroundColor: `${color}20`, color }}>
                            <span className="status-dot" style={{ backgroundColor: color }} />
                            {vehicle.status}
                          </span>
                        </td>
                        <td className="font-medium">{formatMoney(Number(vehicle.valorTotal || vehicle.total || 0))}</td>
                        <td>
                          <button className="icon-btn" onClick={() => openTab(`/os/editar/${vehicle.id}`)} title="Ver detalhes">
                            <MoreVertical size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="dashboard-side-stack">
          <div className="card dashboard-quick-card">
            <div className="dashboard-card-heading compact">
              <div>
                <span className="dashboard-eyebrow">Resumo rápido</span>
                <h2>{periodoComMaiuscula}</h2>
              </div>
            </div>
            <div className="dashboard-quick-grid">
              {quickMetrics.map((item) => (
                <div key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            {renderNewActionMenu('quick', 'dashboard-cta')}
          </div>

          <div className="card dashboard-health-card">
            <span className="dashboard-eyebrow">Saúde da operação</span>
            <div className="dashboard-health-list">
              {healthItems.map((item) => (
                <div key={item.label} className="dashboard-health-item">
                  <span
                    className="dashboard-ring"
                    style={{
                      '--progress': `${item.progress}%`,
                      '--ring-color': item.color
                    } as React.CSSProperties}
                  />
                  <div>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                    {item.hint && (
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {item.hint}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {hasFinancialAccess && (
          <article className="card chart-container">
            <div className="dashboard-card-heading compact">
              <div>
                <span className="dashboard-eyebrow">Fluxo financeiro</span>
                <h2>Movimentação {selectedPeriodLabel}</h2>
              </div>
              <button className="icon-btn" onClick={() => navigate('/financeiro/caixa')} title="Abrir caixa">
                <MoreVertical size={18} />
              </button>
            </div>
            <div className="cash-flow-summary">
              <div>
                <span>Receitas líquidas</span>
                <strong>{formatMoney(metrics.faturamentoMes)}</strong>
              </div>
              <div>
                <span>Despesas</span>
                <strong>{formatMoney(metrics.despesasMes)}</strong>
              </div>
              <div className={metrics.lucroLiquidoMes >= 0 ? 'positive' : 'negative'}>
                <span>Saldo</span>
                <strong>{formatMoney(metrics.lucroLiquidoMes)}</strong>
              </div>
            </div>
            <div
              className="chart-wrapper"
              style={{
                filter: hideData ? 'blur(6px)' : 'none',
                pointerEvents: hideData ? 'none' : 'auto',
                userSelect: hideData ? 'none' : 'auto'
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashFlowData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} barGap={8}>
                  <CartesianGrid vertical={false} strokeDasharray="4 6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => compactCurrency(Number(value))} width={68} />
                  <Tooltip
                    formatter={(value) => hideData ? maskedMoney : currencyFormatter.format(Number(value || 0))}
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: 'var(--shadow-card)' }}
                    itemStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                  />
                  <Bar dataKey="entradas" fill="#10b981" radius={[5, 5, 0, 0]} name="Receitas" maxBarSize={32} />
                  <Bar dataKey="saidas" fill="#f87171" radius={[5, 5, 0, 0]} name="Despesas" maxBarSize={32} />
                  <Line type="monotone" dataKey="saldo" stroke="#7c3aed" strokeWidth={3} dot={false} name="Saldo" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </article>
        )}

        {hasFinancialAccess && (
          <article className="card chart-container">
            <div className="dashboard-card-heading compact">
              <div>
                <span className="dashboard-eyebrow">Distribuição</span>
                <h2>Status de OS</h2>
              </div>
              <button className="icon-btn" onClick={() => navigate('/os')} title="Abrir OS">
                <MoreVertical size={18} />
              </button>
            </div>
            <div className="chart-wrapper pie-wrapper">
              {osStatusData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={osStatusData} innerRadius={58} outerRadius={88} paddingAngle={5} dataKey="value" stroke="none" isAnimationActive={false}>
                        {osStatusData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: 'var(--shadow-card)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pie-legend">
                    {osStatusData.map((item) => (
                      <div key={item.name} className="legend-item">
                        <span className="legend-color" style={{ backgroundColor: item.color }} />
                        <span>{item.name} ({item.value})</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="chart-empty">Nenhuma OS ativa no momento.</div>
              )}
            </div>
          </article>
        )}

        <article className="card dashboard-insights">
          <div className="dashboard-card-heading compact">
            <div>
              <span className="dashboard-eyebrow">Leituras rápidas</span>
              <h2>Indicadores</h2>
            </div>
          </div>
          <div className="dashboard-insight-list">
            {hasFinancialAccess ? (
              <>
                <div>
                  <span>Ticket médio de OS finalizada</span>
                  <strong>{formatMoney(metrics.ticketMedioOS)}</strong>
                </div>
                <div>
                  <span>Valor em vendas do mês</span>
                  <strong>{formatMoney(metrics.valorVendasMes)}</strong>
                </div>
                <div>
                  <span>Orçamentos pendentes no período</span>
                  <strong>{formatMoney(metrics.valorOrcamentosPendentes)}</strong>
                </div>
                {/* Era um cartao de indicador ate 14/10/2026; segue a' vista aqui. */}
                <div>
                  <span>Clientes atendidos ({approvalRate}% conversão)</span>
                  <strong>{formatNumber(metrics.clientesUnicosMes)}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>OS finalizadas no período</span>
                  <strong>{formatNumber(metrics.osFinalizadasMes.length)}</strong>
                </div>
                <div>
                  <span>Pedidos no período</span>
                  <strong>{formatNumber(metrics.vendasMes.length)}</strong>
                </div>
                <div>
                  <span>Clientes atendidos</span>
                  <strong>{formatNumber(metrics.clientesUnicosMes)}</strong>
                </div>
              </>
            )}
            <div>
              <span>Itens esgotados</span>
              <strong>{formatNumber(metrics.itensEsgotados.length)}</strong>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
};

export default Dashboard;
