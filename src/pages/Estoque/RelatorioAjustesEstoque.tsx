import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, ClipboardList, PackagePlus, PackageMinus } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import StatCard from '../../components/Reports/StatCard';
import ReportFilter from '../../components/Reports/ReportFilter';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import {
  format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, parseISO,
} from 'date-fns';
import {
  MOTIVOS_AJUSTE_ENTRADA,
  MOTIVOS_AJUSTE_SAIDA,
  labelMotivoAjusteEstoque,
  type TipoAjusteEstoque,
} from '../../utils/ajusteEstoqueDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  ajustesDoRelatorio,
  formatarQuantidadeAjuste,
  loteValidadeAjuste,
  montarDocumentoRelatorioAjustes,
  resumirAjustes,
  type AjusteDoRelatorio,
  type FiltroRelatorioAjustes,
} from '../../utils/relatorioAjustesEstoqueDomain';
import './Estoque.css';

type AjusteRegistro = AjusteDoRelatorio;

const RelatorioAjustesEstoque: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();

  const [ajustes, setAjustes] = useState<AjusteRegistro[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewAberto, setPreviewAberto] = useState(false);

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
          ...(data.produtoCodigo ? { produtoCodigo: String(data.produtoCodigo) } : {}),
          ...(data.origem ? { origem: String(data.origem) } : {}),
          tipo: data.tipo,
          quantidade: Number(data.quantidade || 0),
          motivo: data.motivo || '',
          ...(data.observacao ? { observacao: String(data.observacao) } : {}),
          ...(data.lote ? { lote: String(data.lote) } : {}),
          ...(data.validade ? { validade: String(data.validade) } : {}),
          usuarioNome: data.usuarioNome || '',
          data: data.createdAt?.toDate ? data.createdAt.toDate() : null,
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

  const filtro = useMemo<FiltroRelatorioAjustes>(() => {
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
    return { inicio: start, fim: end, tipo: tipoFiltro, motivo: motivoFiltro, produto: produtoFiltro, usuario: usuarioFiltro };
  }, [period, startDate, endDate, tipoFiltro, motivoFiltro, produtoFiltro, usuarioFiltro]);

  const filtrados = useMemo(() => ajustesDoRelatorio(ajustes, filtro), [ajustes, filtro]);

  const stats = useMemo(() => resumirAjustes(filtrados), [filtrados]);

  /** O PDF sai com exatamente o que esta filtrado na tela. */
  const documento = useMemo<DocumentoRelatorioSemEmpresa>(() => montarDocumentoRelatorioAjustes({
    filtrados,
    filtro,
    rotuloMotivo: motivoOptions.find((m) => m.value === motivoFiltro)?.label,
  }), [filtrados, filtro, motivoOptions, motivoFiltro]);

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="estoque-ajustes"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Ajustes de Estoque', format(filtro.inicio, 'yyyy-MM-dd'), format(filtro.fim, 'yyyy-MM-dd'))}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar aos filtros"
      />
    );
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)' }}>
      Carregando relatório de ajustes...
    </div>
  );

  const selectStyle: React.CSSProperties = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)', minWidth: '150px' };
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' };

  return (
    <div className="estoque-page relatorio-caixa-alta">
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
        <button className="btn-primary" onClick={() => setPreviewAberto(true)} disabled={filtrados.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={18} /> Gerar relatório
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
              <input type="text" value={produtoFiltro} onChange={(e) => setProdutoFiltro(e.target.value)} placeholder="Nome do produto (ração+20kg)" style={selectStyle} />
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
        <StatCard title="Total em Entradas" value={formatarQuantidadeAjuste(stats.totalEntradas)} icon={PackagePlus} color="#10b981" subtitle="Soma das quantidades" />
        <StatCard title="Total em Saídas" value={formatarQuantidadeAjuste(stats.totalSaidas)} icon={PackageMinus} color="#ef4444" subtitle="Soma das quantidades" />
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
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{a.data ? a.data.toLocaleString('pt-BR') : '-'}</td>
                  <td style={{ padding: '12px 8px', fontWeight: 600 }}>{a.produtoNome}{a.produtoCodigo ? ` (${a.produtoCodigo})` : ''}{a.origem === 'materia_prima' && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 600, color: '#8b5cf6' }}>MATÉRIA-PRIMA</span>}{a.origem === 'insumo' && <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 600, color: '#0ea5e9' }}>INSUMO</span>}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, backgroundColor: a.tipo === 'entrada' ? '#10b98122' : '#ef444422', color: a.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                      {a.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>{formatarQuantidadeAjuste(a.quantidade)}</td>
                  <td style={{ padding: '12px 8px' }}>{labelMotivoAjusteEstoque(a.tipo, a.motivo)}</td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{loteValidadeAjuste(a) || '-'}</td>
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
