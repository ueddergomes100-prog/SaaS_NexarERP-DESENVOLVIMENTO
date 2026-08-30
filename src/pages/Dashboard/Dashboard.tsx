import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  MoreVertical,
  Package,
  Plus,
  ShoppingCart,
  Users
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
import { collection, onSnapshot, query, where } from 'firebase/firestore';
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
import { contaComoFaturamento } from '../../utils/preVendaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { isRevenueReversal, transactionDueDateInput, transactionNetAmount } from '../../utils/financeDomain';
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

const compactCurrency = (value: number) => {
  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absValue >= 1000000) return `${sign}R$ ${(absValue / 1000000).toFixed(1)} mi`;
  if (absValue >= 1000) return `${sign}R$ ${(absValue / 1000).toFixed(1)} mil`;
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
  const topActionMenuRef = useRef<HTMLDivElement>(null);
  const quickActionMenuRef = useRef<HTMLDivElement>(null);

  const { currentUser, userPermissions, tenantId, isOwner, vendasVisiveisDeUsuarioId } = useAuth();
  const isTabActive = useContext(TabActiveContext);
  const hasFinancialAccess = isOwner || userPermissions?.includes('dashboard.valores');

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

    unsubscribes.push(onSnapshot(
      query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId)),
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

    unsubscribes.push(onSnapshot(
      query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)),
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

    unsubscribes.push(onSnapshot(
      query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId)),
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
  }, [currentUser, tenantId, hasFinancialAccess, vendasVisiveisDeUsuarioId]);

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
    // Estorno (OS/venda cancelada, devolucao) ANULA receita -- nao e' despesa.
    // Antes, uma OS cancelada inflava as duas pontas ao mesmo tempo: a entrada
    // original seguia somando na receita e o lancamento compensatorio entrava
    // como despesa operacional. O saldo fechava, mas os dois numeros mentiam.
    const estornosMes = transacoesPagasMes.filter(isRevenueReversal);
    const totalEstornosMes = estornosMes.reduce((acc, curr) => acc + transactionNetAmount(curr), 0);

    const faturamentoMes = transacoesPagasMes
      .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
      .reduce((acc, curr) => acc + transactionNetAmount(curr), 0) - totalEstornosMes;
    const faturamentoHoje = transacoesPagasMes
      .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução' && sameDay(transactionDate(t), hoje))
      .reduce((acc, curr) => acc + transactionNetAmount(curr), 0)
      - estornosMes
        .filter((t) => sameDay(transactionDate(t), hoje))
        .reduce((acc, curr) => acc + transactionNetAmount(curr), 0);
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
    const buckets = new Map<string, { name: string; order: number; entradas: number; saidas: number; saldo: number }>();
    transacoes
      .filter((transaction) => transaction.status === 'Paga' && isWithinDateRange(transactionDate(transaction), selectedPeriodRange.start, selectedPeriodRange.end))
      .forEach((transaction) => {
        const date = transactionDate(transaction);
        if (!date) return;
        const bucket = periodBucket(date, dashboardPeriod);
        const current = buckets.get(bucket.key) || { name: bucket.name, order: bucket.order, entradas: 0, saidas: 0, saldo: 0 };
        // Mesmo criterio do bloco de metricas: estorno abate a entrada, nao
        // engorda a saida (senao o grafico mostra pico de receita e de despesa
        // no mesmo dia por causa de um cancelamento).
        if (isRevenueReversal(transaction)) {
          current.entradas -= transactionNetAmount(transaction);
        } else if (transaction.tipo === 'entrada' && transaction.formaPagamento !== 'Crédito de Devolução') {
          current.entradas += transactionNetAmount(transaction);
        } else if (transaction.tipo === 'saida') {
          current.saidas += transactionNetAmount(transaction);
        }
        current.saldo = current.entradas - current.saidas;
        buckets.set(bucket.key, current);
      });
    return Array.from(buckets.values()).sort((a, b) => a.order - b.order);
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
    transacoes.forEach((transaction) => {
      const date = transactionDate(transaction);
      if (
        transaction.status !== 'Paga' ||
        !isWithinDateRange(date, selectedPeriodRange.start, selectedPeriodRange.end) ||
        !date
      ) return;

      // Estorno abate a receita da curva de performance, em vez de ser
      // ignorado -- senao o grafico continua mostrando o pico da venda que
      // foi cancelada.
      if (isRevenueReversal(transaction)) {
        ensureBucket(date).receita -= transactionNetAmount(transaction);
        return;
      }
      if (transaction.tipo !== 'entrada' || transaction.formaPagamento === 'Crédito de Devolução') return;
      ensureBucket(date).receita += transactionNetAmount(transaction);
    });

    return Array.from(buckets.values()).sort((a, b) => a.order - b.order);
  }, [dashboardPeriod, osList, pedidos, selectedPeriodRange, transacoes]);

  const osStatusData = useMemo(() => {
    const contagemStatus: Record<string, { value: number; color: string }> = {};
    metrics.osAtivas.forEach((os) => {
      if (!contagemStatus[os.status]) {
        contagemStatus[os.status] = { value: 0, color: os.statusColor || '#37d7ff' };
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
        t.status === 'Paga' &&
        t.tipo === 'entrada' &&
        t.formaPagamento !== 'Crédito de Devolução' &&
        isWithinDateRange(transactionDate(t), selectedPeriodRange.start, selectedPeriodRange.end)
      ))
      .forEach((t) => {
        const name = t.formaPagamento || 'Não informada';
        map[name] = (map[name] || 0) + transactionNetAmount(t);
      });
    return Object.entries(map).map(([name, value], index) => ({
      name,
      value,
      color: ['#37d7ff', '#ff4fb3', '#9f7aea', '#2ee6a6', '#ffb84d'][index % 5]
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
  // NAO e' "meta mensal" -- o sistema nao tem meta cadastrada em lugar
  // nenhum. O que esta conta mede e' quanto da oportunidade do periodo ja
  // virou dinheiro: receita paga sobre (receita paga + orcamentos ainda em
  // aberto). Ficava rotulado como meta e mostrava 100% pra qualquer
  // faturamento sem orcamento pendente, o que nao queria dizer nada.
  // Quando houver meta configuravel, esta conta vira outra coisa.
  const oportunidadeTotal = metrics.faturamentoMes + metrics.valorOrcamentosPendentes;
  const pipelineRealizadoRate = hasFinancialAccess
    ? (oportunidadeTotal > 0
      ? clampPercentage((metrics.faturamentoMes / oportunidadeTotal) * 100)
      : 0)
    : osCompletionRate;

  const kpiCards = [
    {
      title: 'OS ativas',
      value: formatNumber(metrics.osAtivas.length),
      meta: `${formatNumber(metrics.osParadas.length)} paradas há 3+ dias`,
      icon: Activity,
      tone: 'cyan',
      chartType: 'line',
      dataKey: 'os'
    },
    {
      title: hasFinancialAccess ? 'Receita líquida do período' : 'Pedidos do período',
      value: hasFinancialAccess ? formatMoney(metrics.faturamentoMes) : formatNumber(metrics.vendasMes.length),
      meta: hasFinancialAccess ? `${formatMoney(metrics.faturamentoHoje)} hoje` : `${formatNumber(metrics.vendasHoje.length)} hoje`,
      icon: hasFinancialAccess ? DollarSign : ShoppingCart,
      tone: 'magenta',
      chartType: 'bar',
      dataKey: hasFinancialAccess ? 'receita' : 'pedidos'
    },
    {
      title: 'Clientes atendidos',
      value: formatNumber(metrics.clientesUnicosMes),
      meta: `${approvalRate}% conversão`,
      icon: Users,
      tone: 'violet',
      chartType: 'line',
      dataKey: 'finalizadas'
    }
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
    { label: 'Conclusão de OS', value: `${osCompletionRate}%`, progress: osCompletionRate, color: '#37d7ff' },
    { label: 'Orçamentos aprovados', value: `${approvalRate}%`, progress: approvalRate, color: '#ff4fb3' },
    {
      label: hasFinancialAccess ? 'Receita já realizada vs. em aberto' : 'Ritmo operacional',
      value: `${pipelineRealizadoRate}%`,
      progress: pipelineRealizadoRate,
      color: '#9f7aea',
    }
  ];

  const criticalTasks = [
    {
      title: 'Contas a receber vencidas',
      detail: `${formatNumber(metrics.contasReceberVencidas.length)} pendências financeiras`,
      icon: AlertTriangle,
      route: '/financeiro/contas-receber',
      tone: 'warning',
      visible: hasFinancialAccess
    },
    {
      title: 'Estoque em atenção',
      detail: `${formatNumber(metrics.itensEstoqueBaixo.length)} itens abaixo do mínimo`,
      icon: Package,
      route: '/estoque',
      tone: 'cyan',
      visible: true
    },
    {
      title: 'OS paradas',
      detail: `${formatNumber(metrics.osParadas.length)} ordens ativas há 3 dias ou mais`,
      icon: Clock,
      route: '/os',
      tone: 'magenta',
      visible: true
    },
    {
      title: 'Orçamentos para converter',
      detail: `${formatNumber(Math.max(metrics.orcamentosMes.length - metrics.orcamentosConvertidos, 0))} oportunidades ${selectedPeriodLabel}`,
      icon: FileText,
      route: '/orcamentos',
      tone: 'violet',
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
          <span className="dashboard-eyebrow">Painel / Gestão em tempo real</span>
          <h1 className="page-title">Dashboard Principal</h1>
          <p className="page-subtitle">Receita, OS e agenda em uma visão executiva para operação diária.</p>
        </div>

        <div className="dashboard-actions">
          <div className="dashboard-clock">
            <div>
              <span>{formattedDate}</span>
              <strong>{formattedTime}</strong>
            </div>
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

      <section className="dashboard-hero-grid">
        <article className="card dashboard-performance-card">
          <div className="dashboard-card-heading">
            <div>
              <span className="dashboard-eyebrow">Gestão em tempo real</span>
              <h2>Receita, OS e agenda</h2>
            </div>
            <div className="dashboard-segmented">
              <button className={dashboardPeriod === 'hoje' ? 'active' : ''} onClick={() => selectDashboardPeriod('hoje')}>Hoje</button>
              <button className={dashboardPeriod === 'semana' ? 'active' : ''} onClick={() => selectDashboardPeriod('semana')}>Semana</button>
              <button className={dashboardPeriod === 'mes' ? 'active' : ''} onClick={() => selectDashboardPeriod('mes')}>Mês</button>
            </div>
          </div>

          <div className="dashboard-performance-summary">
            <div>
              <strong>{mainMetricValue}</strong>
              <span>{mainMetricCaption}</span>
            </div>
            <div>
              <strong>{formatNumber(metrics.osAtivas.length)}</strong>
              <span>OS em andamento</span>
            </div>
            <div>
              <strong>{formatNumber(metrics.vendasMes.length)}</strong>
              <span>Pedidos {selectedPeriodLabel}</span>
            </div>
          </div>

          <div
            className="dashboard-performance-chart"
            style={{
              filter: hideData && hasFinancialAccess ? 'blur(7px)' : 'none',
              pointerEvents: hideData && hasFinancialAccess ? 'none' : 'auto',
              userSelect: hideData && hasFinancialAccess ? 'none' : 'auto'
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={performanceData} margin={{ top: 18, right: 18, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashboardCyanArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#37d7ff" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#37d7ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#7f8aa4"
                  tick={{ fill: '#7f8aa4', fontSize: 11, fontWeight: 700 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="value"
                  stroke="#7f8aa4"
                  tick={{ fill: '#7f8aa4', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={hasFinancialAccess ? 72 : 34}
                  tickFormatter={(value) => hasFinancialAccess ? compactCurrency(Number(value)) : numberFormatter.format(Number(value))}
                />
                <YAxis yAxisId="volume" orientation="right" hide />
                <Tooltip
                  formatter={(value, name) => {
                    const numericValue = Number(value || 0);
                    if (hideData && name === 'Receita') return maskedMoney;
                    return name === 'Receita' ? currencyFormatter.format(numericValue) : numberFormatter.format(numericValue);
                  }}
                  contentStyle={{
                    backgroundColor: '#111722',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 8,
                    color: '#f5f7fb'
                  }}
                  itemStyle={{ color: '#f5f7fb' }}
                  labelStyle={{ color: '#98a2b7' }}
                />
                <Area
                  yAxisId="value"
                  type="monotone"
                  dataKey={mainMetricKey}
                  name={mainMetricLabel}
                  stroke="#37d7ff"
                  strokeWidth={4}
                  fill="url(#dashboardCyanArea)"
                  dot={false}
                  activeDot={{ r: 6, strokeWidth: 2, fill: '#0c1018' }}
                />
                <Line
                  yAxisId="volume"
                  type="monotone"
                  dataKey="finalizadas"
                  name="OS finalizadas"
                  stroke="#ff4fb3"
                  strokeWidth={3}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>

        <aside className="dashboard-side-stack">
          <div className="card dashboard-quick-card">
            <div className="dashboard-card-heading compact">
              <div>
                <span className="dashboard-eyebrow">Resumo rápido</span>
                <h2>Hoje</h2>
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-kpi-grid">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.title} className={`card dashboard-kpi-card ${card.tone}`}>
              <div className="dashboard-kpi-top">
                <div>
                  <span>{card.title}</span>
                  <strong>{card.value}</strong>
                </div>
                <div className="dashboard-kpi-icon">
                  <Icon size={20} />
                </div>
              </div>
              <p>{card.meta}</p>
              <div className="dashboard-mini-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={performanceData.slice(-8)} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    {card.chartType === 'bar' ? (
                      <Bar dataKey={card.dataKey} fill="currentColor" radius={[5, 5, 0, 0]} maxBarSize={10} />
                    ) : (
                      <Line type="monotone" dataKey={card.dataKey} stroke="currentColor" strokeWidth={4} dot={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </article>
          );
        })}
      </section>

      <section className="dashboard-bottom-grid">
        <article className="card dashboard-task-card">
          <div className="dashboard-card-heading compact">
            <div>
              <span className="dashboard-eyebrow">Tarefas críticas</span>
              <h2>Fila operacional</h2>
            </div>
          </div>
          <div className="dashboard-task-list">
            {criticalTasks.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.title} className={`dashboard-task-item ${item.tone}`} onClick={() => navigate(item.route)}>
                  <span className="dashboard-task-check">
                    <Icon size={16} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </article>

        <article className="card dashboard-pipeline-card">
          <div className="dashboard-card-heading compact">
            <div>
              <span className="dashboard-eyebrow">Ordens recentes</span>
              <h2>Pipeline</h2>
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
                    const color = vehicle.statusColor || '#37d7ff';
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
      </section>

      <section className="dashboard-detail-grid">
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
                  <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
                  <XAxis dataKey="name" stroke="#7f8aa4" tick={{ fill: '#7f8aa4', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#7f8aa4" tick={{ fill: '#7f8aa4', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => compactCurrency(Number(value))} width={68} />
                  <Tooltip
                    formatter={(value) => hideData ? maskedMoney : currencyFormatter.format(Number(value || 0))}
                    contentStyle={{ backgroundColor: '#111722', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}
                    itemStyle={{ color: '#f5f7fb' }}
                  />
                  <Bar dataKey="entradas" fill="#37d7ff" radius={[5, 5, 0, 0]} name="Receitas" maxBarSize={32} />
                  <Bar dataKey="saidas" fill="#ff4fb3" radius={[5, 5, 0, 0]} name="Despesas" maxBarSize={32} />
                  <Line type="monotone" dataKey="saldo" stroke="#9f7aea" strokeWidth={3} dot={false} name="Saldo" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </article>
        )}

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
                    <Pie data={osStatusData} innerRadius={58} outerRadius={88} paddingAngle={5} dataKey="value" stroke="none">
                      {osStatusData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#111722', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }} />
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

        {hasFinancialAccess && (
          <article className="card dashboard-insights">
            <div className="dashboard-card-heading compact">
              <div>
                <span className="dashboard-eyebrow">Recebimentos</span>
                <h2>Formas de pagamento</h2>
              </div>
              <button className="icon-btn" onClick={() => navigate('/financeiro/faturamento')} title="Abrir faturamento">
                <MoreVertical size={18} />
              </button>
            </div>
            <div className="chart-wrapper pie-wrapper">
              {paymentData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={paymentData} innerRadius={58} outerRadius={88} paddingAngle={4} dataKey="value" stroke="none">
                        {paymentData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => hideData ? maskedMoney : currencyFormatter.format(Number(value || 0))}
                        contentStyle={{ backgroundColor: '#111722', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pie-legend">
                    {paymentData.map((item) => (
                      <div key={item.name} className="legend-item">
                        <span className="legend-color" style={{ backgroundColor: item.color }} />
                        <span>{item.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="chart-empty">Nenhuma receita paga no período.</div>
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
