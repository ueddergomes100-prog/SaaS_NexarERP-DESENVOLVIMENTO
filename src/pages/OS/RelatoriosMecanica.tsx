import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wrench, DollarSign, Clock, CheckCircle, XCircle, 
  TrendingUp, Users, Calendar, Download, 
  User, ClipboardList, Package, Activity, FileText
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from '../../components/Reports/StatCard';
import ChartWrapper from '../../components/Reports/ChartWrapper';
import ReportFilter from '../../components/Reports/ReportFilter';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO } from 'date-fns';
import { getServiceTotal } from '../../utils/osServicePricing';

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];

const RelatoriosMecanica: React.FC = () => {
  console.log('RelatoriosMecanica mounting...');
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  const [data, setData] = useState<{
    os: any[];
    usuarios: Record<string, any>;
  }>({
    os: [],
    usuarios: {}
  });

  const carregarDados = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qOS = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId));
      const snapOS = await getDocs(qOS);
      const os = snapOS.docs.map(d => ({ id: d.id, ...d.data() }));

      const qUser = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const snapUser = await getDocs(qUser);
      const usuarios: Record<string, any> = {};
      snapUser.forEach(d => { usuarios[d.id] = d.data(); });

      setData({ os, usuarios });
    } catch (err) {
      console.error("Erro ao carregar dados de serviços:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, [tenantId]);

  const filteredData = useMemo(() => {
    let start = startOfDay(new Date());
    let end = endOfDay(new Date());

    switch (period) {
      case 'hoje': start = startOfDay(new Date()); end = endOfDay(new Date()); break;
      case 'ontem': start = startOfDay(subDays(new Date(), 1)); end = endOfDay(subDays(new Date(), 1)); break;
      case 'semana': start = startOfDay(subDays(new Date(), 7)); end = endOfDay(new Date()); break;
      case 'mes': start = startOfMonth(new Date()); end = endOfMonth(new Date()); break;
      case 'ano': start = startOfYear(new Date()); end = endOfMonth(new Date()); break;
      case 'personalizado': start = startOfDay(parseISO(startDate)); end = endOfDay(parseISO(endDate)); break;
    }

    const osFiltradas = data.os.filter(o => {
      const date = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      return date && isWithinInterval(date, { start, end });
    });

    return osFiltradas;
  }, [data, period, startDate, endDate]);

  const stats = useMemo(() => {
    let receitaTotal = 0;
    let receitaServicos = 0;
    let receitaPecas = 0;
    let qtdConcluidas = 0;
    let qtdAbertas = 0;
    let qtdCanceladas = 0;
    
    const porMecanico: Record<string, { nome: string, total: number, qtd: number, servicos: number, pecas: number }> = {};
    const porStatus: Record<string, { name: string, value: number }> = {};
    const timelineData: Record<string, { name: string, qtd: number, valor: number }> = {};

    filteredData.forEach(o => {
      const servicosValor = o.servicos?.reduce(
        (acc: number, s: any) => acc + getServiceTotal(s),
        0
      ) || 0;
      const pecasValor = o.pecas?.reduce(
        (acc: number, p: any) => acc + (Number(p.preco || 0) * Number(p.quantidade || 1)),
        0
      ) || 0;
      const valor = servicosValor + pecasValor;
      const status = o.status || 'Pendente';
      
      // Timeline
      const dateKey = o.createdAt?.toDate ? format(o.createdAt.toDate(), 'dd/MM') : '---';
      if (!timelineData[dateKey]) timelineData[dateKey] = { name: dateKey, qtd: 0, valor: 0 };
      timelineData[dateKey].qtd += 1;
      timelineData[dateKey].valor += valor;

      // Status
      if (!porStatus[status]) porStatus[status] = { name: status, value: 0 };
      porStatus[status].value += 1;

      if (status === 'Finalizada') {
        qtdConcluidas++;
        receitaTotal += valor;
        
        // Calcular serviços vs peças
        receitaServicos += servicosValor;
        receitaPecas += pecasValor;

        // Mecânico
        const mecId = o.mecanicoId || 'admin';
        const mecNome = o.mecanicoNome || data.usuarios[mecId]?.nome || 'ADMINISTRADOR';
        if (!porMecanico[mecId]) porMecanico[mecId] = { nome: mecNome, total: 0, qtd: 0, servicos: 0, pecas: 0 };
        porMecanico[mecId].total += valor;
        porMecanico[mecId].qtd += 1;
        porMecanico[mecId].servicos += servicosValor;
        porMecanico[mecId].pecas += pecasValor;
      } else if (status === 'Cancelada') {
        qtdCanceladas++;
      } else {
        qtdAbertas++;
      }
    });

    return {
      receitaTotal,
      receitaServicos,
      receitaPecas,
      qtdTotal: filteredData.length,
      qtdConcluidas,
      qtdAbertas,
      qtdCanceladas,
      porMecanico: Object.values(porMecanico).sort((a, b) => b.total - a.total),
      porStatus: Object.values(porStatus),
      timeline: Object.values(timelineData),
      servicosVsPecas: [
        { name: 'Serviços', value: receitaServicos },
        { name: 'Peças', value: receitaPecas }
      ]
    };
  }, [filteredData, data]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
      <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Sincronizando dados técnicos...</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Wrench size={32} color="var(--accent-purple)" />
            Relatórios de Serviços e Produtividade
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>Desempenho técnico, volume de ordens e faturamento de serviços</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Exportar PDF
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

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <StatCard 
          title="Faturamento (Serviços + Peças)" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.receitaTotal)} 
          icon={DollarSign} 
          color="#10b981" 
          subtitle={`${stats.qtdConcluidas} OS finalizadas`}
        />
        <StatCard 
          title="Faturamento só Serviços" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.receitaServicos)} 
          icon={TrendingUp} 
          color="#8b5cf6" 
          subtitle="Mão de obra técnica"
        />
        <StatCard 
          title="OS em Aberto" 
          value={String(stats.qtdAbertas)} 
          icon={Clock} 
          color="#f59e0b" 
          subtitle="Aguardando conclusão"
        />
        <StatCard 
          title="Volume Total" 
          value={String(stats.qtdTotal)} 
          icon={ClipboardList} 
          color="#3b82f6" 
          subtitle="No período selecionado"
        />
      </div>

      {/* Charts Section */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        <ChartWrapper title="Volume de OS por Dia" icon={Activity} flex={2}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.timeline}>
              <defs>
                <linearGradient id="colorOS" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <Area type="monotone" dataKey="qtd" stroke="#3b82f6" fillOpacity={1} fill="url(#colorOS)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Serviços vs Peças (R$)" icon={Package} height={300} flex={1}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.servicosVsPecas}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                <Cell fill="#8b5cf6" />
                <Cell fill="#10b981" />
              </Pie>
              <Tooltip />
              <Legend verticalAlign="bottom" height={36}/>
            </PieChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Ranking Technicians */}
      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={22} color="#8b5cf6" /> Produtividade de Técnicos / Mecânicos
          </h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '16px 8px' }}>Técnico</th>
                <th style={{ padding: '16px 8px', textAlign: 'center' }}>Qtd OS</th>
                <th style={{ padding: '16px 8px', textAlign: 'right' }}>Serviços (Mão de Obra)</th>
                <th style={{ padding: '16px 8px', textAlign: 'right' }}>Peças Vendidas</th>
                <th style={{ padding: '16px 8px', textAlign: 'right' }}>Total Gerado</th>
              </tr>
            </thead>
            <tbody>
              {stats.porMecanico.map((mec, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
                  <td style={{ padding: '16px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: COLORS[i % COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {mec.nome.charAt(0)}
                      </div>
                      <span style={{ fontWeight: 600 }}>{mec.nome}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 8px', textAlign: 'center' }}>
                    <span style={{ backgroundColor: 'var(--bg-tertiary)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700 }}>{mec.qtd}</span>
                  </td>
                  <td style={{ padding: '16px 8px', textAlign: 'right', color: '#8b5cf6', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.servicos)}</td>
                  <td style={{ padding: '16px 8px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.pecas)}</td>
                  <td style={{ padding: '16px 8px', textAlign: 'right', fontWeight: 800 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.total)}</td>
                </tr>
              ))}
              {stats.porMecanico.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Nenhuma OS finalizada no período para gerar ranking.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Operational Efficiency */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
        <ChartWrapper title="Status das Ordens (Volume)" icon={Activity} height={300}>
          <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Gráfico de Mecânicos Temporário</span>
          </div>
          {/* <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.porStatus}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} />
              <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
            </BarChart>
          </ResponsiveContainer> */}
        </ChartWrapper>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckCircle size={22} color="#10b981" /> Resumo Operacional
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Média de Valor por OS</span>
              <span style={{ fontWeight: 700, fontSize: '18px' }}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.qtdConcluidas > 0 ? stats.receitaTotal / stats.qtdConcluidas : 0)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Participação de Serviços</span>
              <span style={{ fontWeight: 700, color: '#8b5cf6' }}>
                {stats.receitaTotal > 0 ? ((stats.receitaServicos / stats.receitaTotal) * 100).toFixed(1) : 0}%
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Participação de Peças</span>
              <span style={{ fontWeight: 700, color: '#10b981' }}>
                {stats.receitaTotal > 0 ? ((stats.receitaPecas / stats.receitaTotal) * 100).toFixed(1) : 0}%
              </span>
            </div>
            <div style={{ marginTop: '10px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>EFICIÊNCIA DE CONCLUSÃO</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ 
                    width: `${stats.qtdTotal > 0 ? (stats.qtdConcluidas / stats.qtdTotal) * 100 : 0}%`, 
                    height: '100%', 
                    backgroundColor: '#10b981' 
                  }}></div>
                </div>
                <span style={{ fontWeight: 800, fontSize: '16px' }}>
                  {stats.qtdTotal > 0 ? ((stats.qtdConcluidas / stats.qtdTotal) * 100).toFixed(0) : 0}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RelatoriosMecanica;
