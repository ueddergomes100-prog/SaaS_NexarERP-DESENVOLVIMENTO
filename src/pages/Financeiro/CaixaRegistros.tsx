import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Wallet, Clock, History, Calendar, ChevronDown, ChevronUp, Banknote } from 'lucide-react';
import { fromCents } from '../../utils/financeDomain';
import './Financeiro.css';

interface SangriaData {
  id: string;
  valorCentavos: number;
  motivo: string;
  registradoEm: string;
  registradoPorNome: string;
}

interface CaixaSessaoData {
  id: string;
  operadorNome: string;
  status: 'aberto' | 'fechado';
  saldoInicialCentavos: number;
  saldoAnteriorSugeridoCentavos: number | null;
  saldoAnteriorConfirmado: boolean;
  saldoFinalInformadoCentavos: number | null;
  saldoEsperadoCentavos: number | null;
  diferencaCentavos: number | null;
  sangrias: SangriaData[];
  totalSangriasCentavos: number;
  createdAt?: any;
  fechadoEm?: any;
}

interface VendaVinculada {
  id: string;
  numeroPedido?: string;
  valorTotal?: number;
  clienteNome?: string;
  createdAt?: any;
}

const currencyFormat = (value: number) => (
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
);

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  return null;
};

const formatDateTime = (value: any): string => {
  const date = toDate(value);
  return date ? date.toLocaleString('pt-BR') : '-';
};

