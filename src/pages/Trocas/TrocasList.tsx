import React, { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Repeat, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { ESTILO_STATUS_TROCA, STATUS_TROCA_ORDEM, totalDeItens, type StatusTroca, type Troca } from '../../utils/trocaDomain';

/**
 * Lista das TROCAS de mercadoria (reposicao sem cobranca pedida pelo app do
 * vendedor). A loja aprova/recusa, imprime a minuta e confirma a entrega no
 * detalhe. Nao tem nada de financeiro: e' fila de separacao e baixa de estoque.
 */

type TrocaFirestore = Omit<Troca, 'createdAtMillis'> & { createdAt?: { toMillis?: () => number; seconds?: number } };

export const dataDaTrocaMillis = (t: Pick<TrocaFirestore, 'createdAt'>): number => (
  typeof t.createdAt?.toMillis === 'function' ? t.createdAt.toMillis() : (t.createdAt?.seconds || 0) * 1000
);

const formatarData = (millis: number) => (millis ? new Date(millis).toLocaleDateString('pt-BR') : '-');

const TrocasList: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { linha } = useLinhaSelecionavel();
  const { items, loading } = useTenantCollection<TrocaFirestore & { id: string }>('trocas', tenantId);
  const [aba, setAba] = useState<StatusTroca | 'todas'>('Solicitada');
  const [busca, setBusca] = useState('');

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todas: items.length };
    STATUS_TROCA_ORDEM.forEach((s) => { c[s] = items.filter((t) => t.status === s).length; });
    return c;
  }, [items]);

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => (
    items
      .filter((t) => aba === 'todas' || t.status === aba)
      .filter((t) => !termo
        || String(t.numeroTroca || '').includes(termo)
        || String(t.clienteNome || '').toLowerCase().includes(termo)
        || String(t.vendedorNome || '').toLowerCase().includes(termo))
      .sort((a, b) => dataDaTrocaMillis(b) - dataDaTrocaMillis(a))
  ), [items, aba, termo]);

  // O nome da aba leva o numero da troca (sem isso ela herdaria o id cru do documento).
  const abrir = (troca: TrocaFirestore & { id: string }) => openTab(`/vendas/trocas/${troca.id}`, `Troca #${troca.numeroTroca}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Repeat size={28} color="var(--accent-purple)" />
          Trocas de Mercadoria
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Reposição sem cobrança de produto estragado, pedida pelo vendedor no aplicativo. Aprove, separe e confirme a entrega para dar baixa no estoque.
        </p>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
            <Search size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por número, cliente ou vendedor..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '12px 16px 12px 48px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['Solicitada', 'Aprovada', 'Entregue', 'Recusada', 'Cancelada', 'todas'] as const).map((valor) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAba(valor)}
                style={{
                  padding: '8px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${aba === valor ? 'var(--accent-purple)' : 'var(--border-color)'}`,
                  backgroundColor: aba === valor ? 'var(--accent-purple)' : 'var(--bg-tertiary)',
                  color: aba === valor ? '#fff' : 'var(--text-primary)',
                }}
              >
                {valor === 'todas' ? 'Todas' : valor === 'Solicitada' ? 'Aguardando' : valor === 'Aprovada' ? 'Aprovadas' : valor === 'Entregue' ? 'Entregues' : valor === 'Recusada' ? 'Recusadas' : 'Canceladas'}
                {' '}({contagem[valor] || 0})
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Nº</th>
                <th style={{ padding: '14px' }}>Data</th>
                <th style={{ padding: '14px' }}>Cliente</th>
                <th style={{ padding: '14px' }}>Vendedor</th>
                <th style={{ padding: '14px' }}>Itens</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px' }}>Carregando trocas...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Repeat size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{items.length === 0 ? 'Nenhuma troca ainda. Elas chegam quando o vendedor envia pelo aplicativo.' : 'Nenhuma troca nesta situação.'}</p>
                  </td>
                </tr>
              ) : filtradas.map((troca) => {
                const estilo = ESTILO_STATUS_TROCA[troca.status] || ESTILO_STATUS_TROCA.Solicitada;
                const primeiro = troca.itens?.[0];
                return (
                  <tr key={troca.id} {...linha(troca.id, () => abrir(troca))} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px', fontWeight: 700 }}>#{troca.numeroTroca}</td>
                    <td style={{ padding: '14px' }}>{formatarData(dataDaTrocaMillis(troca))}</td>
                    <td style={{ padding: '14px' }}>{troca.clienteNome}</td>
                    <td style={{ padding: '14px' }}>{troca.vendedorNome || '-'}</td>
                    <td style={{ padding: '14px', fontSize: '13px' }}>
                      {primeiro ? `${primeiro.nome}` : '-'}
                      {(troca.itens?.length || 0) > 1 ? ` +${troca.itens.length - 1}` : ''}
                      <span style={{ color: 'var(--text-muted)' }}> · {totalDeItens(troca.itens || [])} un.</span>
                    </td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ backgroundColor: estilo.fundo, color: estilo.cor, padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                        {troca.status}
                      </span>
                      {(troca.avisos?.length || 0) > 0 && troca.status === 'Solicitada' && (
                        <span title={troca.avisos.map((a) => a.mensagem).join('\n')} style={{ marginLeft: '8px', color: '#f59e0b', verticalAlign: 'middle', display: 'inline-flex' }}>
                          <AlertTriangle size={16} />
                        </span>
                      )}
                    </td>
                    <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                      <button className="icon-btn" title="Abrir a troca" onClick={() => abrir(troca)} style={{ color: '#3b82f6' }}>
                        <Eye size={18} />
                      </button>
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

export default TrocasList;
