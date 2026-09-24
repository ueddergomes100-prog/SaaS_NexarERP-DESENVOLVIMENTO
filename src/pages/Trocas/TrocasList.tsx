import React, { useMemo, useState } from 'react';
import { AlertTriangle, Eye, Plus, Printer, Repeat, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { PEDIDO_PRINT_LOTE_SAFETY_LIMIT } from '../Vendas/pedidoPrintLoteConstants';
import { showWarning } from '../../utils/alerts';
import { COR_CONFERENCIA, ROTULO_CONFERENCIA } from '../../utils/conferenciaDomain';
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
  const navigate = useNavigate();
  const { linha } = useLinhaSelecionavel();
  const { items, loading } = useTenantCollection<TrocaFirestore & { id: string }>('trocas', tenantId);
  const [aba, setAba] = useState<StatusTroca | 'todas'>('Solicitada');
  const [busca, setBusca] = useState('');
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

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

  // Selecao para imprimir varias minutas de uma vez. So' conta o que esta na
  // lista agora: trocar de aba ou buscar nao deixa selecao escondida.
  const idsVisiveis = filtradas.map((t) => t.id);
  const selecionadasVisiveis = idsVisiveis.filter((id) => selecionadas.has(id));
  const todasMarcadas = idsVisiveis.length > 0 && selecionadasVisiveis.length === idsVisiveis.length;

  const alternar = (id: string) => setSelecionadas((atual) => {
    const proximo = new Set(atual);
    if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
    return proximo;
  });
  const alternarTodas = () => setSelecionadas((atual) => {
    const proximo = new Set(atual);
    if (todasMarcadas) idsVisiveis.forEach((id) => proximo.delete(id)); else idsVisiveis.forEach((id) => proximo.add(id));
    return proximo;
  });

  const imprimirSelecionadas = () => {
    if (selecionadasVisiveis.length === 0) return;
    if (selecionadasVisiveis.length > PEDIDO_PRINT_LOTE_SAFETY_LIMIT) {
      showWarning('Muitas trocas de uma vez', `Serão impressas as ${PEDIDO_PRINT_LOTE_SAFETY_LIMIT} primeiras. Depois selecione o restante e imprima de novo.`);
    }
    navigate(`/vendas/trocas/minuta-lote?ids=${selecionadasVisiveis.slice(0, PEDIDO_PRINT_LOTE_SAFETY_LIMIT).join(',')}`);
  };

  // O nome da aba leva o numero da troca (sem isso ela herdaria o id cru do documento).
  const abrir = (troca: TrocaFirestore & { id: string }) => openTab(`/vendas/trocas/${troca.id}`, `Troca #${troca.numeroTroca}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Repeat size={28} color="var(--accent-purple)" />
          Trocas de Mercadoria
        </h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Reposição sem cobrança de produto estragado, pedida pelo vendedor no aplicativo ou lançada aqui. Aprove, separe e confirme a entrega para dar baixa no estoque.
        </p>
      </div>
        <button className="btn-primary" onClick={() => openTab('/vendas/trocas/nova', 'Nova troca')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={20} /> Nova troca
        </button>
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
          <button
            type="button"
            className="btn-secondary"
            onClick={imprimirSelecionadas}
            disabled={selecionadasVisiveis.length === 0}
            title={selecionadasVisiveis.length === 0 ? 'Marque as trocas na lista para imprimir as minutas de uma vez' : 'Imprimir a minuta de cada troca marcada'}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
          >
            <Printer size={18} /> Imprimir minutas{selecionadasVisiveis.length > 0 ? ` (${selecionadasVisiveis.length})` : ''}
          </button>
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
                <th style={{ padding: '14px', width: '44px' }}>
                  <input
                    type="checkbox"
                    aria-label="Marcar todas as trocas da lista"
                    title="Marcar todas as trocas da lista"
                    checked={todasMarcadas}
                    disabled={idsVisiveis.length === 0}
                    onChange={alternarTodas}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent-purple)' }}
                  />
                </th>
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
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px' }}>Carregando trocas...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Repeat size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>{items.length === 0 ? 'Nenhuma troca ainda. Elas chegam quando o vendedor envia pelo aplicativo.' : 'Nenhuma troca nesta situação.'}</p>
                  </td>
                </tr>
              ) : filtradas.map((troca) => {
                const estilo = ESTILO_STATUS_TROCA[troca.status] || ESTILO_STATUS_TROCA.Solicitada;
                const primeiro = troca.itens?.[0];
                return (
                  <tr key={troca.id} {...linha(troca.id, () => abrir(troca))} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td {...semAbrirLinha} style={{ padding: '14px' }}>
                      <input
                        type="checkbox"
                        aria-label={`Marcar a troca #${troca.numeroTroca}`}
                        checked={selecionadas.has(troca.id)}
                        onChange={() => alternar(troca.id)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--accent-purple)' }}
                      />
                    </td>
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
                      {troca.statusConferencia && troca.status !== 'Recusada' && troca.status !== 'Cancelada' && (
                        <span title={`Conferência: ${ROTULO_CONFERENCIA[troca.statusConferencia]}`} style={{ marginLeft: '8px', backgroundColor: `${COR_CONFERENCIA[troca.statusConferencia]}20`, color: COR_CONFERENCIA[troca.statusConferencia], padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                          {ROTULO_CONFERENCIA[troca.statusConferencia]}
                        </span>
                      )}
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
