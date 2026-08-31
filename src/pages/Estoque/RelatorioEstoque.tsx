import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Boxes, Download, DollarSign, AlertCircle, XCircle } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../components/Reports/StatCard';
import ReportFilter from '../../components/Reports/ReportFilter';
import {
  format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO,
} from 'date-fns';
import './Estoque.css';

interface ProdutoRelatorio {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  ncm: string;
  codigoBarras: string;
  quantidade: number;
  precoVenda: number;
  precoCusto: number;
  unidadeMedidaSigla?: string;
  createdAt?: { toDate: () => Date } | null;
}

interface ColunasVisiveis {
  quantidade: boolean;
  categoria: boolean;
  ncm: boolean;
  codigoBarras: boolean;
  preco: boolean;
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const RelatorioEstoque: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();

  const [produtos, setProdutos] = useState<ProdutoRelatorio[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroNcm, setFiltroNcm] = useState('');

  const [colunas, setColunas] = useState<ColunasVisiveis>({
    quantidade: true,
    categoria: true,
    ncm: false,
    codigoBarras: false,
    preco: true,
  });

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const qProdutos = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snapProdutos = await getDocs(qProdutos);
      const lista: ProdutoRelatorio[] = snapProdutos.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          nome: data.nome || '',
          codigo: data.codigo || '',
          categoria: data.categoria || '',
          ncm: data.ncm || data.fiscal?.ncm || '',
          codigoBarras: data.codigoBarras || '',
          quantidade: Number(data.quantidade || 0),
          precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
          precoCusto: Number(data.precoCusto ?? data.precos?.custo ?? 0),
          unidadeMedidaSigla: data.unidadeMedidaSigla,
          createdAt: data.createdAt,
        };
      });
      setProdutos(lista);

      const qCategorias = query(collection(db, 'categorias'), where('tenantId', '==', tenantId));
      const snapCategorias = await getDocs(qCategorias);
      const nomes = snapCategorias.docs.map((d) => d.data().nome).filter(Boolean);
      setCategorias(nomes);
    } catch (err) {
      console.error('Erro ao carregar relatório de estoque:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

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

    return produtos.filter((produto) => {
      const data = produto.createdAt?.toDate ? produto.createdAt.toDate() : null;
      const dentroPeriodo = data ? isWithinInterval(data, { start, end }) : true;
      const bateCategoria = !filtroCategoria || produto.categoria === filtroCategoria;
      const bateNcm = !filtroNcm.trim() || produto.ncm.includes(filtroNcm.trim());
      return dentroPeriodo && bateCategoria && bateNcm;
    });
  }, [produtos, period, startDate, endDate, filtroCategoria, filtroNcm]);

  const stats = useMemo(() => ({
    total: filtrados.length,
    valorEstoque: filtrados.reduce((soma, p) => soma + p.quantidade * (p.precoCusto || p.precoVenda || 0), 0),
    estoqueBaixo: filtrados.filter((p) => p.quantidade > 0 && p.quantidade < 5).length,
    esgotados: filtrados.filter((p) => p.quantidade <= 0).length,
  }), [filtrados]);

  const exportCsv = () => {
    const headers = ['Nome', 'Código', ...(colunas.quantidade ? ['Quantidade'] : []), ...(colunas.categoria ? ['Categoria'] : []), ...(colunas.ncm ? ['NCM'] : []), ...(colunas.codigoBarras ? ['Código de Barras'] : []), ...(colunas.preco ? ['Preço de Venda'] : [])];
    const rows = filtrados.map((p) => [
      p.nome,
      p.codigo,
      ...(colunas.quantidade ? [`${p.quantidade}${p.unidadeMedidaSigla ? ` ${p.unidadeMedidaSigla}` : ''}`] : []),
      ...(colunas.categoria ? [p.categoria] : []),
      ...(colunas.ncm ? [p.ncm] : []),
      ...(colunas.codigoBarras ? [p.codigoBarras] : []),
      ...(colunas.preco ? [p.precoVenda.toFixed(2)] : []),
    ]);
    const csv = '﻿' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-estoque-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleColuna = (chave: keyof ColunasVisiveis) => setColunas((prev) => ({ ...prev, [chave]: !prev[chave] }));

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)' }}>
      Carregando relatório de estoque...
    </div>
  );

  return (
    <div className="estoque-page relatorio-caixa-alta">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Relatório de Estoque</h1>
            <p className="page-subtitle">Posição de estoque com filtros por período, categoria e NCM.</p>
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
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Categoria</label>
              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)', minWidth: '160px' }}
              >
                <option value="">Todas</option>
                {categorias.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>NCM</label>
              <input
                type="text"
                value={filtroNcm}
                onChange={(e) => setFiltroNcm(e.target.value)}
                placeholder="Buscar por NCM"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </>
        )}
      />

      <div className="card" style={{ padding: '16px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Exibir colunas:</span>
        {(Object.keys(colunas) as Array<keyof ColunasVisiveis>).map((chave) => (
          <label key={chave} className="switch-row" style={{ minHeight: 'auto' }}>
            <input type="checkbox" checked={colunas[chave]} onChange={() => toggleColuna(chave)} />
            <span style={{ textTransform: 'capitalize' }}>
              {chave === 'codigoBarras' ? 'Código de Barras' : chave === 'ncm' ? 'NCM' : chave === 'preco' ? 'Preço' : chave}
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        <StatCard title="Total de Itens" value={String(stats.total)} icon={Boxes} color="#3b82f6" subtitle="No filtro atual" />
        <StatCard title="Valor em Estoque" value={currency.format(stats.valorEstoque)} icon={DollarSign} color="#10b981" subtitle="Quantidade × custo" />
        <StatCard title="Estoque Baixo" value={String(stats.estoqueBaixo)} icon={AlertCircle} color="#f59e0b" subtitle="Menos de 5 unidades" />
        <StatCard title="Itens Esgotados" value={String(stats.esgotados)} icon={XCircle} color="#ef4444" subtitle="Quantidade zerada" />
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 8px' }}>Produto</th>
                <th style={{ padding: '14px 8px' }}>Código</th>
                {colunas.quantidade && <th style={{ padding: '14px 8px', textAlign: 'right' }}>Quantidade</th>}
                {colunas.categoria && <th style={{ padding: '14px 8px' }}>Categoria</th>}
                {colunas.ncm && <th style={{ padding: '14px 8px' }}>NCM</th>}
                {colunas.codigoBarras && <th style={{ padding: '14px 8px' }}>Código de Barras</th>}
                {colunas.preco && <th style={{ padding: '14px 8px', textAlign: 'right' }}>Preço de Venda</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px 8px', fontWeight: 600 }}>{p.nome}</td>
                  <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{p.codigo}</td>
                  {colunas.quantidade && <td style={{ padding: '12px 8px', textAlign: 'right' }}>{p.quantidade}{p.unidadeMedidaSigla ? ` ${p.unidadeMedidaSigla}` : ''}</td>}
                  {colunas.categoria && <td style={{ padding: '12px 8px' }}>{p.categoria}</td>}
                  {colunas.ncm && <td style={{ padding: '12px 8px' }}>{p.ncm}</td>}
                  {colunas.codigoBarras && <td style={{ padding: '12px 8px' }}>{p.codigoBarras}</td>}
                  {colunas.preco && <td style={{ padding: '12px 8px', textAlign: 'right' }}>{currency.format(p.precoVenda)}</td>}
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Nenhum produto encontrado para os filtros selecionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RelatorioEstoque;
