import React, { useMemo, useState } from 'react';
import { Eye, Plus, Search, Tag } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { getDateInputInTimeZone } from '../../utils/dateTime';
import {
  lerPromocao,
  resumoDoPeriodo,
  ROTULO_STATUS_PROMOCAO,
  statusDaPromocao,
  type PromocaoComId,
  type StatusPromocao,
} from '../../utils/promocaoDomain';

/**
 * PROMOCOES (2026-10-01; modelo: Vendas > Promocoes do Uniplus). Lista as
 * promocoes por situacao. Promocao individual (criada no cadastro do produto)
 * aparece aqui tambem, marcada -- e' o mesmo registro.
 */

type Aba = StatusPromocao | 'todas';
const ABAS: Aba[] = ['vigente', 'agendada', 'encerrada', 'inativa', 'todas'];
const ROTULO_ABA: Record<Aba, string> = { ...ROTULO_STATUS_PROMOCAO, todas: 'Todas' };
const COR: Record<StatusPromocao, string> = { vigente: '#10b981', agendada: '#3b82f6', encerrada: '#94a3b8', inativa: '#ef4444' };

const PromocoesList: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { linha } = useLinhaSelecionavel();
  const { items: brutas, loading } = useTenantCollection<{ id: string } & Record<string, unknown>>('promocoes', tenantId);
  const hoje = getDateInputInTimeZone();
  const promocoes = useMemo<PromocaoComId[]>(() => brutas.map((p) => ({ ...lerPromocao(p), id: p.id })), [brutas]);
  const [aba, setAba] = useState<Aba>('vigente');
  const [busca, setBusca] = useState('');

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => promocoes
    .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || p.itens.some((i) => i.nome.toLowerCase().includes(termo) || i.codigo.toLowerCase() === termo))
    .sort((a, b) => b.dataInicio.localeCompare(a.dataInicio)), [promocoes, termo]);
  const contagem = useMemo(() => {
    const c: Record<Aba, number> = { vigente: 0, agendada: 0, encerrada: 0, inativa: 0, todas: filtradas.length };
    filtradas.forEach((p) => { c[statusDaPromocao(p, hoje)] += 1; });
    return c;
  }, [filtradas, hoje]);
  const daAba = aba === 'todas' ? filtradas : filtradas.filter((p) => statusDaPromocao(p, hoje) === aba);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Tag size={26} color="var(--accent-purple)" /> Promoções
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Coloque vários produtos em promoção de uma vez, com período, dias da semana, forma de pagamento e quantidade. Na venda, o preço promocional entra sozinho.
          </p>
        </div>
        <button className="btn-primary" onClick={() => openTab('/vendas/promocoes/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} /> Nova promoção
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Nome da promoção, produto ou código..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {ABAS.map((chave) => (
            <button key={chave} type="button" className={aba === chave ? 'btn-primary' : 'btn-secondary'} onClick={() => setAba(chave)} style={{ padding: '8px 14px', fontSize: '13px' }}>
              {ROTULO_ABA[chave]} ({contagem[chave]})
            </button>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Promoção</th>
                <th style={{ padding: '14px' }}>Período</th>
                <th style={{ padding: '14px' }}>Pagamento</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Produtos</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px' }}>Carregando promoções...</td></tr>
              ) : daAba.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <Tag size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{promocoes.length === 0 ? 'Nenhuma promoção ainda. Clique em "Nova promoção".' : `Nenhuma promoção "${ROTULO_ABA[aba]}".`}</div>
                  </td>
                </tr>
              ) : daAba.map((p) => {
                const status = statusDaPromocao(p, hoje);
                const abrir = () => openTab(`/vendas/promocoes/${p.id}`);
                return (
                  <tr key={p.id} {...linha(p.id, abrir)} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px', fontWeight: 700 }}>
                      {p.nome}
                      {p.individual && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>individual</span>}
                    </td>
                    <td style={{ padding: '14px', fontSize: '13.5px' }}>{resumoDoPeriodo(p)}</td>
                    <td style={{ padding: '14px', fontSize: '13.5px' }}>{p.formas === 'vista' ? 'Só à vista' : 'Todas as formas'}</td>
                    <td style={{ padding: '14px', textAlign: 'center' }}>{p.itens.length}</td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, color: COR[status], backgroundColor: `${COR[status]}22` }}>
                        {ROTULO_STATUS_PROMOCAO[status]}
                      </span>
                    </td>
                    <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                      <button className="icon-btn" title="Abrir a promoção" onClick={abrir} style={{ color: '#3b82f6' }}><Eye size={18} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PromocoesList;
