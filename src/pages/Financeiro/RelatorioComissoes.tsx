import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, DollarSign, Eye, Loader2, Search, User } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { dateInputToUtcEnd, dateInputToUtcStart, getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents, toCents } from '../../utils/financeDomain';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

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

interface CommissionEntry {
  id: string;
  originType: 'venda' | 'os';
  originId: string;
  originNumber: string;
  sellerId: string;
  sellerName: string;
  baseCents: number;
  percentage: number;
  valueCents: number;
  status: string;
  generatedAt: Date | null;
  paidAt: Date | null;
  historical: boolean;
}

const RelatorioComissoes: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();
  const [entries, setEntries] = useState<CommissionEntry[]>([]);
  const [users, setUsers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const today = getDateInputInTimeZone();
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);

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
        const [usersSnap, salesSnap, serviceOrdersSnap] = await Promise.all([
          getDocs(tenantQuery('usuarios')),
          getDocs(tenantQuery('pedidos_venda')),
          getDocs(tenantQuery('ordens_de_servico')),
        ]);
        if (cancelled) return;

        const userMap: Record<string, any> = {};
        usersSnap.forEach((document) => { userMap[document.id] = { id: document.id, ...document.data() }; });
        const result: CommissionEntry[] = [];

        salesSnap.forEach((document) => {
          const sale = document.data();
          const sellerIdValue = sale.vendedorId || sale.usuarioResponsavelId || '';
          const seller = userMap[sellerIdValue];
          const snapshot = sale.comissao;
          const baseCents = Number(snapshot?.baseAtualCentavos ?? toCents((sale.itens || []).reduce((sum: number, item: any) => sum + Number(item.subtotal || 0), 0)));
          const legacyPercentage = seller?.recebeComissaoPecas === true ? Number(seller.comissaoPercentualPecas || 0) : 0;
          const historical = Boolean(snapshot?.regraVersion);
          const cancelledSale = sale.status === 'Cancelada';
          result.push({
            id: `venda-${document.id}`,
            originType: 'venda',
            originId: document.id,
            originNumber: sale.numeroPedido || document.id.slice(0, 6),
            sellerId: sellerIdValue,
            sellerName: snapshot?.vendedorNome || sale.vendedorNome || seller?.nome || seller?.nomeResponsavel || 'Não identificado',
            baseCents,
            percentage: historical ? Number(snapshot.percentual || 0) : legacyPercentage,
            valueCents: cancelledSale
              ? 0
              : historical
                ? Number(snapshot.valorAtualCentavos ?? toCents(snapshot.valorAtual))
                : Math.round(baseCents * (legacyPercentage / 100)),
            status: cancelledSale ? 'cancelada' : historical ? snapshot.status : 'estimativa_legada',
            generatedAt: toDate(snapshot?.geradaEm || sale.createdAt),
            paidAt: toDate(snapshot?.pagaEm),
            historical,
          });
        });

        serviceOrdersSnap.forEach((document) => {
          const serviceOrder = document.data();
          if (!['Finalizada', 'Cancelada'].includes(serviceOrder.status)) return;
          const mechanicId = serviceOrder.mecanicoId || '';
          const mechanic = userMap[mechanicId];
          const snapshot = serviceOrder.comissao;
          const servicesBase = (serviceOrder.servicos || []).reduce((sum: number, item: any) => sum + Number(item.preco || 0) * Number(item.quantidade || item.tempoHoras || 1), 0);
          const partsBase = (serviceOrder.pecas || []).reduce((sum: number, item: any) => sum + Number(item.preco || item.precoVenda || 0) * Number(item.quantidade || 1), 0);
          const baseCents = Number(snapshot?.baseAtualCentavos ?? toCents(servicesBase + partsBase));
          const servicePercentage = mechanic?.recebeComissaoServicos === true ? Number(mechanic.comissaoPercentualServicos || 0) : 0;
          const partsPercentage = mechanic?.recebeComissaoPecas === true ? Number(mechanic.comissaoPercentualPecas || 0) : 0;
          const legacyValueCents = Math.round(toCents(servicesBase) * (servicePercentage / 100)) + Math.round(toCents(partsBase) * (partsPercentage / 100));
          const historical = Boolean(snapshot?.regraVersion);
          const cancelledServiceOrder = serviceOrder.status === 'Cancelada';
          result.push({
            id: `os-${document.id}`,
            originType: 'os',
            originId: document.id,
            originNumber: serviceOrder.numeroOS || document.id.slice(0, 6),
            sellerId: mechanicId,
            sellerName: snapshot?.vendedorNome || serviceOrder.mecanicoNome || mechanic?.nome || 'Não identificado',
            baseCents,
            percentage: historical ? Number(snapshot.percentual || 0) : 0,
            valueCents: cancelledServiceOrder
              ? 0
              : historical
                ? Number(snapshot.valorAtualCentavos ?? toCents(snapshot.valorAtual))
                : legacyValueCents,
            status: cancelledServiceOrder ? 'cancelada' : historical ? snapshot.status : 'estimativa_legada',
            generatedAt: toDate(snapshot?.geradaEm || serviceOrder.updatedAt || serviceOrder.createdAt),
            paidAt: toDate(snapshot?.pagaEm),
            historical,
          });
        });

        // O seletor "Vendedor" nao pode listar a equipe inteira pra quem
        // so ve as proprias comissoes -- a lista de nomes ja e' informacao.
        setUsers(vendasVisiveisDeUsuarioId
          ? (userMap[vendasVisiveisDeUsuarioId] ? { [vendasVisiveisDeUsuarioId]: userMap[vendasVisiveisDeUsuarioId] } : {})
          : userMap);
        // Visibilidade de vendas: quando o funcionario so pode ver as
        // proprias vendas, ele tambem so ve a propria comissao -- a linha
        // de comissao do colega expoe o faturamento que a tela de Vendas
        // acabou de esconder. Vale pras duas origens (venda e OS).
        const visiveis = vendasVisiveisDeUsuarioId
          ? result.filter((entry) => entry.sellerId === vendasVisiveisDeUsuarioId)
          : result;
        setEntries(visiveis.sort((a, b) => (b.generatedAt?.getTime() || 0) - (a.generatedAt?.getTime() || 0)));
      } catch (loadError) {
        console.error('Erro ao carregar comissões:', loadError);
        if (!cancelled) setError('Não foi possível carregar as comissões.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const filtered = useMemo(() => {
    const start = dateInputToUtcStart(startDate);
    const end = dateInputToUtcEnd(endDate);
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!entry.generatedAt || !start || !end || entry.generatedAt < start || entry.generatedAt > end) return false;
      if (sellerId && entry.sellerId !== sellerId) return false;
      if (status && entry.status !== status) return false;
      if (term && !`${entry.sellerName} ${entry.originNumber}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [endDate, entries, search, sellerId, startDate, status]);

  const confirmedTotalCents = filtered
    .filter((entry) => entry.historical && entry.status === 'gerada')
    .reduce((sum, entry) => sum + entry.valueCents, 0);
  const legacyEstimateCents = filtered
    .filter((entry) => !entry.historical)
    .reduce((sum, entry) => sum + entry.valueCents, 0);

  const exportCsv = () => {
    const rows = [
      ['Origem', 'Número', 'Vendedor', 'Base', 'Percentual', 'Comissão', 'Status', 'Gerada em', 'Paga em'],
      ...filtered.map((entry) => [entry.originType, entry.originNumber, entry.sellerName, fromCents(entry.baseCents).toFixed(2), entry.percentage.toFixed(2), fromCents(entry.valueCents).toFixed(2), entry.status, entry.generatedAt?.toLocaleString('pt-BR') || '', entry.paidAt?.toLocaleString('pt-BR') || '']),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `comissoes-${startDate}-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><Loader2 className="spin-icon" size={38} /></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div><h1 style={{ fontSize: '25px', display: 'flex', alignItems: 'center', gap: '9px' }}><DollarSign color="#10b981" /> Relatório de Comissões</h1><p style={{ color: 'var(--text-muted)', marginTop: '5px' }}>Snapshots históricos por venda e OS; registros legados aparecem separados como estimativa.</p></div>
        <button className="btn-secondary" onClick={exportCsv} disabled={filtered.length === 0} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Download size={18} /> Exportar CSV</button>
      </div>

      {error && <div role="alert" style={{ padding: '14px', color: '#fecaca', backgroundColor: 'rgba(239,68,68,.12)', borderRadius: '8px' }}>{error}</div>}

      <section className="card" style={{ padding: '18px', backgroundColor: 'var(--bg-secondary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '14px' }}>
        <label className="input-group"><span>Data inicial</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="input-group"><span>Data final</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label className="input-group"><span>Vendedor</span><select value={sellerId} onChange={(event) => setSellerId(event.target.value)}><option value="">Todos</option>{Object.values(users).sort((a: any, b: any) => String(a.nome || '').localeCompare(String(b.nome || ''))).map((user: any) => <option key={user.id} value={user.id}>{user.nome || user.nomeResponsavel || user.email}</option>)}</select></label>
        <label className="input-group"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="gerada">Gerada</option><option value="nao_aplicavel">Não aplicável</option><option value="cancelada">Cancelada</option><option value="estimativa_legada">Estimativa legada</option></select></label>
        <label className="input-group"><span>Buscar</span><div style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Venda ou vendedor" style={{ paddingLeft: '34px' }} /></div></label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)' }}><span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>COMISSÃO HISTÓRICA VÁLIDA</span><strong style={{ display: 'block', fontSize: '26px', color: '#10b981', marginTop: '8px' }}>{currency.format(fromCents(confirmedTotalCents))}</strong></div>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)' }}><span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>ESTIMATIVA DE REGISTROS LEGADOS</span><strong style={{ display: 'block', fontSize: '26px', color: '#f59e0b', marginTop: '8px' }}>{currency.format(fromCents(legacyEstimateCents))}</strong></div>
        <div className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)' }}><span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>ORIGENS NO FILTRO</span><strong style={{ display: 'block', fontSize: '26px', marginTop: '8px' }}>{filtered.length}</strong></div>
      </section>

      <section className="card" style={{ padding: '20px', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="table-wrapper"><table className="data-table"><thead><tr><th>Origem</th><th>Vendedor</th><th>Base de cálculo</th><th>Percentual</th><th>Comissão</th><th>Status</th><th>Geração</th><th>Pagamento</th><th></th></tr></thead><tbody>
          {filtered.length === 0 ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: '40px' }}><User size={38} style={{ opacity: .3, marginBottom: '8px' }} /><div>Nenhuma comissão encontrada.</div></td></tr> : filtered.map((entry) => <tr key={entry.id}><td><strong>{entry.originType === 'venda' ? 'Venda' : 'OS'} #{entry.originNumber}</strong></td><td>{entry.sellerName}</td><td>{currency.format(fromCents(entry.baseCents))}</td><td>{entry.historical ? `${entry.percentage.toFixed(2)}%` : 'Regra atual (legado)'}</td><td>{currency.format(fromCents(entry.valueCents))}</td><td><span className="status-badge" style={{ color: entry.status === 'gerada' ? '#10b981' : entry.status === 'cancelada' ? '#ef4444' : '#f59e0b' }}>{entry.status.replaceAll('_', ' ')}</span></td><td>{entry.generatedAt?.toLocaleString('pt-BR') || '-'}</td><td>{entry.paidAt?.toLocaleString('pt-BR') || '-'}</td><td><button className="icon-btn" title="Abrir origem" onClick={() => navigate(entry.originType === 'venda' ? `/pedidos-venda/visualizar/${entry.originId}` : `/os/editar/${entry.originId}`)}><Eye size={17} /></button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
};

export default RelatorioComissoes;
