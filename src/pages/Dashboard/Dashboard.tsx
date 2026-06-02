import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  MoreVertical,
  Package,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
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

  const { currentUser, userRole, userPermissions, tenantId, isOwner } = useAuth();
  const hasFinancialAccess = isOwner || userPermissions?.includes('dashboard.valores');

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (userRole === 'SuperAdmin') {
      navigate('/superadmin');
    }
  }, [userRole, navigate]);

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

  const osStatusData = useMemo(() => {
    const contagemStatus: Record<string, { value: number; color: string }> = {};
    metrics.osAtivas.forEach((os) => {
      if (!contagemStatus[os.status]) {
        contagemStatus[os.status] = { value: 0, color: os.statusColor || '#8b5cf6' };
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
      color: ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444'][index % 5]
    }));
  }, [metrics.anoAtual, metrics.mesAtual, transacoes]);

  const maskedMoney = hideData ? 'R$ •••••' : null;
  const maskedNumber = hideData ? '•••' : null;

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

  return (
    <div className="dashboard">
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 className="page-title">Dashboard</h1>
            <button
              className="icon-btn"
              onClick={toggleHideData}
              title={hideData ? 'Mostrar valores' : 'Ocultar valores'}
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {hideData ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          <p className="page-subtitle">Visão geral operacional, comercial e financeira em tempo real</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
          <div className="dashboard-clock">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{formattedDate}</span>
              <span style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)', letterSpacing: '1px' }}>{formattedTime}</span>
            </div>
            <div className="dashboard-clock-icon">
              <Clock size={20} />
            </div>
          </div>

          <button className="btn-primary" onClick={() => navigate('/os/nova')}>
            Nova Ordem de Serviço
          </button>
        </div>
      </div>

      <div className="dashboard-section-title">
        <span>Financeiro</span>
      </div>
      <div className="summary-cards dashboard-cards-compact">
        {hasFinancialAccess && (
          <>
            <div className="card stat-card" style={{ borderLeft: `4px solid ${metrics.lucroLiquidoMes >= 0 ? '#10b981' : '#ef4444'}` }}>
              <div className="stat-header">
                <div className="stat-icon green-bg">
                  <TrendingUp size={24} />
                </div>
                <span className="stat-trend positive">Líquido</span>
              </div>
              <div className="stat-info">
                <h3 style={{ color: metrics.lucroLiquidoMes >= 0 ? '#10b981' : '#ef4444' }}>{formatMoney(metrics.lucroLiquidoMes)}</h3>
                <p>Lucro Líquido Mês</p>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat-header">
                <div className="stat-icon purple-bg">
                  <DollarSign size={24} />
                </div>
                <span className="stat-trend positive">Bruto</span>
              </div>
              <div className="stat-info">
                <h3>{formatMoney(metrics.faturamentoMes)}</h3>
                <p>Receita Bruta Mês</p>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat-header">
                <div className="stat-icon yellow-bg">
                  <Wallet size={24} />
                </div>
                <span className="stat-trend positive">Hoje</span>
              </div>
              <div className="stat-info">
                <h3>{formatMoney(metrics.faturamentoHoje)}</h3>
                <p>Faturamento Hoje</p>
              </div>
            </div>

            <div className="card stat-card">
              <div className="stat-header">
                <div className="stat-icon blue-bg">
                  <Activity size={24} />
                </div>
                <span className="stat-trend positive">Saídas</span>
              </div>
              <div className="stat-info">
                <h3>{formatMoney(metrics.despesasMes)}</h3>
                <p>Despesas Pagas Mês</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="dashboard-section-title">
        <span>Operação e Comercial</span>
      </div>
      <div className="summary-cards dashboard-cards-compact">
        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon green-bg">
              <CheckCircle size={24} />
            </div>
            <span className="stat-trend positive">Mês</span>
          </div>
          <div className="stat-info">
            <h3>{formatNumber(metrics.osFinalizadasMes.length)}</h3>
            <p>OS Finalizadas</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon blue-bg">
              <Users size={24} />
            </div>
            <span className="stat-trend positive">Mês</span>
          </div>
          <div className="stat-info">
            <h3>{formatNumber(metrics.clientesUnicosMes)}</h3>
            <p>Clientes Atendidos</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon purple-bg">
              <ShoppingCart size={24} />
            </div>
            <span className="stat-trend positive">Vendas</span>
          </div>
          <div className="stat-info">
            <h3>{formatNumber(metrics.vendasMes.length)}</h3>
            <p>Pedidos no Mês</p>
          </div>
        </div>

        <div className="card stat-card">
          <div className="stat-header">
            <div className="stat-icon yellow-bg">
              <FileText size={24} />
            </div>
            <span className="stat-trend positive">Conversão</span>
          </div>
          <div className="stat-info">
            <h3>{hideData ? maskedNumber : `${metrics.taxaConversaoOrcamentos.toFixed(0)}%`}</h3>
            <p>Orçamentos Convertidos</p>
          </div>
        </div>
      </div>

      <div className="dashboard-alert-grid">
        <button className="dashboard-alert-card" onClick={() => navigate('/financeiro/contas-receber')}>
          <AlertTriangle size={20} />
          <div>
            <strong>{formatNumber(metrics.contasReceberVencidas.length)}</strong>
            <span>contas a receber vencidas</span>
          </div>
        </button>
        <button className="dashboard-alert-card" onClick={() => navigate('/financeiro/contas-pagar')}>
          <AlertTriangle size={20} />
          <div>
            <strong>{formatNumber(metrics.contasPagarVencidas.length)}</strong>
            <span>contas a pagar vencidas</span>
          </div>
        </button>
        <button className="dashboard-alert-card" onClick={() => navigate('/estoque')}>
          <Package size={20} />
          <div>
            <strong>{formatNumber(metrics.itensEstoqueBaixo.length)}</strong>
            <span>itens em estoque baixo</span>
          </div>
        </button>
        <button className="dashboard-alert-card" onClick={() => navigate('/os')}>
          <Clock size={20} />
          <div>
            <strong>{formatNumber(metrics.osParadas.length)}</strong>
            <span>OS ativas há 3 dias ou mais</span>
          </div>
        </button>
      </div>

      <div className="dashboard-charts">
        {hasFinancialAccess && (
          <div className="card chart-container">
            <div className="card-header">
              <div>
                <h3>Fluxo de Caixa Mensal</h3>
                <span className="chart-subtitle">Receitas e despesas pagas nos ultimos 6 meses</span>
              </div>
              <button className="icon-btn" onClick={() => navigate('/financeiro/caixa')}><MoreVertical size={18} /></button>
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
                <span>Saldo do mes</span>
                <strong>{formatMoney(metrics.lucroLiquidoMes)}</strong>
              </div>
            </div>
            <div className="chart-wrapper" style={{ filter: hideData ? 'blur(6px)' : 'none', transition: 'filter 0.3s', userSelect: hideData ? 'none' : 'auto', pointerEvents: hideData ? 'none' : 'auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashFlowData} margin={{ top: 16, right: 16, left: 8, bottom: 0 }} barGap={8}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#a0a0ab" tick={{ fill: '#a0a0ab' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="#a0a0ab" tick={{ fill: '#a0a0ab' }} axisLine={false} tickLine={false} tickFormatter={(value) => compactCurrency(Number(value))} width={72} />
                  <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
                  <Tooltip
                    formatter={(value: number) => currencyFormatter.format(Number(value))}
                    labelFormatter={(label) => `Mes: ${label}`}
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ color: 'var(--text-secondary)', fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="entradas" fill="#10b981" radius={[4, 4, 0, 0]} name="Receitas" maxBarSize={34} />
                  <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} name="Despesas" maxBarSize={34} />
                  <Line type="monotone" dataKey="saldo" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2, fill: 'var(--bg-secondary)' }} activeDot={{ r: 6 }} name="Saldo" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className={`card chart-container small`} style={{ gridColumn: !hasFinancialAccess ? '1 / -1' : undefined }}>
          <div className="card-header">
            <h3>Status de OS Ativas</h3>
            <button className="icon-btn" onClick={() => navigate('/os')}><MoreVertical size={18} /></button>
          </div>
          <div className="chart-wrapper pie-wrapper" style={{ filter: hideData ? 'blur(6px)' : 'none', transition: 'filter 0.3s', userSelect: hideData ? 'none' : 'auto', pointerEvents: hideData ? 'none' : 'auto' }}>
            {osStatusData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={osStatusData} innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none">
                      {osStatusData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  {osStatusData.map((item) => (
                    <div key={item.name} className="legend-item">
                      <span className="legend-color" style={{ backgroundColor: item.color }}></span>
                      <span className="legend-label">{item.name} ({item.value})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="chart-empty">Nenhuma OS ativa no momento.</div>
            )}
          </div>
        </div>
      </div>

      {hasFinancialAccess && (
        <div className="dashboard-detail-grid">
          <div className="card chart-container">
            <div className="card-header">
              <h3>Receita por Forma de Pagamento</h3>
              <button className="icon-btn" onClick={() => navigate('/financeiro/faturamento')}><MoreVertical size={18} /></button>
            </div>
            <div className="chart-wrapper pie-wrapper" style={{ filter: hideData ? 'blur(6px)' : 'none', transition: 'filter 0.3s', userSelect: hideData ? 'none' : 'auto', pointerEvents: hideData ? 'none' : 'auto' }}>
              {paymentData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={paymentData} innerRadius={60} outerRadius={95} paddingAngle={4} dataKey="value" stroke="none">
                        {paymentData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => currencyFormatter.format(Number(value))} contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pie-legend">
                    {paymentData.map((item) => (
                      <div key={item.name} className="legend-item">
                        <span className="legend-color" style={{ backgroundColor: item.color }}></span>
                        <span className="legend-label">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="chart-empty">Nenhuma receita paga no mês.</div>
              )}
            </div>
          </div>

          <div className="card dashboard-insights">
            <div className="card-header">
              <h3>Leituras rápidas</h3>
            </div>
            <div className="dashboard-insight-list">
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
              <div>
                <span>Itens esgotados</span>
                <strong>{formatNumber(metrics.itensEsgotados.length)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card table-container">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <h3
              onClick={() => setTableTab('Ativas')}
              className={tableTab === 'Ativas' ? 'dashboard-table-tab active' : 'dashboard-table-tab'}
            >
              Atendimentos em Andamento
            </h3>
            <h3
              onClick={() => setTableTab('Finalizadas')}
              className={tableTab === 'Finalizadas' ? 'dashboard-table-tab active success' : 'dashboard-table-tab'}
            >
              Últimas Finalizadas
            </h3>
          </div>
          <button className="btn-secondary" onClick={() => navigate('/os')}>Ver Módulo OS</button>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Modelo</th>
                <th>Cliente</th>
                <th>Status OS</th>
                <th>Valor</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando dados...</td>
                </tr>
              ) : (tableTab === 'Ativas' ? metrics.osAtivas : metrics.osFinalizadas).length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                    {tableTab === 'Ativas' ? 'Não há atendimentos em andamento no momento.' : 'Nenhuma OS finalizada recentemente.'}
                  </td>
                </tr>
              ) : (
                (tableTab === 'Ativas' ? metrics.osAtivas : metrics.osFinalizadas).slice(0, 6).map((vehicle) => {
                  const color = vehicle.statusColor || '#8b5cf6';
                  return (
                    <tr key={vehicle.id}>
                      <td className="font-medium" style={{ textTransform: 'uppercase' }}>{vehicle.placa || '-'}</td>
                      <td>{vehicle.modelo || '-'}</td>
                      <td>{vehicle.clienteNome || '-'}</td>
                      <td>
                        <span className="status-badge" style={{ backgroundColor: `${color}20`, color }}>
                          <span className="status-dot" style={{ backgroundColor: color }}></span>
                          {vehicle.status}
                        </span>
                      </td>
                      <td className="font-medium">{formatMoney(Number(vehicle.valorTotal || vehicle.total || 0))}</td>
                      <td>
                        <button className="icon-btn" onClick={() => navigate(`/os/editar/${vehicle.id}`)} title="Ver Detalhes">
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
      </div>
    </div>
  );
};

export default Dashboard;
