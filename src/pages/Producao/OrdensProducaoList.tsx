import React, { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { usePendentesEPeriodo } from '../../hooks/usePendentesEPeriodo';
import AvisoHistoricoDoPeriodo from '../../components/common/AvisoHistoricoDoPeriodo';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { DICA_BUSCA_MULTIPLA, matchesAllSearchTerms } from '../../utils/textSearch';
import { useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import EstadoVazio from '../../components/common/EstadoVazio';

type StatusOrdem = 'criada' | 'em_producao' | 'pausada' | 'finalizada' | 'cancelada' | 'estornada';

interface OrdemProducaoData {
  id: string;
  numero: string;
  produtoNome: string;
  quantidadePlanejada: number;
  quantidadeProduzida: number | null;
  status: StatusOrdem;
  responsavelNome: string;
}

const STATUS_LABELS: Record<StatusOrdem, string> = {
  criada: 'Criada',
  em_producao: 'Em Produção',
  pausada: 'Pausada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
  estornada: 'Estornada',
};

const STATUS_COLORS: Record<StatusOrdem, string> = {
  criada: '#3b82f6',
  em_producao: '#8b5cf6',
  pausada: '#f59e0b',
  finalizada: '#10b981',
  cancelada: '#ef4444',
  estornada: '#64748b',
};

const STATUS_FILTER_ORDER: StatusOrdem[] = ['criada', 'em_producao', 'pausada', 'finalizada', 'cancelada', 'estornada'];

/** Ordem que ainda esta' andando: aparece sempre, de qualquer data. */
const STATUS_ORDEM_PENDENTE: StatusOrdem[] = ['criada', 'em_producao', 'pausada'];

const OrdensProducaoList: React.FC = () => {
  const { linha } = useLinhaSelecionavel();
  const { openTab } = useTabs();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusOrdem | 'todas'>('todas');

  const { currentUser, tenantId } = useAuth();

  // Criadas, em producao e pausadas de qualquer data; finalizadas,
  // canceladas e estornadas, deste mes -- ou de todo o periodo quando a
  // pessoa pede (otimizacao de leituras, 2026-10-14; ver usePendentesEPeriodo).
  const [todoPeriodo, setTodoPeriodo] = useState(false);
  const inicioDoMes = `${getDateInputInTimeZone().slice(0, 7)}-01`;
  const { items, loading } = usePendentesEPeriodo<OrdemProducaoData>('ordens_producao', tenantId, {
    statusPendentes: STATUS_ORDEM_PENDENTE,
    campoData: 'createdAt',
    tipoData: 'timestamp',
    de: todoPeriodo ? '' : inicioDoMes,
    ate: '',
    enabled: Boolean(currentUser),
  });
  const ordens = useMemo(() => [...items].sort((a, b) => String(b.numero || '').localeCompare(String(a.numero || ''))), [items]);

  const filteredOrdens = ordens.filter(ordem => {
    if (statusFilter !== 'todas' && ordem.status !== statusFilter) return false;
    // Acento nao conta e "+" exige todas as palavras, igual as telas de venda.
    return matchesAllSearchTerms([ordem.numero, ordem.produtoNome], searchTerm);
  });

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Ordens de Produção</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)' }}>Entrada de matéria-prima → Estoque → Ordem de Produção → Produto Acabado</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-primary" onClick={() => openTab('/producao/ordens/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Ordem
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <button
          onClick={() => setStatusFilter('todas')}
          style={{
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: statusFilter === 'todas' ? 'var(--accent-purple)' : 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontWeight: 600,
            fontSize: '13px',
          }}
        >
          Todas
        </button>
        {STATUS_FILTER_ORDER.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: statusFilter === status ? STATUS_COLORS[status] : 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {(statusFilter === 'todas' || !STATUS_ORDEM_PENDENTE.includes(statusFilter)) && (
        <div style={{ marginTop: '-20px' }}>
          <AvisoHistoricoDoPeriodo
            todoPeriodo={todoPeriodo}
            onAlternar={() => setTodoPeriodo((atual) => !atual)}
            textoRecente="Criadas, em produção e pausadas de qualquer data; finalizadas, canceladas e estornadas, só as deste mês."
            textoTodo="Ordens de todo o período."
            botaoRecente="Ver só as deste mês"
          />
        </div>
      )}

      <div className="card list-container" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div className="list-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div className="search-box" style={{ position: 'relative', width: '350px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número ou produto"
              title={DICA_BUSCA_MULTIPLA}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: '100%', padding: '10px 16px 10px 40px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Produto</th>
                <th>Qtd. Planejada</th>
                <th>Qtd. Produzida</th>
                <th>Status</th>
                <th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '20px' }}>Carregando ordens de produção...</td>
                </tr>
              ) : filteredOrdens.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '8px' }}>
                    <EstadoVazio titulo={searchTerm ? `Nenhum resultado encontrado para "${searchTerm}".` : statusFilter !== 'todas' ? `Nenhuma ordem com status "${STATUS_LABELS[statusFilter]}".` : "Nenhuma ordem de produção cadastrada."} compacto />
                  </td>
                </tr>
              ) : (
                filteredOrdens.map((ordem) => (
                  <tr
                    key={ordem.id}
                    {...linha(ordem.id, () => openTab(`/producao/ordens/editar/${ordem.id}`))}
                  >
                    <td className="font-medium">{ordem.numero}</td>
                    <td>{ordem.produtoNome}</td>
                    <td>{ordem.quantidadePlanejada}</td>
                    <td>{ordem.quantidadeProduzida ?? '-'}</td>
                    <td>
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '12px', fontWeight: 700, color: '#fff', backgroundColor: STATUS_COLORS[ordem.status] }}>
                        {STATUS_LABELS[ordem.status]}
                      </span>
                    </td>
                    <td>{ordem.responsavelNome || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OrdensProducaoList;
