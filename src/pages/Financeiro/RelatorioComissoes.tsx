import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DollarSign, Eye, FileText, Loader2, Search, User } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents } from '../../utils/financeDomain';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  filtrarComissoes,
  montarDocumentoComissoes,
  montarEntradasComissao,
  totalizarComissoes,
  type EntradaComissao,
  type FiltroComissoes,
} from '../../utils/relatorioComissoesDomain';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/*
 * COMISSOES A PAGAR. A conta (linha por venda/OS, estimativa legada,
 * visibilidade, filtros e totais) mora em relatorioComissoesDomain.ts e e' a
 * mesma do relatorio: "Gerar relatorio" abre no RelatorioPreview (PDF, colunas
 * por caixa de marcar, Excel dentro da previa) com exatamente o que esta
 * filtrado aqui (padronizacao dos relatorios, dono 2026-10-02).
 */

const nomeDoUsuario = (user: any): string => user?.nome || user?.nomeResponsavel || user?.email || '';

const RelatorioComissoes: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId } = useAuth();
  const [entries, setEntries] = useState<EntradaComissao[]>([]);
  const [users, setUsers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const today = getDateInputInTimeZone();
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [previewAberto, setPreviewAberto] = useState(false);

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

        // O seletor "Vendedor" nao pode listar a equipe inteira pra quem
        // so ve as proprias comissoes -- a lista de nomes ja e' informacao.
        setUsers(vendasVisiveisDeUsuarioId
          ? (userMap[vendasVisiveisDeUsuarioId] ? { [vendasVisiveisDeUsuarioId]: userMap[vendasVisiveisDeUsuarioId] } : {})
          : userMap);
        // A regra de visibilidade (so' a propria comissao) e' aplicada dentro
        // de montarEntradasComissao, para venda e OS.
        setEntries(montarEntradasComissao({
          usuarios: userMap,
          vendas: salesSnap.docs.map((document) => ({ id: document.id, dados: document.data() })),
          ordensDeServico: serviceOrdersSnap.docs.map((document) => ({ id: document.id, dados: document.data() })),
          vendasVisiveisDeUsuarioId,
        }));
      } catch (loadError) {
        console.error('Erro ao carregar comissões:', loadError);
        if (!cancelled) setError('Não foi possível carregar as comissões. Confira sua conexão com a internet e abra a tela novamente.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const filtro = useMemo<FiltroComissoes>(() => ({
    de: startDate,
    ate: endDate,
    vendedorId: sellerId,
    status,
    busca: search,
  }), [endDate, search, sellerId, startDate, status]);

  const filtered = useMemo(() => filtrarComissoes(entries, filtro), [entries, filtro]);
  const totais = totalizarComissoes(filtered);
  const confirmedTotalCents = totais.validaCentavos;
  const legacyEstimateCents = totais.estimativaLegadaCentavos;

  const documento = useMemo<DocumentoRelatorioSemEmpresa>(
    () => montarDocumentoComissoes(entries, filtro, sellerId ? nomeDoUsuario(users[sellerId]) || undefined : undefined),
    [entries, filtro, sellerId, users],
  );

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="comissoes"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Comissões a Pagar', startDate, endDate)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar"
      />
    );
  }

  if (loading) return <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><Loader2 className="spin-icon" size={38} /></div>;

  return (
    <div className="relatorio-caixa-alta" style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div><h1 style={{ fontSize: '25px', display: 'flex', alignItems: 'center', gap: '9px' }}><DollarSign color="#10b981" /> Relatório de Comissões</h1><p style={{ color: 'var(--text-muted)', marginTop: '5px' }}>Snapshots históricos por venda e OS; registros legados aparecem separados como estimativa.</p></div>
        <button className="btn-primary" onClick={() => setPreviewAberto(true)} disabled={filtered.length === 0} title={filtered.length === 0 ? 'Nenhuma comissão no filtro. Ajuste o período, o vendedor ou o status para gerar o relatório.' : 'Abre o relatório em PDF com o que está filtrado na tela (dá para salvar em Excel)'} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><FileText size={18} /> Gerar relatório</button>
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
