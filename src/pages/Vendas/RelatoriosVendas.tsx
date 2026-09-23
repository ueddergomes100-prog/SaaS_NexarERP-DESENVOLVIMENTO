import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  FilterX,
  Loader2,
  Printer,
  Search,
  Users,
} from 'lucide-react';
import {
  dateInputToUtcEnd,
  dateInputToUtcStart,
  formatDateInputPtBr,
  getDateInputInTimeZone,
} from '../../utils/dateTime';
import { fromCents, toCents } from '../../utils/financeDomain';
import {
  enriquecerVendas,
  resumoPorVendedor,
  totaisVendas,
  vendaNoPeriodo,
} from '../../utils/relatorioVendasDomain';
import {
  indicadoresVendas,
  secaoDetalheVendas,
  secaoResumoVendedor,
  secaoVendasPorVendedorDetalhe,
} from '../../utils/relatorioVendasPdf';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { useDadosRelatorioVendas } from '../../hooks/useDadosRelatorioVendas';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import CampoComSugestoes from '../../components/common/CampoComSugestoes';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const number = new Intl.NumberFormat('pt-BR');

interface Filters {
  startDate: string;
  endDate: string;
  sellerId: string;
  customer: string;
  paymentMethod: string;
  paymentCondition: string;
  status: string;
  productId: string;
  category: string;
  minValue: string;
  maxValue: string;
}

const initialFilters = (): Filters => {
  const today = getDateInputInTimeZone();
  return {
    startDate: `${today.slice(0, 7)}-01`,
    endDate: today,
    sellerId: '',
    customer: '',
    paymentMethod: '',
    paymentCondition: '',
    status: '',
    productId: '',
    category: '',
    minValue: '',
    maxValue: '',
  };
};


const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
};

