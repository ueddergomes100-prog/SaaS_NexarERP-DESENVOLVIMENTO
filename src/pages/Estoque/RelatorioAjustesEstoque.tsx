import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ClipboardList, PackagePlus, PackageMinus } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import StatCard from '../../components/Reports/StatCard';
import ReportFilter from '../../components/Reports/ReportFilter';
import {
  format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO,
} from 'date-fns';
import {
  MOTIVOS_AJUSTE_ENTRADA,
  MOTIVOS_AJUSTE_SAIDA,
  labelMotivoAjusteEstoque,
  type TipoAjusteEstoque,
} from '../../utils/ajusteEstoqueDomain';
import './Estoque.css';

interface AjusteRegistro {
  id: string;
  produtoNome: string;
  produtoCodigo?: string;
  tipo: TipoAjusteEstoque;
  quantidade: number;
  motivo: string;
  observacao?: string;
  lote?: string;
  validade?: string;
  quantidadeAntes: number;
  quantidadeDepois: number;
  usuarioNome: string;
  createdAt?: { toDate: () => Date } | null;
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const RelatorioAjustesEstoque: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();

  const [ajustes, setAjustes] = useState<AjusteRegistro[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [tipoFiltro, setTipoFiltro] = useState<'todos' | TipoAjusteEstoque>('todos');
  const [motivoFiltro, setMotivoFiltro] = useState('');
  const [produtoFiltro, setProdutoFiltro] = useState('');
  const [usuarioFiltro, setUsuarioFiltro] = useState('');

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const q = query(collection(db, 'ajustes_estoque'), where('tenantId', '==', tenantId));
      const snap = await getDocs(q);
      const lista: AjusteRegistro[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          produtoNome: data.produtoNome || '',
          produtoCodigo: data.produtoCodigo,
          tipo: data.tipo,
          quantidade: Number(data.quantidade || 0),
          motivo: data.motivo || '',
          observacao: data.observacao,
          lote: data.lote,
          validade: data.validade,
          quantidadeAntes: Number(data.quantidadeAntes || 0),
          quantidadeDepois: Number(data.quantidadeDepois || 0),
          usuarioNome: data.usuarioNome || '',
          createdAt: data.createdAt,
        };
      });
      setAjustes(lista);
    } catch (err) {
      console.error('Erro ao carregar relatório de ajustes de estoque:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const usuariosDisponiveis = useMemo(
    () => Array.from(new Set(ajustes.map((a) => a.usuarioNome).filter(Boolean))).sort(),
    [ajustes]
  );

  const motivoOptions = useMemo(() => {
    if (tipoFiltro === 'entrada') return MOTIVOS_AJUSTE_ENTRADA;
    if (tipoFiltro === 'saida') return MOTIVOS_AJUSTE_SAIDA;
    const combinados = [...MOTIVOS_AJUSTE_ENTRADA, ...MOTIVOS_AJUSTE_SAIDA];
    const vistos = new Set<string>();
    return combinados.filter((m) => {
      if (vistos.has(m.value)) return false;
      vistos.add(m.value);
      return true;
    });
  }, [tipoFiltro]);

  const filtrados = useMemo(() => {
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

    return ajustes
      .filter((a) => {
        const data = a.createdAt?.toDate ? a.createdAt.toDate() : null;
        const dentroPeriodo = data ? isWithinInterval(data, { start, end }) : true;
        const bateTipo = tipoFiltro === 'todos' || a.tipo === tipoFiltro;
        const bateMotivo = !motivoFiltro || a.motivo === motivoFiltro;
        const bateProduto = !produtoFiltro.trim() || a.produtoNome.toLowerCase().includes(produtoFiltro.trim().toLowerCase());
        const bateUsuario = !usuarioFiltro || a.usuarioNome === usuarioFiltro;
        return dentroPeriodo && bateTipo && bateMotivo && bateProduto && bateUsuario;
      })
      .sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
  }, [ajustes, period, startDate, endDate, tipoFiltro, motivoFiltro, produtoFiltro, usuarioFiltro]);

  const stats = useMemo(() => ({
    total: filtrados.length,
    totalEntradas: filtrados.filter((a) => a.tipo === 'entrada').reduce((soma, a) => soma + a.quantidade, 0),
    totalSaidas: filtrados.filter((a) => a.tipo === 'saida').reduce((soma, a) => soma + a.quantidade, 0),
  }), [filtrados]);

  const exportCsv = () => {
    const headers = ['Data', 'Produto', 'Código', 'Tipo', 'Quantidade', 'Motivo', 'Lote', 'Validade', 'Usuário', 'Observação'];
    const rows = filtrados.map((a) => [
      a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString('pt-BR') : '',
      a.produtoNome,
      a.produtoCodigo || '',
      a.tipo === 'entrada' ? 'Entrada' : 'Saída',
      a.quantidade,
      labelMotivoAjusteEstoque(a.tipo, a.motivo),
      a.lote || '',
      a.validade || '',
      a.usuarioNome,
      a.observacao || '',
    ]);
    const csv = '﻿' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-ajustes-estoque-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)' }}>
      Carregando relatório de ajustes...
    </div>
  );

  const selectStyle: React.CSSProperties = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)', minWidth: '150px' };
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' };

  return (
    <div className="estoque-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Relatório de Ajustes de Estoque</h1>
            <p className="page-subtitle">Trilha dos ajustes manuais registrados, com motivo e responsável.</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={exportCsv} disabled={filtrados.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Download size={18} /> Exportar CSV
        </button>
      </div>

      <ReportFilter
        period={period}
        setPeriod={setPeriod}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        onSearch={carregarDados}
        extraFilters={(
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={labelStyle}>Tipo</label>
              <select value={tipoFiltro} onChange={(e) => { setTipoFiltro(e.target.value as 'todos' | TipoAjusteEstoque); setMotivoFiltro(''); }} style={selectStyle}>
                <option value="todos">Todos</option>
                <option value="entrada">Entrada</option>
                <option value="saida">Saída</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={labelStyle}>Motivo</label>
              <select value={motivoFiltro} onChange={(e) => setMotivoFiltro(e.target.value)} style={selectStyle}>
                <option value="">Todos</option>
                {motivoOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={labelStyle}>Produto</label>
              <input type="text" value={produtoFiltro} onChange={(e) => setProdutoFiltro(e.target.value)} placeholder="Nome do produto" style={selectStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={labelStyle}>Usuário</label>
              <select value={usuarioFiltro} onChange={(e) => setUsuarioFiltro(e.target.value)} style={selectStyle}>
                <option value="">Todos</option>
                {usuariosDisponiveis.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </>
        )}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        <StatCard title="Total de Ajustes" value={String(stats.total)} icon={ClipboardList} color="#3b82f6" subtitle="No período selecionado" />
        <StatCard title="Total em Entradas" value={String(stats.totalEntradas)} icon={PackagePlus} color="#10b981" subtitle="Soma das quantidades" />
        <StatCard title="Total em Saídas" value={String(stats.totalSaidas)} icon={PackageMinus} color="#ef4444" subtitle="Soma das quantidades" />
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 8px' }}>Data</th>
                <th style={{ padding: '14px 8px' }}>Produto</th>
                <th style={{ padding: '14px 8px' }}>Tipo</th>
                <th style={{ padding: '14px 8px', textAlign: 'right' }}>Quantidade</th>
                <th style={{ padding: '14px 8px' }}>Motivo</th>
                <th style={{ padding: '14px 8px' }}>Lote / Validade</th>
                <th style={{ padding: '14px 8px' }}>Usuário</th>
                <th style={{ padding: '14px 8px' }}>Observação</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ padding: '12px 8px', fontWeight: 600 }}>{a.produtoNome}{a.produtoCodigo ? ` (${a.produtoCodigo})` : ''}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, backgroundColor: a.tipo === 'entrada' ? '#10b98122' : '#ef444422', color: a.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {a.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>{a.quantidade}</td>
                  <td style={{ padding: '12px 8px' }}>{labelMotivoAjusteEstoque(a.tipo, a.motivo)}</td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{a.lote ? `${a.lote}${a.validade ? ` — ${a.validade}` : ''}` : '-'}</td>
                  <td style={{ padding: '12px 8px' }}>{a.usuarioNome}</td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{a.observacao || '-'}</td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Nenhum ajuste encontrado para os filtros selecionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RelatorioAjustesEstoque;
