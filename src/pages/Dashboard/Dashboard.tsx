import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  createdAt?: any;
}

interface PedidoVendaData {
  id: string;
  clienteNome?: string;
  numeroPedido?: string;
  status: string;
  valorTotal: number;
  formaPagamento?: string;
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
  unidadeMedidaSigla?: string;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numberFormatter = new Intl.NumberFormat('pt-BR');
const mesesAbreviados = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

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
    const parsed = new Date(value.includes('T') ? value : `${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const transactionDate = (t: TransacaoData): Date | null => (
  toDate(t.dataPagamento) || toDate(t.data) || toDate(t.createdAt)
);

const sameMonth = (date: Date | null, month: number, year: number) => (
  !!date && date.getMonth() === month && date.getFullYear() === year
);

const sameDay = (date: Date | null, base: Date) => (
  !!date &&
  date.getDate() === base.getDate() &&
  date.getMonth() === base.getMonth() &&
  date.getFullYear() === base.getFullYear()
);

const isBeforeToday = (date: Date | null, today: Date) => {
  if (!date) return false;
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return a < b;
};

const daysSince = (date: Date | null, today: Date) => {
  if (!date) return 0;
  return Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
};

const clampPercentage = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [osList, setOsList] = useState<OSData[]>([]);
  const [transacoes, setTransacoes] = useState<TransacaoData[]>([]);
  const [pedidos, setPedidos] = useState<PedidoVendaData[]>([]);
  const [orcamentos, setOrcamentos] = useState<OrcamentoData[]>([]);
  const [estoque, setEstoque] = useState<EstoqueData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableTab, setTableTab] = useState<'Ativas' | 'Finalizadas'>('Ativas');
  const [hideData, setHideData] = useState(() => localStorage.getItem('nexus_hide_dashboard') === 'true');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [openActionMenu, setOpenActionMenu] = useState<'top' | 'quick' | null>(null);
  const topActionMenuRef = useRef<HTMLDivElement>(null);
  const quickActionMenuRef = useRef<HTMLDivElement>(null);

  const { currentUser, userPermissions, tenantId, isOwner } = useAuth();
  const hasFinancialAccess = isOwner || userPermissions?.includes('dashboard.valores');

  const newActionOptions = [
    { label: 'Venda', detail: 'Novo pedido de venda', icon: ShoppingCart, route: '/pedidos-venda/novo' },
    { label: 'Cad. Cliente', detail: 'Cadastrar cliente', icon: Users, route: '/clientes/novo' },
    { label: 'OS', detail: 'Nova ordem de serviço', icon: Activity, route: '/os/nova' },
    { label: 'Orçamento', detail: 'Novo orçamento', icon: FileText, route: '/orcamentos/novo' }
  ];

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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
      () => markLoaded()
    ));

    unsubscribes.push(onSnapshot(
      query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId)),
      (snapshot) => {
        const data: PedidoVendaData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as PedidoVendaData));
        data.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        setPedidos(data);
        markLoaded();
      },
      () => markLoaded()
    ));

    unsubscribes.push(onSnapshot(
      query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId)),
      (snapshot) => {
        const data: OrcamentoData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as OrcamentoData));
        setOrcamentos(data);
        markLoaded();
      },
      () => markLoaded()
    ));

    unsubscribes.push(onSnapshot(
      query(collection(db, 'estoque'), where('tenantId', '==', tenantId)),
      (snapshot) => {
        const data: EstoqueData[] = [];
        snapshot.forEach((docSnap) => data.push({ id: docSnap.id, ...docSnap.data() } as EstoqueData));
        setEstoque(data);
        markLoaded();
      },
      () => markLoaded()
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
        () => markLoaded()
      ));
    }

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [currentUser, tenantId, hasFinancialAccess]);

  const toggleHideData = () => {
    const newVal = !hideData;
    setHideData(newVal);
    localStorage.setItem('nexus_hide_dashboard', String(newVal));
  };

  const metrics = useMemo(() => {
    const hoje = currentDate;
    const mesAtual = hoje.getMonth();
    const anoAtual = hoje.getFullYear();

    const osMesAtual = osList.filter((os) => sameMonth(toDate(os.createdAt), mesAtual, anoAtual));
    const osAtivas = osList.filter((os) => os.status !== 'Finalizada' && os.status !== 'Cancelada');
    const osFinalizadas = osList.filter((os) => os.status === 'Finalizada');
    const osFinalizadasMes = osMesAtual.filter((os) => os.status === 'Finalizada');
    const osParadas = osAtivas.filter((os) => daysSince(toDate(os.createdAt), hoje) >= 3);
    const clientesUnicosMes = new Set(osMesAtual.map((os) => os.clienteNome).filter(Boolean)).size;
    const ticketMedioOS = osFinalizadasMes.length
      ? osFinalizadasMes.reduce((acc, os) => acc + Number(os.valorTotal || os.total || 0), 0) / osFinalizadasMes.length
      : 0;

    const vendasMes = pedidos.filter((p) => p.status !== 'Cancelada' && sameMonth(toDate(p.createdAt), mesAtual, anoAtual));
    const vendasHoje = vendasMes.filter((p) => sameDay(toDate(p.createdAt), hoje));
    const valorVendasMes = vendasMes.reduce((acc, p) => acc + Number(p.valorTotal || 0), 0);

    const orcamentosMes = orcamentos.filter((o) => sameMonth(toDate(o.createdAt), mesAtual, anoAtual));
    const orcamentosConvertidos = orcamentosMes.filter((o) => ['Finalizado', 'Convertido'].includes(o.status)).length;
    const taxaConversaoOrcamentos = orcamentosMes.length ? (orcamentosConvertidos / orcamentosMes.length) * 100 : 0;
    const valorOrcamentosPendentes = orcamentosMes
      .filter((o) => ['Pendente', 'Aprovado'].includes(o.status))
      .reduce((acc, o) => acc + Number(o.valorTotal || 0), 0);

    const transacoesPagasMes = transacoes.filter((t) => (
      t.status === 'Paga' && sameMonth(transactionDate(t), mesAtual, anoAtual)
    ));
    const faturamentoMes = transacoesPagasMes
      .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
      .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
    const faturamentoHoje = transacoesPagasMes
      .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução' && sameDay(transactionDate(t), hoje))
      .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
    const despesasMes = transacoesPagasMes
      .filter((t) => t.tipo === 'saida')
      .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
    const lucroLiquidoMes = faturamentoMes - despesasMes;
    const contasReceberVencidas = transacoes.filter((t) => (
      t.tipo === 'entrada' && t.status === 'Pendente' && isBeforeToday(toDate(t.data) || toDate(t.createdAt), hoje)
    ));
    const contasPagarVencidas = transacoes.filter((t) => (
      t.tipo === 'saida' && t.status === 'Pendente' && isBeforeToday(toDate(t.data) || toDate(t.createdAt), hoje)
    ));

    const itensEstoqueBaixo = estoque.filter((item) => {
      const qtd = Number(item.quantidade || 0);
      const minimo = Number(item.estoqueMinimo ?? 5);
      return qtd <= minimo;
    });
    const itensEsgotados = estoque.filter((item) => Number(item.quantidade || 0) <= 0);

    return {
      anoAtual,
      clientesUnicosMes,
      contasPagarVencidas,
      contasReceberVencidas,
      despesasMes,
      faturamentoHoje,
      faturamentoMes,
      itensEsgotados,
      itensEstoqueBaixo,
      lucroLiquidoMes,
      mesAtual,
      orcamentosConvertidos,
      orcamentosMes,
      osAtivas,
      osFinalizadas,
      osFinalizadasMes,
      osParadas,
      taxaConversaoOrcamentos,
      ticketMedioOS,
      valorOrcamentosPendentes,
      valorVendasMes,
      vendasHoje,
      vendasMes
    };
  }, [currentDate, estoque, orcamentos, osList, pedidos, transacoes]);

  const cashFlowData = useMemo(() => {
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(metrics.anoAtual, metrics.mesAtual - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const transM = transacoes.filter((t) => t.status === 'Paga' && sameMonth(transactionDate(t), m, y));
      const entradas = transM
        .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
        .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
      const saidas = transM
        .filter((t) => t.tipo === 'saida')
        .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);
      data.push({ name: mesesAbreviados[m], entradas, saidas, saldo: entradas - saidas });
    }
    return data;
  }, [metrics.anoAtual, metrics.mesAtual, transacoes]);

  const performanceData = useMemo(() => {
    const data = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(metrics.anoAtual, metrics.mesAtual - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const osMes = osList.filter((os) => sameMonth(toDate(os.createdAt), m, y));
      const pedidosMes = pedidos.filter((p) => p.status !== 'Cancelada' && sameMonth(toDate(p.createdAt), m, y));
      const transM = transacoes.filter((t) => t.status === 'Paga' && sameMonth(transactionDate(t), m, y));
      const receita = transM
        .filter((t) => t.tipo === 'entrada' && t.formaPagamento !== 'Crédito de Devolução')
        .reduce((acc, curr) => acc + Number(curr.valor || 0), 0);

      data.push({
        name: mesesAbreviados[m],
        receita,
        os: osMes.length,
        finalizadas: osMes.filter((os) => os.status === 'Finalizada').length,
        pedidos: pedidosMes.length
      });
    }
    return data;
  }, [metrics.anoAtual, metrics.mesAtual, osList, pedidos, transacoes]);

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
        sameMonth(transactionDate(t), metrics.mesAtual, metrics.anoAtual)
      ))
      .forEach((t) => {
        const name = t.formaPagamento || 'Não informada';
        map[name] = (map[name] || 0) + Number(t.valor || 0);
      });
    return Object.entries(map).map(([name, value], index) => ({
      name,
      value,
      color: ['#37d7ff', '#ff4fb3', '#9f7aea', '#2ee6a6', '#ffb84d'][index % 5]
    }));
  }, [metrics.anoAtual, metrics.mesAtual, transacoes]);

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
  const mainMetricLabel = hasFinancialAccess ? 'Receita' : 'OS abertas';
  const mainMetricValue = hasFinancialAccess ? formatMoney(metrics.faturamentoMes) : formatNumber(metrics.osAtivas.length);
  const mainMetricCaption = hasFinancialAccess ? 'Receita paga no mês' : 'Ordens em andamento';
  const osCompletionRate = clampPercentage(
    (metrics.osFinalizadasMes.length / Math.max(metrics.osFinalizadasMes.length + metrics.osAtivas.length, 1)) * 100
  );
  const approvalRate = clampPercentage(metrics.taxaConversaoOrcamentos);
  const monthlyGoalRate = hasFinancialAccess
    ? clampPercentage((metrics.faturamentoMes / Math.max(metrics.faturamentoMes + metrics.valorOrcamentosPendentes, 1)) * 100)
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
      title: hasFinancialAccess ? 'Receita do mês' : 'Pedidos no mês',
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
      label: hasFinancialAccess ? 'Entradas' : 'Vendas hoje',
      value: hasFinancialAccess ? formatMoney(metrics.faturamentoHoje) : formatNumber(metrics.vendasHoje.length)
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
    }
  ];

  const healthItems = [
    { label: 'Conclusão de OS', value: `${osCompletionRate}%`, progress: osCompletionRate, color: '#37d7ff' },
    { label: 'Orçamentos aprovados', value: `${approvalRate}%`, progress: approvalRate, color: '#ff4fb3' },
    { label: hasFinancialAccess ? 'Meta mensal' : 'Ritmo operacional', value: `${monthlyGoalRate}%`, progress: monthlyGoalRate, color: '#9f7aea' }
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
      detail: `${formatNumber(Math.max(metrics.orcamentosMes.length - metrics.orcamentosConvertidos, 0))} oportunidades no mês`,
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
              <button className="active">Hoje</button>
              <button>Semana</button>
              <button>Mês</button>
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
              <span>Pedidos no mês</span>
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
                          <button className="icon-btn" onClick={() => navigate(`/os/editar/${vehicle.id}`)} title="Ver detalhes">
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
                <h2>Últimos 6 meses</h2>
              </div>
              <button className="icon-btn" onClick={() => navigate('/financeiro/caixa')} title="Abrir caixa">
                <MoreVertical size={18} />
              </button>
            </div>
            <div className="cash-flow-summary">
              <div>
                <span>Receitas</span>
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
                <div className="chart-empty">Nenhuma receita paga no mês.</div>
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
                  <span>Orçamentos pendentes no mês</span>
                  <strong>{formatMoney(metrics.valorOrcamentosPendentes)}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>OS finalizadas no mês</span>
                  <strong>{formatNumber(metrics.osFinalizadasMes.length)}</strong>
                </div>
                <div>
                  <span>Pedidos no mês</span>
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