const RelatoriosVendas: React.FC = () => {
  const navigate = useNavigate();
  const { data, loading, error } = useDadosRelatorioVendas();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<'date' | 'number' | 'customer' | 'seller' | 'value' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [previewAberto, setPreviewAberto] = useState<'vendas' | 'vendedor' | null>(null);

  const options = useMemo(() => {
    const customers = Array.from(new Set(data.sales.map((sale) => String(sale.clienteNome || '')).filter(Boolean))).sort();
    const paymentMethods = Array.from(new Set(data.sales.flatMap((sale) => (
      Array.isArray(sale.pagamentos) && sale.pagamentos.length > 0
        ? sale.pagamentos.map((payment: any) => payment.formaPagamento)
        : [sale.formaPagamento]
    )).filter(Boolean))).sort();
    const statuses = Array.from(new Set(data.sales.map((sale) => String(sale.status || '')).filter(Boolean))).sort();
    const categories = Array.from(new Set(Object.values(data.products).map((product) => String(product.categoria || product.categoriaNome || '')).filter(Boolean))).sort();
    return { customers, paymentMethods, statuses, categories };
  }, [data]);

  const enrichedSales = useMemo(() => enriquecerVendas(data), [data]);

  const filteredSales = useMemo(() => {
    const start = dateInputToUtcStart(filters.startDate);
    const end = dateInputToUtcEnd(filters.endDate);
    const minCents = filters.minValue ? toCents(filters.minValue) : null;
    const maxCents = filters.maxValue ? toCents(filters.maxValue) : null;
    const customerSearch = filters.customer.trim().toLowerCase();

    const filtered = enrichedSales.filter((sale) => {
      if (!vendaNoPeriodo(sale, start, end)) return false;
      if (filters.sellerId && sale.sellerId !== filters.sellerId) return false;
      if (customerSearch && !String(sale.clienteNome || '').toLowerCase().includes(customerSearch)) return false;
      if (filters.paymentMethod && !sale.paymentMethods.includes(filters.paymentMethod)) return false;
      if (filters.paymentCondition && sale.paymentCondition !== filters.paymentCondition) return false;
      if (filters.status && sale.status !== filters.status) return false;
      if (minCents !== null && sale.saleTotalCents < minCents) return false;
      if (maxCents !== null && sale.saleTotalCents > maxCents) return false;
      if (filters.productId && !(sale.itens || []).some((item: any) => item.id === filters.productId)) return false;
      if (filters.category && !(sale.itens || []).some((item: any) => {
        const product = data.products[item.id];
        return String(product?.categoria || product?.categoriaNome || '') === filters.category;
      })) return false;
      return true;
    });

    const direction = sortDirection === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      let left: string | number = 0;
      let right: string | number = 0;
      if (sortBy === 'date') { left = a.date?.getTime() || 0; right = b.date?.getTime() || 0; }
      if (sortBy === 'number') { left = String(a.numeroPedido || ''); right = String(b.numeroPedido || ''); }
      if (sortBy === 'customer') { left = String(a.clienteNome || ''); right = String(b.clienteNome || ''); }
      if (sortBy === 'seller') { left = a.sellerName; right = b.sellerName; }
      if (sortBy === 'value') { left = a.saleTotalCents; right = b.saleTotalCents; }
      if (sortBy === 'status') { left = String(a.status || ''); right = String(b.status || ''); }
      return typeof left === 'number' && typeof right === 'number'
        ? (left - right) * direction
        : String(left).localeCompare(String(right), 'pt-BR') * direction;
    });
  }, [data.products, enrichedSales, filters, sortBy, sortDirection]);

  const totals = useMemo(() => totaisVendas(filteredSales), [filteredSales]);

  const sellerSummary = useMemo(() => resumoPorVendedor(filteredSales), [filteredSales]);

  useEffect(() => { setPage(1); }, [filters, pageSize, sortBy, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const pagedSales = filteredSales.slice((page - 1) * pageSize, page * pageSize);

  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => {
    setFilters(initialFilters());
    setSortBy('date');
    setSortDirection('desc');
  };

  // Filtros da tela em texto, para o papel dizer de onde saiu cada numero.
  const filtrosDescritos = useMemo(() => {
    const vendedor = filters.sellerId ? data.users[filters.sellerId] : null;
    const produto = filters.productId ? data.products[filters.productId] : null;
    return [
      vendedor && `Vendedor: ${vendedor.nome || vendedor.nomeResponsavel || vendedor.email}`,
      filters.customer.trim() && `Cliente: ${filters.customer.trim()}`,
      filters.paymentMethod && `Pagamento: ${filters.paymentMethod}`,
      filters.paymentCondition && `Condição: ${filters.paymentCondition === 'aprazo' ? 'A prazo' : 'À vista'}`,
      filters.status && `Status: ${filters.status}`,
      produto && `Produto: ${produto.nome}`,
      filters.category && `Categoria: ${filters.category}`,
      filters.minValue && `Valor mínimo: ${currency.format(Number(filters.minValue))}`,
      filters.maxValue && `Valor máximo: ${currency.format(Number(filters.maxValue))}`,
    ].filter(Boolean) as string[];
  }, [data.products, data.users, filters]);

  const periodoDescrito = filters.startDate === filters.endDate
    ? `Data: ${formatDateInputPtBr(filters.startDate)}`
    : `Período: ${formatDateInputPtBr(filters.startDate)} a ${formatDateInputPtBr(filters.endDate)}`;

  const documentoPreview = useMemo<DocumentoRelatorioSemEmpresa | null>(() => {
    if (!previewAberto) return null;
    if (previewAberto === 'vendedor') {
      return {
        titulo: 'Vendas por Vendedor',
        periodo: periodoDescrito,
        filtros: filtrosDescritos,
        indicadores: indicadoresVendas(totals),
        secoes: [secaoResumoVendedor(sellerSummary), secaoVendasPorVendedorDetalhe(filteredSales)],
      };
    }
    return {
      titulo: 'Relatório de Vendas',
      periodo: periodoDescrito,
      filtros: filtrosDescritos,
      indicadores: indicadoresVendas(totals),
      secoes: [
        secaoDetalheVendas(filteredSales),
        secaoResumoVendedor(sellerSummary, { opcional: true, padrao: false }),
      ],
    };
  }, [filteredSales, filtrosDescritos, periodoDescrito, previewAberto, sellerSummary, totals]);

  if (loading) {
    return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin-icon" size={38} /></div>;
  }

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId={previewAberto === 'vendedor' ? 'vendas-por-vendedor' : 'relatorio-vendas'}
        documento={documentoPreview}
        nomeArquivo={nomeArquivoRelatorio(previewAberto === 'vendedor' ? 'Vendas por Vendedor' : 'Relatório de Vendas', filters.startDate, filters.endDate)}
        onFechar={() => setPreviewAberto(null)}
        rotuloFechar="Voltar aos filtros"
      />
    );
  }

  return (
    <div className="relatorio-caixa-alta" style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}><BarChart2 color="var(--accent-purple)" /> Relatório de Vendas</h1>
          <p style={{ color: 'var(--text-muted)' }}>Empresa ativa: dados isolados por tenant • Período {formatDateInputPtBr(filters.startDate)} a {formatDateInputPtBr(filters.endDate)}</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => setPreviewAberto('vendedor')} disabled={filteredSales.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={18} /> Relatório por vendedor</button>
          <button className="btn-primary" onClick={() => setPreviewAberto('vendas')} disabled={filteredSales.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={18} /> Visualizar relatório</button>
        </div>
      </div>

      {error && <div role="alert" style={{ padding: '14px 16px', backgroundColor: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#fecaca', borderRadius: '8px' }}>{error}</div>}

      <section className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
          <label className="input-group"><span>Data inicial</span><input style={inputStyle} type="date" value={filters.startDate} onChange={(event) => setFilter('startDate', event.target.value)} /></label>
          <label className="input-group"><span>Data final</span><input style={inputStyle} type="date" value={filters.endDate} onChange={(event) => setFilter('endDate', event.target.value)} /></label>
          <label className="input-group"><span>Vendedor</span><select style={inputStyle} value={filters.sellerId} onChange={(event) => setFilter('sellerId', event.target.value)}><option value="">Todos</option>{Object.values(data.users).sort((a: any, b: any) => String(a.nome || '').localeCompare(String(b.nome || ''))).map((user: any) => <option key={user.id} value={user.id}>{user.nome || user.nomeResponsavel || user.email}</option>)}</select></label>
          <label className="input-group"><span>Cliente</span><CampoComSugestoes style={inputStyle} opcoes={options.customers} value={filters.customer} placeholder="Nome do cliente" onChange={(event) => setFilter('customer', event.target.value)} /></label>
          <label className="input-group"><span>Forma de pagamento</span><select style={inputStyle} value={filters.paymentMethod} onChange={(event) => setFilter('paymentMethod', event.target.value)}><option value="">Todas</option>{options.paymentMethods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
          <label className="input-group"><span>Condição</span><select style={inputStyle} value={filters.paymentCondition} onChange={(event) => setFilter('paymentCondition', event.target.value)}><option value="">Todas</option><option value="avista">À vista</option><option value="aprazo">A prazo</option></select></label>
          <label className="input-group"><span>Status</span><select style={inputStyle} value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">Todos</option>{options.statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <label className="input-group"><span>Produto</span><select style={inputStyle} value={filters.productId} onChange={(event) => setFilter('productId', event.target.value)}><option value="">Todos</option>{Object.values(data.products).sort((a: any, b: any) => String(a.nome || '').localeCompare(String(b.nome || ''))).map((product: any) => <option key={product.id} value={product.id}>{product.nome}</option>)}</select></label>
          <label className="input-group"><span>Categoria</span><select style={inputStyle} value={filters.category} onChange={(event) => setFilter('category', event.target.value)}><option value="">Todas</option>{options.categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="input-group"><span>Valor mínimo</span><input style={inputStyle} type="number" min="0" step="0.01" value={filters.minValue} onChange={(event) => setFilter('minValue', event.target.value)} /></label>
          <label className="input-group"><span>Valor máximo</span><input style={inputStyle} type="number" min="0" step="0.01" value={filters.maxValue} onChange={(event) => setFilter('maxValue', event.target.value)} /></label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}><button type="button" className="btn-secondary" onClick={clearFilters} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}><FilterX size={17} /> Limpar filtros</button></div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
        {[
          ['Vendas válidas', number.format(totals.count)],
          ['Venda líquida', currency.format(fromCents(totals.netCents))],
          ['Taxas de cartão', currency.format(fromCents(totals.cardFeeCents))],
          ['Receita líquida', currency.format(fromCents(totals.financialNetCents))],
          ['Ticket médio', currency.format(fromCents(totals.averageCents))],
          ['Descontos', currency.format(fromCents(totals.discountCents))],
          ['Recebido', currency.format(fromCents(totals.receivedCents))],
          ['Pendente', currency.format(fromCents(totals.pendingCents))],
          ['Canceladas', number.format(totals.cancelledCount)],
          ['Comissões registradas', currency.format(fromCents(totals.commissionCents))],
        ].map(([label, value]) => <div key={label} className="card" style={{ padding: '18px', backgroundColor: 'var(--bg-secondary)' }}><span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span><strong style={{ display: 'block', marginTop: '7px', fontSize: '21px' }}>{value}</strong></div>)}
      </section>

      <section className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={20} color="var(--accent-purple)" /> Vendas por vendedor</h2>
          <button className="btn-secondary" onClick={() => setPreviewAberto('vendedor')} disabled={sellerSummary.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Printer size={17} /> Imprimir por vendedor</button>
        </div>
        <div className="table-wrapper"><table className="data-table"><thead><tr><th>Vendedor</th><th>Vendas</th><th>Bruto</th><th>Descontos</th><th>Cancel.</th><th>Venda líquida</th><th>Taxas cartão</th><th>Receita líquida</th><th>Ticket médio</th><th>Recebido</th><th>A receber</th><th>Pagamentos</th><th>Comissão</th></tr></thead><tbody>
          {sellerSummary.length === 0 ? <tr><td colSpan={13} style={{ textAlign: 'center', padding: '32px' }}>Nenhuma venda encontrada para os filtros.</td></tr> : sellerSummary.map((seller) => <tr key={seller.id} onClick={() => seller.id !== 'nao_identificado' && setFilter('sellerId', seller.id)} style={{ cursor: seller.id !== 'nao_identificado' ? 'pointer' : 'default' }}><td><strong>{seller.name}</strong></td><td>{seller.sales}</td><td>{currency.format(fromCents(seller.grossCents))}</td><td>{currency.format(fromCents(seller.discountCents))}</td><td>{seller.cancellations}</td><td>{currency.format(fromCents(seller.netCents))}</td><td>{currency.format(fromCents(seller.cardFeeCents))}</td><td>{currency.format(fromCents(seller.financialNetCents))}</td><td>{currency.format(fromCents(seller.sales ? Math.round(seller.netCents / seller.sales) : 0))}</td><td>{currency.format(fromCents(seller.receivedCents))}</td><td>{currency.format(fromCents(seller.pendingCents))}</td><td style={{ maxWidth: '220px', fontSize: '12px' }}>{Object.entries(seller.payments).map(([method, value]) => `${method}: ${currency.format(fromCents(Number(value)))}`).join(' • ') || '-'}</td><td>{currency.format(fromCents(seller.commissionCents))}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div><h2 style={{ fontSize: '18px', marginBottom: '4px' }}>Detalhamento das vendas</h2><span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{filteredSales.length} registros filtrados; totais consideram todas as páginas.</span></div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select style={inputStyle} value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="date">Ordenar: Data</option><option value="number">Número</option><option value="customer">Cliente</option><option value="seller">Vendedor</option><option value="value">Valor</option><option value="status">Status</option></select>
            <select style={inputStyle} value={sortDirection} onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}><option value="desc">Decrescente</option><option value="asc">Crescente</option></select>
          </div>
        </div>
        <div className="table-wrapper"><table className="data-table"><thead><tr><th>Pedido</th><th>Data e hora</th><th>Cliente</th><th>Vendedor</th><th>Bruto</th><th>Desconto</th><th>Venda líquida</th><th>Taxas cartão</th><th>Receita líquida</th><th>Pagamento</th><th>Condição</th><th>Status</th><th>Recebido</th><th>Pendente</th><th>Comissão</th><th></th></tr></thead><tbody>
          {pagedSales.length === 0 ? <tr><td colSpan={16} style={{ textAlign: 'center', padding: '40px' }}><Search size={34} style={{ opacity: .3, marginBottom: '8px' }} /><div>Nenhuma venda encontrada.</div></td></tr> : pagedSales.map((sale) => <tr key={sale.id} style={{ opacity: sale.cancelled ? .65 : 1 }}><td>#{sale.numeroPedido || sale.id.slice(0, 6)}</td><td>{sale.date?.toLocaleString('pt-BR') || '-'}</td><td>{sale.clienteNome || '-'}</td><td>{sale.sellerName}</td><td>{currency.format(fromCents(sale.grossCents))}</td><td>{currency.format(fromCents(sale.discountCents))}</td><td>{currency.format(fromCents(sale.netCents))}</td><td>{currency.format(fromCents(sale.cardFeeCents))}</td><td>{currency.format(fromCents(sale.financialNetCents))}</td><td>{sale.paymentMethods.join(' + ')}</td><td>{sale.paymentCondition === 'aprazo' ? 'A prazo' : 'À vista'}</td><td>{sale.status}</td><td>{currency.format(fromCents(sale.receivedCents))}</td><td>{currency.format(fromCents(sale.pendingCents))}</td><td title={sale.commissionStatus === 'legado_sem_snapshot' ? 'Venda antiga sem snapshot histórico' : sale.commissionStatus}>{currency.format(fromCents(sale.commissionCents))}</td><td><button className="icon-btn" title="Abrir venda original" onClick={() => navigate(`/pedidos-venda/visualizar/${sale.id}`)}><Eye size={17} /></button></td></tr>)}
        </tbody></table></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Linhas por página <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} style={{ ...inputStyle, width: 'auto', marginLeft: '8px' }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><button className="icon-btn" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={18} /></button><span style={{ fontSize: '13px' }}>Página {Math.min(page, totalPages)} de {totalPages}</span><button className="icon-btn" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={18} /></button></div>
        </div>
      </section>
    </div>
  );
};

export default RelatoriosVendas;
