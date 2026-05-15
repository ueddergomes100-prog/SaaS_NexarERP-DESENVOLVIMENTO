import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart2, DollarSign, Package, XCircle, ShoppingCart, 
  TrendingUp, Users, Target, Calendar, Download, 
  ArrowUpRight, ArrowDownRight, Percent, Award, Briefcase, FileText
} from 'lucide-react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from '../../components/Reports/StatCard';
import ChartWrapper from '../../components/Reports/ChartWrapper';
import ReportFilter from '../../components/Reports/ReportFilter';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO, subMonths } from 'date-fns';

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];

const RelatoriosVendas: React.FC = () => {
  console.log('RelatoriosVendas mounting...');
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  const [data, setData] = useState<{
    pedidos: any[];
    orcamentos: any[];
    estoque: Record<string, any>;
    usuarios: Record<string, any>;
  }>({
    pedidos: [],
    orcamentos: [],
    estoque: {},
    usuarios: {}
  });

  const carregarDados = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Pedidos
      const qVendas = query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId));
      const snapVendas = await getDocs(qVendas);
      const pedidos = snapVendas.docs.map(d => ({ id: d.id, ...d.data() }));

      // Orçamentos (para conversão)
      const qOrc = query(collection(db, 'orcamentos'), where('tenantId', '==', tenantId));
      const snapOrc = await getDocs(qOrc);
      const orcamentos = snapOrc.docs.map(d => ({ id: d.id, ...d.data() }));

      // Estoque (para custo/lucro)
      const qEst = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapEst = await getDocs(qEst);
      const estoque: Record<string, any> = {};
      snapEst.forEach(d => { estoque[d.id] = d.data(); });

      // Usuários
      const qUser = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const snapUser = await getDocs(qUser);
      const usuarios: Record<string, any> = {};
      snapUser.forEach(d => { usuarios[d.id] = d.data(); });

      setData({ pedidos, orcamentos, estoque, usuarios });
    } catch (err) {
      console.error("Erro ao carregar dados dos relatórios:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [tenantId]);

  // Filtro de Período
  const filteredData = useMemo(() => {
    let start = startOfDay(new Date());
    let end = endOfDay(new Date());

    switch (period) {
      case 'hoje':
        start = startOfDay(new Date());
        end = endOfDay(new Date());
        break;
      case 'ontem':
        start = startOfDay(subDays(new Date(), 1));
        end = endOfDay(subDays(new Date(), 1));
        break;
      case 'semana':
        start = startOfDay(subDays(new Date(), 7));
        end = endOfDay(new Date());
        break;
      case 'mes':
        start = startOfMonth(new Date());
        end = endOfMonth(new Date());
        break;
      case 'ano':
        start = startOfYear(new Date());
        end = endOfMonth(new Date());
        break;
      case 'personalizado':
        start = startOfDay(parseISO(startDate));
        end = endOfDay(parseISO(endDate));
        break;
    }

    const pedidosFiltrados = data.pedidos.filter(p => {
      const date = p.createdAt?.toDate ? p.createdAt.toDate() : null;
      return date && isWithinInterval(date, { start, end });
    });

    const orcamentosFiltrados = data.orcamentos.filter(o => {
      const date = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      return date && isWithinInterval(date, { start, end });
    });

    return { pedidosFiltrados, orcamentosFiltrados };
  }, [data, period, startDate, endDate]);

  // Processamento de Métricas
  const stats = useMemo(() => {
    const { pedidosFiltrados, orcamentosFiltrados } = filteredData;
    
    let faturamentoBruto = 0;
    let totalDescontos = 0;
    let custoTotal = 0;
    let qtdVendas = 0;
    let qtdCanceladas = 0;
    const porFormaPgto: Record<string, { valor: number, qtd: number }> = {};
    const porVendedor: Record<string, { nome: string, total: number, qtd: number, lucro: number }> = {};
    const porProduto: Record<string, { nome: string, qtd: number, total: number, lucro: number, estoque: number }> = {};
    const timelineData: Record<string, { name: string, vendas: number, faturamento: number }> = {};

    pedidosFiltrados.forEach(p => {
      if (p.status === 'Cancelada') {
        qtdCanceladas++;
        return;
      }

      qtdVendas++;
      const valor = Number(p.valorTotal) || 0;
      const descontos = Number(p.valorTotalDescontos) || 0;
      faturamentoBruto += valor;
      totalDescontos += descontos;

      // Timeline (agrupar por dia)
      const dateKey = p.createdAt?.toDate ? format(p.createdAt.toDate(), 'dd/MM') : '---';
      if (!timelineData[dateKey]) timelineData[dateKey] = { name: dateKey, vendas: 0, faturamento: 0 };
      timelineData[dateKey].vendas += 1;
      timelineData[dateKey].faturamento += valor;

      // Forma de Pagamento
      const pgto = p.formaPagamento || 'Não Informado';
      if (!porFormaPgto[pgto]) porFormaPgto[pgto] = { valor: 0, qtd: 0 };
      porFormaPgto[pgto].valor += valor;
      porFormaPgto[pgto].qtd += 1;

      // Vendedor (Baseado no usuarioResponsavelId ou similar)
      const vendId = p.usuarioResponsavelId || 'admin';
      const vendNome = data.usuarios[vendId]?.nome || data.usuarios[vendId]?.email || 'ADMINISTRADOR';
      if (!porVendedor[vendId]) porVendedor[vendId] = { nome: vendNome, total: 0, qtd: 0, lucro: 0 };
      porVendedor[vendId].total += valor;
      porVendedor[vendId].qtd += 1;

      // Itens (Produtos e Lucro)
      if (p.itens && Array.isArray(p.itens)) {
        p.itens.forEach((item: any) => {
          const qtd = Number(item.quantidade) || 0;
          const subtotal = Number(item.subtotal) || 0;
          const custo = Number(data.estoque[item.id]?.precoCusto) || 0;
          
          const itemCusto = custo * qtd;
          custoTotal += itemCusto;
          
          const itemLucro = subtotal - itemCusto;
          if (porVendedor[vendId]) porVendedor[vendId].lucro += itemLucro;

          const productId = item.id === 'avulso' ? `avulso_${item.nome}` : item.id;
          if (!porProduto[productId]) {
            porProduto[productId] = { 
              nome: item.nome, 
              qtd: 0, 
              total: 0, 
              lucro: 0, 
              estoque: data.estoque[item.id]?.quantidade || 0 
            };
          }
          porProduto[productId].qtd += qtd;
          porProduto[productId].total += subtotal;
          porProduto[productId].lucro += itemLucro;
        });
      }
    });

    // Conversão de Orçamentos
    const totalOrc = orcamentosFiltrados.length;
    const convertidos = orcamentosFiltrados.filter(o => o.status === 'Finalizado' || o.status === 'Convertido').length;
    const recusados = orcamentosFiltrados.filter(o => o.status === 'Recusado').length;
    const pendentesOrc = orcamentosFiltrados.filter(o => o.status === 'Pendente' || o.status === 'Aprovado').length;
    const taxaConversao = totalOrc > 0 ? (convertidos / totalOrc) * 100 : 0;

    return {
      faturamentoBruto,
      totalDescontos,
      lucroLiquido: faturamentoBruto - custoTotal,
      ticketMedio: qtdVendas > 0 ? faturamentoBruto / qtdVendas : 0,
      qtdVendas,
      qtdCanceladas,
      taxaConversao,
      totalOrc,
      convertidos,
      recusados,
      pendentesOrc,
      custoTotal,
      porFormaPgto: Object.entries(porFormaPgto).map(([name, data]) => ({ name, value: data.valor, qtd: data.qtd })),
      rankingVendedores: Object.values(porVendedor).sort((a, b) => b.total - a.total),
      rankingProdutos: Object.values(porProduto).sort((a, b) => b.qtd - a.qtd).slice(0, 10),
      timeline: Object.values(timelineData),
      abcCurva: Object.values(porProduto).sort((a, b) => b.total - a.total)
    };
  }, [filteredData, data]);

  const handleExportCSV = () => {
    const headers = ['Data', 'Vendedor', 'Cliente', 'Valor', 'Status'];
    const rows = filteredData.pedidosFiltrados.map(p => [
      p.createdAt?.toDate ? format(p.createdAt.toDate(), 'dd/MM/yyyy HH:mm') : '',
      data.usuarios[p.usuarioResponsavelId]?.nome || 'Admin',
      p.clienteNome,
      p.valorTotal,
      p.status
    ]);
    
    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_vendas_${period}.csv`);
    document.body.appendChild(link);
    link.click();
  };

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
      <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Processando inteligência de vendas...</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <BarChart2 size={32} color="var(--accent-purple)" />
            Relatórios Estratégicos de Vendas
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>Análise detalhada de performance, faturamento e conversão</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> PDF
          </button>
          <button className="btn-secondary" onClick={handleExportCSV} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={18} /> Excel (CSV)
          </button>
        </div>
      </div>

      {/* Filters */}
      <ReportFilter 
        period={period} 
        setPeriod={setPeriod} 
        startDate={startDate} 
        setStartDate={setStartDate} 
        endDate={endDate} 
        setEndDate={setEndDate}
        onSearch={carregarDados}
      />

      {/* Primary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <StatCard 
          title="Faturamento Bruto" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.faturamentoBruto)} 
          icon={DollarSign} 
          color="#10b981" 
          subtitle={`${stats.qtdVendas} vendas realizadas`}
        />
        <StatCard 
          title="Lucro Líquido Estimado" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.lucroLiquido)} 
          icon={TrendingUp} 
          color="#8b5cf6" 
          subtitle={`Margem de ${stats.faturamentoBruto > 0 ? ((stats.lucroLiquido / stats.faturamentoBruto) * 100).toFixed(1) : 0}%`}
        />
        <StatCard 
          title="Ticket Médio" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.ticketMedio)} 
          icon={Target} 
          color="#3b82f6" 
        />
        <StatCard 
          title="Taxa de Conversão" 
          value={`${stats.taxaConversao.toFixed(1)}%`} 
          icon={Percent} 
          color="#f59e0b" 
          subtitle={`${stats.convertidos} de ${stats.totalOrc} orçamentos`}
        />
      </div>

      {/* Charts Section 1 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        <ChartWrapper title="Evolução de Vendas (Faturamento por Dia)" icon={TrendingUp}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.timeline}>
                <defs>
                  <linearGradient id="colorFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value: number) => `R$${value}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
                <Area type="monotone" dataKey="faturamento" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorFat)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Faturamento por Pagamento" icon={DollarSign} height={300}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.porFormaPgto}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {stats.porFormaPgto.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Ranking Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
        {/* Ranking Vendedores */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Award size={22} color="#f59e0b" /> Ranking de Vendedores
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {stats.rankingVendedores.map((vend, idx) => (
              <div key={idx} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '16px', 
                padding: '16px', 
                backgroundColor: 'var(--bg-tertiary)', 
                borderRadius: '12px',
                border: idx === 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid transparent'
              }}>
                <div style={{ 
                  width: '32px', height: '32px', borderRadius: '50%', backgroundColor: idx === 0 ? '#f59e0b' : 'var(--border-color)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '14px',
                  color: idx === 0 ? 'white' : 'var(--text-primary)' 
                }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{vend.nome}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{vend.qtd} pedidos realizados</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, color: '#10b981' }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(vend.total)}</div>
                  <div style={{ fontSize: '11px', color: '#8b5cf6', fontWeight: 600 }}>LUCRO: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(vend.lucro)}</div>
                </div>
              </div>
            ))}
            {stats.rankingVendedores.length === 0 && <p style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhum vendedor com dados.</p>}
          </div>
        </div>

        {/* Top Produtos */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Package size={22} color="#3b82f6" /> Top 10 Produtos Mais Vendidos
            </h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>Produto</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center' }}>Vendas</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Receita</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Lucro</th>
                </tr>
              </thead>
              <tbody>
                {stats.rankingProdutos.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>{p.nome}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <span style={{ backgroundColor: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>{p.qtd}</span>
                    </td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.total)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#8b5cf6', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.lucro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Operational Analysis */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {/* Cancelamentos */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', borderTop: '4px solid #ef4444' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <XCircle size={18} /> Cancelamentos e Perdas
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>PEDIDOS CANCELADOS</div>
                <div style={{ fontSize: '24px', fontWeight: 800 }}>{stats.qtdCanceladas}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>VALOR PERDIDO ESTIMADO</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#ef4444' }}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.pedidos.filter(p => p.status === 'Cancelada').reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Orçamentos em Aberto */}
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', borderTop: '4px solid #f59e0b' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Target size={18} /> Pipeline de Orçamentos
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>PENDENTES</div>
              <div style={{ fontSize: '18px', fontWeight: 800 }}>{stats.pendentesOrc}</div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>RECUSADOS</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#ef4444' }}>{stats.recusados}</div>
            </div>
            <div style={{ padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px', textAlign: 'center', gridColumn: 'span 2' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>VALOR EM POTENCIAL (ORÇAMENTOS EM ABERTO)</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#f59e0b' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(filteredData.orcamentosFiltrados.filter(o => o.status === 'Pendente' || o.status === 'Aprovado').reduce((acc, o) => acc + (Number(o.valorTotal) || 0), 0))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Section - ABC and Dead Stock */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Package size={22} color="#ec4899" /> Produtos sem Movimentação (Estoque Parado)
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px' }}>
            Estes produtos estão cadastrados no estoque mas não tiveram nenhuma venda no período selecionado.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px' }}>Produto</th>
                  <th style={{ padding: '12px 8px' }}>Categoria</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center' }}>Qtd. Atual</th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>Valor em Estoque (Custo)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.estoque)
                  .filter(([id]) => !stats.rankingProdutos.some(rp => rp.nome === data.estoque[id].nome))
                  .slice(0, 10)
                  .map(([id, p], i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px 8px', fontWeight: 500 }}>{p.nome}</td>
                      <td style={{ padding: '12px 8px' }}>{p.categoria || 'Diversos'}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span style={{ color: p.quantidade <= (p.estoqueMinimo || 0) ? '#ef4444' : 'inherit', fontWeight: 600 }}>
                          {p.quantidade}
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((p.precoCusto || 0) * p.quantidade)}
                      </td>
                    </tr>
                  ))}
                {Object.keys(data.estoque).length === 0 && (
                   <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Sem dados de estoque.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RelatoriosVendas;