const CaixaRegistros: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const [sessoes, setSessoes] = useState<CaixaSessaoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [diasFiltro, setDiasFiltro] = useState<number>(30);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vendasPorSessao, setVendasPorSessao] = useState<Record<string, VendaVinculada[]>>({});
  const [loadingVendas, setLoadingVendas] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'caixas_pdv'), where('tenantId', '==', tenantId));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const data: CaixaSessaoData[] = [];
      querySnapshot.forEach((docSnap) => {
        data.push({ id: docSnap.id, ...docSnap.data() } as CaixaSessaoData);
      });
      data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setSessoes(data);
      setLoading(false);
    }, (error) => {
      console.error('Erro ao buscar caixas do PDV:', error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [currentUser, tenantId]);

  const caixasAbertos = useMemo(() => sessoes.filter((s) => s.status === 'aberto'), [sessoes]);

  const historico = useMemo(() => {
    const limite = diasFiltro > 0 ? new Date() : null;
    if (limite) limite.setDate(limite.getDate() - diasFiltro);
    return sessoes.filter((s) => {
      if (s.status !== 'fechado') return false;
      if (!limite) return true;
      const data = toDate(s.fechadoEm);
      return data ? data >= limite : true;
    });
  }, [sessoes, diasFiltro]);

  const toggleExpand = async (sessao: CaixaSessaoData) => {
    if (expandedId === sessao.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sessao.id);
    if (vendasPorSessao[sessao.id]) return;

    setLoadingVendas(sessao.id);
    try {
      const q = query(collection(db, 'pedidos_venda'), where('pdvSessionId', '==', sessao.id));
      const snap = await getDocs(q);
      const vendas: VendaVinculada[] = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as VendaVinculada));
      vendas.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setVendasPorSessao((prev) => ({ ...prev, [sessao.id]: vendas }));
    } catch (error) {
      console.error('Erro ao buscar vendas da sessão de caixa:', error);
    } finally {
      setLoadingVendas(null);
    }
  };

  const renderExpandedRow = (sessao: CaixaSessaoData, colSpan: number) => {
    if (expandedId !== sessao.id) return null;
    const vendas = vendasPorSessao[sessao.id];
    return (
      <tr>
        <td colSpan={colSpan} style={{ padding: '16px', backgroundColor: 'var(--bg-tertiary)' }}>
          {sessao.sangrias.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', fontWeight: 700 }}>
                <Banknote size={16} color="#f59e0b" /> Sangrias
              </div>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 8px' }}>Horário</th>
                    <th style={{ padding: '6px 8px' }}>Motivo</th>
                    <th style={{ padding: '6px 8px' }}>Responsável</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {sessao.sangrias.map((sangria) => (
                    <tr key={sangria.id}>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{new Date(sangria.registradoEm).toLocaleString('pt-BR')}</td>
                      <td style={{ padding: '6px 8px' }}>{sangria.motivo}</td>
                      <td style={{ padding: '6px 8px' }}>{sangria.registradoPorNome}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#f59e0b', fontWeight: 600 }}>{currencyFormat(fromCents(sangria.valorCentavos))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', fontWeight: 700 }}>
            <Wallet size={16} color="#37d7ff" /> Vendas vinculadas
          </div>
          {loadingVendas === sessao.id ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Carregando vendas...</p>
          ) : !vendas || vendas.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Nenhuma venda registrada nesta sessão.</p>
          ) : (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ padding: '6px 8px' }}>Pedido</th>
                  <th style={{ padding: '6px 8px' }}>Cliente</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    <td style={{ padding: '6px 8px' }}>#{venda.numeroPedido || venda.id.substring(0, 6).toUpperCase()}</td>
                    <td style={{ padding: '6px 8px' }}>{venda.clienteNome || '-'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>{currencyFormat(Number(venda.valorTotal || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="financeiro-page" style={{ padding: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Wallet size={26} color="#f59e0b" />
            Caixa (Sessões PDV)
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>
            Abertura, sangria e fechamento de todos os caixas da Frente de Caixa
          </p>
        </div>
      </div>

      <div className="card" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px', marginBottom: '24px' }}>
        <div className="section-header" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={20} color="#10b981" />
          <h3 style={{ margin: 0 }}>Caixas abertos agora</h3>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Operador</th>
                <th style={{ padding: '12px 8px' }}>Aberto em</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Total sangrias</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : caixasAbertos.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhum caixa aberto no momento.</td></tr>
              ) : (
                caixasAbertos.flatMap((sessao) => [
                  <tr key={sessao.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => toggleExpand(sessao)}>
                    <td style={{ padding: '10px 8px', fontWeight: 500 }}>{sessao.operadorNome}</td>
                    <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.createdAt)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoInicialCentavos))}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b' }}>{currencyFormat(fromCents(sessao.totalSangriasCentavos))}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>{expandedId === sessao.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                  </tr>,
                  renderExpandedRow(sessao, 5),
                ])
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card list-container" style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: '24px' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={20} color="#37d7ff" />
            <h3 style={{ margin: 0 }}>Histórico de sessões</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
            <select
              value={diasFiltro}
              onChange={(e) => setDiasFiltro(Number(e.target.value))}
              style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: 'var(--radius-md)' }}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={15}>Últimos 15 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value={0}>Todo o período</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table financeiro-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 8px' }}>Operador</th>
                <th style={{ padding: '12px 8px' }}>Abertura</th>
                <th style={{ padding: '12px 8px' }}>Fechamento</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Sangrias</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Esperado</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Informado</th>
                <th style={{ padding: '12px 8px', textAlign: 'right' }}>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px' }}>Carregando...</td></tr>
              ) : historico.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>Nenhuma sessão fechada no período selecionado.</td></tr>
              ) : (
                historico.flatMap((sessao) => {
                  const diferenca = sessao.diferencaCentavos || 0;
                  return [
                    <tr key={sessao.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }} onClick={() => toggleExpand(sessao)}>
                      <td style={{ padding: '10px 8px', fontWeight: 500 }}>{sessao.operadorNome}</td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.createdAt)}</td>
                      <td style={{ padding: '10px 8px', color: 'var(--text-muted)' }}>{formatDateTime(sessao.fechadoEm)}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoInicialCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: '#f59e0b' }}>{currencyFormat(fromCents(sessao.totalSangriasCentavos))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoEsperadoCentavos || 0))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>{currencyFormat(fromCents(sessao.saldoFinalInformadoCentavos || 0))}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: diferenca === 0 ? '#10b981' : diferenca > 0 ? '#37d7ff' : '#ef4444' }}>
                        {diferenca > 0 ? '+' : ''}{currencyFormat(fromCents(diferenca))}
                      </td>
                    </tr>,
                    renderExpandedRow(sessao, 8),
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CaixaRegistros;
