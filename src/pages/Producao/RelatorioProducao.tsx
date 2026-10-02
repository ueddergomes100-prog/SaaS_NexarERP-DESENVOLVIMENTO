import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Factory, ClipboardList, CheckCircle2, XCircle, Clock, Activity, TrendingDown, FileText, Undo2
} from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import StatCard from '../../components/Reports/StatCard';
import ChartWrapper from '../../components/Reports/ChartWrapper';
import ReportFilter from '../../components/Reports/ReportFilter';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, parseISO } from 'date-fns';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  formatarPercentualProducao,
  formatarQuantidade,
  montarDocumentoProducao,
  ordensNoPeriodo,
  resumirProducao,
  type OrdemDoRelatorio,
} from '../../utils/relatorioProducaoDomain';

/*
 * Painel de producao. As contas moram em relatorioProducaoDomain.ts: os
 * cartoes, os graficos, as tabelas e o PDF do "Gerar relatorio"
 * (RelatorioPreview, padrao de 2026-09-23) usam o mesmo resumo.
 */

const COLORS = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

const isoDoDia = (data: Date): string => (Number.isNaN(data.getTime()) ? '' : format(data, 'yyyy-MM-dd'));

const RelatorioProducao: React.FC = () => {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [previewAberto, setPreviewAberto] = useState(false);

  const [ordens, setOrdens] = useState<OrdemDoRelatorio[]>([]);

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(collection(db, 'ordens_producao'), where('tenantId', '==', tenantId));
      const snap = await getDocs(q);
      setOrdens(snap.docs.map(d => {
        const x = d.data();
        return {
          id: d.id,
          produtoNome: x.produtoNome,
          quantidadePlanejada: x.quantidadePlanejada,
          quantidadeProduzida: x.quantidadeProduzida,
          status: String(x.status || ''),
          responsavelNome: x.responsavelNome,
          itensConsumidos: Array.isArray(x.itensConsumidos) ? x.itensConsumidos : [],
          criadoEm: x.createdAt?.toDate ? x.createdAt.toDate() : null,
        };
      }));
    } catch (err) {
      console.error('Erro ao carregar ordens de produção:', err);
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

  const stats = useMemo(() => resumirProducao(ordensNoPeriodo(ordens, periodo)), [ordens, periodo]);

  const documento = useMemo<DocumentoRelatorioSemEmpresa>(() => montarDocumentoProducao(ordens, periodo), [ordens, periodo]);

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="producao"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Relatório de Produção', isoDoDia(periodo.inicio), isoDoDia(periodo.fim))}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar"
      />
    );
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '16px' }}>
      <div className="spin-icon" style={{ width: '40px', height: '40px', border: '4px solid var(--accent-purple)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <p style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Carregando dados de produção...</p>
    </div>
  );

  return (
    <div className="relatorio-caixa-alta" style={{ display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Factory size={32} color="var(--accent-purple)" />
            Relatório de Produção
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px' }}>Volume de ordens, eficiência e perdas de matéria-prima</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => setPreviewAberto(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} /> Gerar relatório
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
          title="Estornadas"
          value={String(stats.qtdEstornadas)}
          icon={Undo2}
          color="#64748b"
          subtitle="Finalizadas e depois revertidas"
        />
        <StatCard
          title="Eficiência de Produção"
          value={formatarPercentualProducao(stats.eficiencia)}
          icon={TrendingDown}
          color="#8b5cf6"
          subtitle={`${formatarQuantidade(stats.produzidoTotal)} produzidas de ${formatarQuantidade(stats.planejadoTotal)} planejadas`}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
        <ChartWrapper title="Ordens de Produção por Dia" icon={Activity} flex={2}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.porDia.map((d) => ({ name: d.rotulo, qtd: d.qtd }))}>
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
                data={stats.porStatus.map((s) => ({ name: s.status, value: s.qtd }))}
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
                      <td><strong>{formatarQuantidade(item.produzido)}</strong></td>
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
                    <th>Produção Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.porResponsavel.map(item => (
                    <tr key={item.nome}>
                      <td>{item.nome}</td>
                      <td>{item.ordens}</td>
                      <td><strong>{formatarQuantidade(item.produzido)}</strong></td>
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
        {stats.perdas.length === 0 ? (
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
                {stats.perdas.map(item => (
                  <tr key={item.materiaPrimaId}>
                    <td>{item.nome}</td>
                    <td style={{ color: '#ef4444', fontWeight: 700 }}>{formatarQuantidade(item.quantidade)} {item.unidade}</td>
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
        {stats.sobras.length === 0 ? (
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
                {stats.sobras.map(item => (
                  <tr key={item.materiaPrimaId}>
                    <td>{item.nome}</td>
                    <td style={{ color: '#10b981', fontWeight: 700 }}>{formatarQuantidade(item.quantidade)} {item.unidade}</td>
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
