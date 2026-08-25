import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FilterX,
  Loader2,
  Search,
  Users,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import {
  dateInputToUtcEnd,
  dateInputToUtcStart,
  formatDateInputPtBr,
  getDateInputInTimeZone,
} from '../../utils/dateTime';
import { contaComoFaturamento } from '../../utils/preVendaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { fromCents, toCents } from '../../utils/financeDomain';

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

interface ReportData {
  sales: any[];
  transactions: any[];
  users: Record<string, any>;
  products: Record<string, any>;
  returns: any[];
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

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dateInputToUtcStart(value);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

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
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();
  const [data, setData] = useState<ReportData>({ sales: [], transactions: [], users: {}, products: {}, returns: [] });
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState<'date' | 'number' | 'customer' | 'seller' | 'value' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tenantId || !currentUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const tenantQuery = (name: string) => query(collection(db, name), where('tenantId', '==', tenantId));
        const [salesSnap, transactionsSnap, usersSnap, productsSnap, returnsSnap] = await Promise.all([
          getDocs(tenantQuery('pedidos_venda')),
          getDocs(tenantQuery('transacoes')),
          getDocs(tenantQuery('usuarios')),
          getDocs(tenantQuery('estoque')),
          getDocs(tenantQuery('devolucoes_venda')),
        ]);

        if (cancelled) return;
        const users: Record<string, any> = {};
        usersSnap.forEach((document) => { users[document.id] = { id: document.id, ...document.data() }; });
        const products: Record<string, any> = {};
        productsSnap.forEach((document) => { products[document.id] = { id: document.id, ...document.data() }; });

