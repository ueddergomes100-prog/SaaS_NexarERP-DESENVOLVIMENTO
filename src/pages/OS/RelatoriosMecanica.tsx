import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Wrench, DollarSign, Clock, CheckCircle,
  TrendingUp, Users,
  ClipboardList, Package, Activity, FileText
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from '../../components/Reports/StatCard';
import ChartWrapper from '../../components/Reports/ChartWrapper';
import ReportFilter from '../../components/Reports/ReportFilter';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, parseISO } from 'date-fns';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  formatarPercentual,
  montarDocumentoServicosOficina,
  osNoPeriodo,
  resumirServicosOficina,
  type OsDoRelatorio,
} from '../../utils/relatorioServicosOficinaDomain';

/*
 * Painel de servicos da oficina. As contas moram em
 * relatorioServicosOficinaDomain.ts: os cartoes, os graficos e o PDF do
 * "Gerar relatorio" (RelatorioPreview, padrao de 2026-09-23) usam o mesmo resumo.
 */

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4'];

const moedaBr = (valorCentavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorCentavos / 100);

const isoDoDia = (data: Date): string => (Number.isNaN(data.getTime()) ? '' : format(data, 'yyyy-MM-dd'));

const RelatoriosMecanica: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [previewAberto, setPreviewAberto] = useState(false);

  const [data, setData] = useState<{
    os: OsDoRelatorio[];
    usuarios: Record<string, { nome?: string }>;
  }>({
    os: [],
    usuarios: {}
  });

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qOS = query(collection(db, 'ordens_de_servico'), where('tenantId', '==', tenantId));
      const snapOS = await getDocs(qOS);
      const os: OsDoRelatorio[] = snapOS.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          status: x.status,
          criadoEm: x.createdAt?.toDate ? x.createdAt.toDate() : null,
          servicos: Array.isArray(x.servicos) ? x.servicos : [],
          pecas: Array.isArray(x.pecas) ? x.pecas : [],
          totalTaxasPagamentoCentavos: x.totalTaxasPagamentoCentavos,
          totalTaxasPagamento: x.totalTaxasPagamento,
          mecanicoId: x.mecanicoId,
          mecanicoNome: x.mecanicoNome,
        };
      });

      const qUser = query(collection(db, 'usuarios'), where('tenantId', '==', tenantId));
      const snapUser = await getDocs(qUser);
      const usuarios: Record<string, { nome?: string }> = {};
      snapUser.forEach(d => { usuarios[d.id] = { nome: d.data().nome }; });

      setData({ os, usuarios });
    } catch (err) {
      console.error("Erro ao carregar dados de serviços:", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const periodo = useMemo(() => {
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

    return { inicio: start, fim: end };
  }, [period, startDate, endDate]);

  const stats = useMemo(
    () => resumirServicosOficina(osNoPeriodo(data.os, periodo), data.usuarios),
    [data, periodo],
  );

  const documento = useMemo<DocumentoRelatorioSemEmpresa>(
    () => montarDocumentoServicosOficina(data.os, data.usuarios, periodo),
    [data, periodo],
  );

  const servicosVsPecas = [
    { name: 'Serviços', value: stats.servicosCentavos / 100 },
    { name: 'Peças', value: stats.pecasCentavos / 100 },
  ];

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="servicos-oficina"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Relatório de Serviços', isoDoDia(periodo.inicio), isoDoDia(periodo.fim))}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar"
      />
    );
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
      <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Sincronizando dados técnicos...</p>
    </div>
  );

  return (
    <div className="relatorio-caixa-alta" style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
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
          <button className="btn-primary" onClick={() => setPreviewAberto(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Gerar relatório
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
          title="Faturamento Bruto"
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.brutoCentavos / 100)} 
          icon={DollarSign} 
          color="#10b981" 
          subtitle={`${stats.qtdConcluidas} OS finalizadas`}
        />
        <StatCard
          title="Taxas de Cartão"
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.taxasCentavos / 100)}
          icon={DollarSign}
          color="#f59e0b"
          subtitle="Dedução financeira"
        />
        <StatCard
          title="Receita Líquida"
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.liquidoCentavos / 100)}
          icon={TrendingUp}
          color="#10b981"
          subtitle="Após taxas de cartão"
        />
        <StatCard 
          title="Faturamento só Serviços" 
          value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.servicosCentavos / 100)} 
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
            <AreaChart data={stats.porDia.map((d) => ({ name: d.rotulo, qtd: d.qtd }))}>
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
                data={servicosVsPecas}
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
              {stats.porTecnico.map((mec, i) => (
                <tr key={mec.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
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
                  <td style={{ padding: '16px 8px', textAlign: 'right', color: '#8b5cf6', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.servicosCentavos / 100)}</td>
                  <td style={{ padding: '16px 8px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.pecasCentavos / 100)}</td>
                  <td style={{ padding: '16px 8px', textAlign: 'right', fontWeight: 800 }}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(mec.totalCentavos / 100)}</td>
                </tr>
              ))}
              {stats.porTecnico.length === 0 && (
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
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.porStatus.map((s) => ({ name: s.status, value: s.qtd }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={12} />
              <YAxis stroke="var(--text-muted)" fontSize={12} allowDecimals={false} />
              <Tooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="value" name="OS" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <CheckCircle size={22} color="#10b981" /> Resumo Operacional
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Média de Valor por OS</span>
              <span style={{ fontWeight: 700, fontSize: '18px' }}>
                {moedaBr(stats.mediaPorOsCentavos)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Participação de Serviços</span>
              <span style={{ fontWeight: 700, color: '#8b5cf6' }}>
                {formatarPercentual(stats.participacaoServicos)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)' }}>Participação de Peças</span>
              <span style={{ fontWeight: 700, color: '#10b981' }}>
                {formatarPercentual(stats.participacaoPecas)}
              </span>
            </div>
            <div style={{ marginTop: '10px', padding: '16px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>EFICIÊNCIA DE CONCLUSÃO</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ 
                    width: `${stats.eficienciaConclusao}%`, 
                    height: '100%', 
                    backgroundColor: '#10b981' 
                  }}></div>
                </div>
                <span style={{ fontWeight: 800, fontSize: '16px' }}>
                  {formatarPercentual(stats.eficienciaConclusao, 0)}
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
