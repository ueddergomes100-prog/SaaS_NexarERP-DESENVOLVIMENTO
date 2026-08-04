import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Factory, ClipboardList, CheckCircle2, XCircle, Clock, Activity, TrendingDown, FileText
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from '../../components/Reports/StatCard';
import ChartWrapper from '../../components/Reports/ChartWrapper';
import ReportFilter from '../../components/Reports/ReportFilter';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO } from 'date-fns';

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

const STATUS_LABELS: Record<string, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

interface ItemConsumidoData {
  materiaPrimaId: string;
  materiaPrimaNome: string;
  unidade: string;
  quantidadeNecessaria?: number;
  perdaExtra?: number;
  sobra?: number;
  quantidadeConsumida: number;
}

interface OrdemProducaoData {
  id: string;
  numero: string;
  produtoNome: string;
  quantidadePlanejada: number;
  quantidadeProduzida: number | null;
  status: string;
  responsavelNome: string;
  itensConsumidos?: ItemConsumidoData[];
  createdAt: any;
}

const RelatorioProducao: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const [ordens, setOrdens] = useState<OrdemProducaoData[]>([]);

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(collection(db, 'ordens_producao'), where('tenantId', '==', tenantId));
      const snap = await getDocs(q);
      setOrdens(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrdemProducaoData)));
    } catch (err) {
      console.error('Erro ao carregar ordens de produção:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

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

    return ordens.filter(o => {
      const date = o.createdAt?.toDate ? o.createdAt.toDate() : null;
      return date && isWithinInterval(date, { start, end });
    });
  }, [ordens, period, startDate, endDate]);

  const stats = useMemo(() => {
    let qtdFinalizadas = 0;
    let qtdCanceladas = 0;
    let qtdEmAndamento = 0;
    let planejadoTotal = 0;
    let produzidoTotal = 0;

    const porStatus: Record<string, { name: string; value: number }> = {};
    const porProduto: Record<string, { nome: string; produzido: number; ordens: number }> = {};
    const porResponsavel: Record<string, { nome: string; ordens: number }> = {};
    const perdaPorMateriaPrima: Record<string, { nome: string; unidade: string; perda: number }> = {};
    const sobraPorMateriaPrima: Record<string, { nome: string; unidade: string; sobra: number }> = {};
    const timelineData: Record<string, { name: string; qtd: number }> = {};

    filteredData.forEach(o => {
      const statusLabel = STATUS_LABELS[o.status] || o.status;
      if (!porStatus[statusLabel]) porStatus[statusLabel] = { name: statusLabel, value: 0 };
      porStatus[statusLabel].value += 1;

      const dateKey = o.createdAt?.toDate ? format(o.createdAt.toDate(), 'dd/MM') : '---';
      if (!timelineData[dateKey]) timelineData[dateKey] = { name: dateKey, qtd: 0 };
      timelineData[dateKey].qtd += 1;

      planejadoTotal += Number(o.quantidadePlanejada || 0);

      if (o.status === 'finalizada') {
        qtdFinalizadas++;
        produzidoTotal += Number(o.quantidadeProduzida || 0);

        const produtoKey = o.produtoNome || 'Produto';
        if (!porProduto[produtoKey]) porProduto[produtoKey] = { nome: produtoKey, produzido: 0, ordens: 0 };
        porProduto[produtoKey].produzido += Number(o.quantidadeProduzida || 0);
        porProduto[produtoKey].ordens += 1;

        const respKey = o.responsavelNome || 'Sem responsável';
        if (!porResponsavel[respKey]) porResponsavel[respKey] = { nome: respKey, ordens: 0 };
        porResponsavel[respKey].ordens += 1;

        (o.itensConsumidos || []).forEach(item => {
          const perda = Number(item.perdaExtra || 0);
          if (perda > 0) {
            if (!perdaPorMateriaPrima[item.materiaPrimaId]) {
              perdaPorMateriaPrima[item.materiaPrimaId] = { nome: item.materiaPrimaNome, unidade: item.unidade, perda: 0 };
            }
            perdaPorMateriaPrima[item.materiaPrimaId].perda += perda;
          }

          const sobra = Number(item.sobra || 0);
          if (sobra > 0) {
            if (!sobraPorMateriaPrima[item.materiaPrimaId]) {
              sobraPorMateriaPrima[item.materiaPrimaId] = { nome: item.materiaPrimaNome, unidade: item.unidade, sobra: 0 };
            }
            sobraPorMateriaPrima[item.materiaPrimaId].sobra += sobra;
          }
        });
      } else if (o.status === 'cancelada') {
        qtdCanceladas++;
      } else {
        qtdEmAndamento++;
      }
    });

    const eficiencia = planejadoTotal > 0 ? (produzidoTotal / planejadoTotal) * 100 : 0;

    return {
      qtdTotal: filteredData.length,
      qtdFinalizadas,
      qtdCanceladas,
      qtdEmAndamento,
      planejadoTotal,
      produzidoTotal,
      eficiencia,
      porStatus: Object.values(porStatus),
      porProduto: Object.values(porProduto).sort((a, b) => b.produzido - a.produzido),
      porResponsavel: Object.values(porResponsavel).sort((a, b) => b.ordens - a.ordens),
      perdaPorMateriaPrima: Object.values(perdaPorMateriaPrima).sort((a, b) => b.perda - a.perda),
      sobraPorMateriaPrima: Object.values(sobraPorMateriaPrima).sort((a, b) => b.sobra - a.sobra),
      timeline: Object.values(timelineData),
    };
  }, [filteredData]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
      <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Carregando dados de produção...</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Factory size={32} color="var(--accent-purple)" />
            Relatório de Produção
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>Volume de ordens, eficiência e perdas de matéria-prima</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-secondary" onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Exportar PDF
          </button>
        </div>
      </div>

      <ReportFilter
        period={period}
        setPeriod={setPeriod}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        onSearch={carregarDados}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <StatCard
          title="Total de Ordens"
          value={String(stats.qtdTotal)}
          icon={ClipboardList}
          color="#3b82f6"
          subtitle="No período selecionado"
        />
        <StatCard
          title="Finalizadas"
          value={String(stats.qtdFinalizadas)}
          icon={CheckCircle2}
          color="#10b981"
          subtitle="Produção concluída"
        />
        <StatCard
          title="Em Andamento"
          value={String(stats.qtdEmAndamento)}
          icon={Clock}
          color="#f59e0b"
          subtitle="Criada, em produção ou pausada"
        />
        <StatCard
          title="Canceladas"
          value={String(stats.qtdCanceladas)}
          icon={XCircle}
          color="#ef4444"
          subtitle="Sem consumo de matéria-prima"
        />
        <StatCard
          title="Eficiência de Produção"
          value={`${stats.eficiencia.toFixed(1)}%`}
          icon={TrendingDown}
          color="#8b5cf6"
          subtitle={`${stats.produzidoTotal} produzidas de ${stats.planejadoTotal} planejadas`}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        <ChartWrapper title="Ordens de Produção por Dia" icon={Activity} flex={2}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.timeline}>
              <defs>
                <linearGradient id="colorOrdens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <Area type="monotone" dataKey="qtd" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorOrdens)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Ordens por Status" icon={Factory} height={300} flex={1}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={stats.porStatus}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {stats.porStatus.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                itemStyle={{ color: 'var(--text-primary)' }}
              />
              <Legend wrapperStyle={{ fontSize: '13px' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1, minWidth: '300px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0' }}>Produção por Produto</h3>
          {stats.porProduto.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma ordem finalizada no período.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Ordens</th>
                    <th>Quantidade Produzida</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.porProduto.map(item => (
                    <tr key={item.nome}>
                      <td>{item.nome}</td>
                      <td>{item.ordens}</td>
                      <td><strong>{item.produzido}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', flex: 1, minWidth: '300px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0' }}>Produção por Responsável</h3>
          {stats.porResponsavel.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma ordem finalizada no período.</p>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Responsável</th>
                    <th>Ordens Finalizadas</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.porResponsavel.map(item => (
                    <tr key={item.nome}>
                      <td>{item.nome}</td>
                      <td><strong>{item.ordens}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TrendingDown size={18} style={{ color: '#ef4444' }} />
          Perda de Matéria-Prima no Período
        </h3>
        <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
          Soma da perda extra registrada na conferência de finalização, além do previsto na composição de cada produto.
        </p>
        {stats.perdaPorMateriaPrima.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma perda extra registrada no período.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Matéria-Prima</th>
                  <th>Perda no período</th>
                </tr>
              </thead>
              <tbody>
                {stats.perdaPorMateriaPrima.map(item => (
                  <tr key={item.nome}>
                    <td>{item.nome}</td>
                    <td style={{ color: '#ef4444', fontWeight: 700 }}>{item.perda} {item.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <TrendingDown size={18} style={{ color: '#10b981', transform: 'scaleY(-1)' }} />
          Sobra de Matéria-Prima no Período
        </h3>
        <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
          Soma da sobra registrada na conferência de finalização — matéria-prima que voltou pro estoque em vez de ser descartada.
        </p>
        {stats.sobraPorMateriaPrima.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma sobra registrada no período.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Matéria-Prima</th>
                  <th>Sobra no período</th>
                </tr>
              </thead>
              <tbody>
                {stats.sobraPorMateriaPrima.map(item => (
                  <tr key={item.nome}>
                    <td>{item.nome}</td>
                    <td style={{ color: '#10b981', fontWeight: 700 }}>{item.sobra} {item.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default RelatorioProducao;