        setData({
          // Este relatorio e' de FATURAMENTO -- pedido em aberto (pre-venda
          // do balcao ou pedido do agente aguardando confirmacao) fica de
          // fora: nao gerou lancamento financeiro nenhum. Antes disso, todo
          // pedido que nao fosse 'Cancelada' entrava como venda, e pedido
          // 'Em Análise' inflava o faturamento em silencio. Pre-venda em
          // aberto tem tela propria (Relatório de Pré-vendas em Aberto).
          sales: filtrarVendasVisiveis(
            salesSnap.docs.map((document) => ({ id: document.id, ...document.data() })) as any[],
            vendasVisiveisDeUsuarioId,
          ).filter((sale: any) => contaComoFaturamento(sale.status)),
          transactions: transactionsSnap.docs.map((document) => ({ id: document.id, ...document.data() })),
          users,
          products,
          returns: returnsSnap.docs.map((document) => ({ id: document.id, ...document.data() })),
        });
      } catch (loadError) {
        console.error('Erro ao carregar relatório de vendas:', loadError);
        if (!cancelled) setError('Não foi possível carregar o relatório. Verifique sua conexão e permissões.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

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

  const enrichedSales = useMemo(() => {
    const transactionsBySale = new Map<string, any[]>();
    data.transactions.forEach((transaction) => {
      const saleId = transaction.pedidoId || (transaction.sourceType === 'pedido_venda' ? transaction.sourceId : '');
      if (!saleId) return;
      const current = transactionsBySale.get(saleId) || [];
      current.push(transaction);
      transactionsBySale.set(saleId, current);
    });

    const returnsBySale = new Map<string, number>();
    data.returns
      .filter((item) => item.status === 'concluida')
      .forEach((item) => {
        const saleId = item.pedidoVendaId || item.pedidoOrigemId;
        if (saleId) {
          returnsBySale.set(
            saleId,
            (returnsBySale.get(saleId) || 0) +
              Number(item.valorTotalDevolvidoCentavos ?? toCents(item.valorTotalDevolvido)),
          );
        }
      });

    return data.sales.map((sale) => {
      const saleTransactions = transactionsBySale.get(sale.id) || [];
      const sellerId = sale.vendedorId || sale.usuarioResponsavelId || '';
      const seller = data.users[sellerId];
      const sellerName = sale.vendedorNome || seller?.nome || seller?.nomeResponsavel || seller?.email || 'Não identificado';
      const grossCents = Number(sale.valorTotalItensCentavos ?? toCents(Number(sale.valorTotal || 0) + Number(sale.valorTotalDescontos || 0)));
      const discountCents = Number(sale.valorTotalDescontosCentavos ?? toCents(sale.valorTotalDescontos));
      const saleTotalCents = Number(sale.valorTotalCentavos ?? toCents(sale.valorTotal));
      const returnedCents = returnsBySale.get(sale.id) || 0;
      const cancelled = sale.status === 'Cancelada';
      const netCents = cancelled ? 0 : Math.max(0, saleTotalCents - returnedCents);
      const rawReceivedCents = cancelled ? 0 : saleTransactions
        .filter((transaction) => transaction.tipo === 'entrada' && transaction.status === 'Paga')
        .reduce((sum, transaction) => sum + Number(transaction.valorCentavos ?? toCents(transaction.valor)), 0);
      const rawPendingCents = cancelled ? 0 : saleTransactions
        .filter((transaction) => transaction.tipo === 'entrada' && transaction.status === 'Pendente')
        .reduce((sum, transaction) => sum + Number(transaction.valorCentavos ?? toCents(transaction.valor)), 0);
      const fallbackReceivedCents = Number(sale.totalRecebidoCentavos ?? toCents(sale.totalRecebido));
      const fallbackPendingCents = Number(sale.totalPendenteCentavos ?? toCents(sale.totalPendente));
      const receivedCents = cancelled
        ? 0
        : Math.min(netCents, rawReceivedCents || fallbackReceivedCents);
      const pendingCents = cancelled
        ? 0
        : Math.min(Math.max(0, netCents - receivedCents), rawPendingCents || fallbackPendingCents);
      const payments = Array.isArray(sale.pagamentos) && sale.pagamentos.length > 0
        ? sale.pagamentos
        : [{ formaPagamento: sale.formaPagamento || 'Não informado', condicaoPagamento: sale.condicaoPagamento || (String(sale.formaPagamento).includes('Prazo') ? 'aprazo' : 'avista'), valorCentavos: saleTotalCents }];
      const paymentMethods = Array.from(new Set(payments.map((payment: any) => payment.formaPagamento).filter(Boolean)));
      const paymentCondition = sale.condicaoPagamento || (payments.some((payment: any) => payment.condicaoPagamento === 'aprazo') ? 'aprazo' : 'avista');
      const storedCardFeeCents = sale.totalTaxasPagamentoCentavos !== undefined
        ? Number(sale.totalTaxasPagamentoCentavos)
        : sale.totalTaxasPagamento !== undefined
          ? toCents(sale.totalTaxasPagamento)
          : payments.reduce((sum: number, payment: any) => (
              sum + Number(payment.cartao?.valorTaxaCentavos ?? toCents(payment.cartao?.valorTaxa))
            ), 0);
      const cardFeeCents = cancelled ? 0 : Math.min(netCents, Math.max(0, storedCardFeeCents));
      const financialNetCents = cancelled ? 0 : Math.max(0, netCents - cardFeeCents);
      const commissionCents = cancelled ? 0 : Number(sale.comissao?.valorAtualCentavos ?? toCents(sale.comissao?.valorAtual));
      const commissionStatus = sale.comissao?.status || 'legado_sem_snapshot';

      return {
        ...sale,
        date: toDate(sale.dataVenda) || toDate(sale.createdAt),
        sellerId,
        sellerName,
        grossCents,
        discountCents,
        saleTotalCents,
        returnedCents,
        netCents,
        receivedCents,
        pendingCents,
        payments,
        paymentMethods,
        paymentCondition,
        cardFeeCents,
        financialNetCents,
        commissionCents,
        commissionStatus,
        cancelled,
      };
    });
  }, [data]);

  const filteredSales = useMemo(() => {
    const start = dateInputToUtcStart(filters.startDate);
    const end = dateInputToUtcEnd(filters.endDate);
    const minCents = filters.minValue ? toCents(filters.minValue) : null;
    const maxCents = filters.maxValue ? toCents(filters.maxValue) : null;
    const customerSearch = filters.customer.trim().toLowerCase();

    const filtered = enrichedSales.filter((sale) => {
      if (!sale.date || !start || !end || sale.date < start || sale.date > end) return false;
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

  const totals = useMemo(() => {
    const valid = filteredSales.filter((sale) => !sale.cancelled);
    const netCents = valid.reduce((sum, sale) => sum + sale.netCents, 0);
    return {
      count: valid.length,
      cancelledCount: filteredSales.length - valid.length,
      grossCents: valid.reduce((sum, sale) => sum + sale.grossCents, 0),
      discountCents: valid.reduce((sum, sale) => sum + sale.discountCents, 0),
      netCents,
      receivedCents: valid.reduce((sum, sale) => sum + sale.receivedCents, 0),
      pendingCents: valid.reduce((sum, sale) => sum + sale.pendingCents, 0),
      cardFeeCents: valid.reduce((sum, sale) => sum + sale.cardFeeCents, 0),
      financialNetCents: valid.reduce((sum, sale) => sum + sale.financialNetCents, 0),
      commissionCents: valid.reduce((sum, sale) => sum + sale.commissionCents, 0),
      averageCents: valid.length ? Math.round(netCents / valid.length) : 0,
    };
  }, [filteredSales]);

  const sellerSummary = useMemo(() => {
    const map = new Map<string, any>();
    filteredSales.forEach((sale) => {
      const id = sale.sellerId || 'nao_identificado';
      const current = map.get(id) || {
        id,
        name: sale.sellerName,
        sales: 0,
        cancellations: 0,
        grossCents: 0,
        discountCents: 0,
        netCents: 0,
        receivedCents: 0,
        pendingCents: 0,
        cardFeeCents: 0,
        financialNetCents: 0,
        commissionCents: 0,
        payments: {} as Record<string, number>,
      };
      if (sale.cancelled) {
        current.cancellations += 1;
      } else {
        current.sales += 1;
        current.grossCents += sale.grossCents;
        current.discountCents += sale.discountCents;
        current.netCents += sale.netCents;
        current.receivedCents += sale.receivedCents;
        current.pendingCents += sale.pendingCents;
        current.cardFeeCents += sale.cardFeeCents;
        current.financialNetCents += sale.financialNetCents;
        current.commissionCents += sale.commissionCents;
        sale.payments.forEach((payment: any) => {
          const method = payment.formaPagamento || 'Não informado';
          current.payments[method] = (current.payments[method] || 0) + Number(payment.valorCentavos ?? toCents(payment.valor));
        });
      }
      map.set(id, current);
    });
    return Array.from(map.values()).sort((a, b) => b.financialNetCents - a.financialNetCents);
  }, [filteredSales]);

  useEffect(() => { setPage(1); }, [filters, pageSize, sortBy, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const pagedSales = filteredSales.slice((page - 1) * pageSize, page * pageSize);

  const setFilter = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => {
    setFilters(initialFilters());
    setSortBy('date');
    setSortDirection('desc');
  };

  const exportCsv = () => {
    const headers = ['Pedido', 'Data', 'Cliente', 'Vendedor', 'Bruto', 'Desconto', 'Venda líquida', 'Taxas de cartão', 'Receita líquida', 'Pagamento', 'Condição', 'Status', 'Recebido', 'Pendente', 'Comissão'];
    const rows = filteredSales.map((sale) => [
      sale.numeroPedido,
      sale.date ? sale.date.toLocaleString('pt-BR') : '',
      sale.clienteNome,
      sale.sellerName,
      fromCents(sale.grossCents).toFixed(2),
      fromCents(sale.discountCents).toFixed(2),
      fromCents(sale.netCents).toFixed(2),
      fromCents(sale.cardFeeCents).toFixed(2),
      fromCents(sale.financialNetCents).toFixed(2),
      sale.paymentMethods.join(' + '),
      sale.paymentCondition === 'aprazo' ? 'A prazo' : 'À vista',
      sale.status,
      fromCents(sale.receivedCents).toFixed(2),
      fromCents(sale.pendingCents).toFixed(2),
      fromCents(sale.commissionCents).toFixed(2),
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-vendas-${filters.startDate}-${filters.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}><Loader2 className="spin-icon" size={38} /></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '26px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}><BarChart2 color="var(--accent-purple)" /> Relatório de Vendas</h1>
          <p style={{ color: 'var(--text-muted)' }}>Empresa ativa: dados isolados por tenant • Período {formatDateInputPtBr(filters.startDate)} a {formatDateInputPtBr(filters.endDate)}</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv} disabled={filteredSales.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Download size={18} /> Exportar CSV filtrado</button>
      </div>

      {error && <div role="alert" style={{ padding: '14px 16px', backgroundColor: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#fecaca', borderRadius: '8px' }}>{error}</div>}

      <section className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
          <label className="input-group"><span>Data inicial</span><input style={inputStyle} type="date" value={filters.startDate} onChange={(event) => setFilter('startDate', event.target.value)} /></label>
          <label className="input-group"><span>Data final</span><input style={inputStyle} type="date" value={filters.endDate} onChange={(event) => setFilter('endDate', event.target.value)} /></label>
          <label className="input-group"><span>Vendedor</span><select style={inputStyle} value={filters.sellerId} onChange={(event) => setFilter('sellerId', event.target.value)}><option value="">Todos</option>{Object.values(data.users).sort((a: any, b: any) => String(a.nome || '').localeCompare(String(b.nome || ''))).map((user: any) => <option key={user.id} value={user.id}>{user.nome || user.nomeResponsavel || user.email}</option>)}</select></label>
          <label className="input-group"><span>Cliente</span><input style={inputStyle} list="sales-customers" value={filters.customer} placeholder="Nome do cliente" onChange={(event) => setFilter('customer', event.target.value)} /><datalist id="sales-customers">{options.customers.map((customer) => <option key={customer} value={customer} />)}</datalist></label>
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
        <h2 style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Users size={20} color="var(--accent-purple)" /> Vendas por vendedor</h2>
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
