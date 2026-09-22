import React, { useMemo, useState } from 'react';
import { Eye, IdCard, Plus, Search, Truck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { CampoFiltro, CampoPeriodo, PainelFiltros, BotaoFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import { dentroDoPeriodo } from '../../utils/filtroListaDomain';
import { rotuloDoTipoDespesa, totaisPorTipo, type DespesaRota } from '../../utils/rotaDomain';

/**
 * ROTAS LANCADAS: lista + o relatorio por motorista no mesmo lugar.
 *
 * O dono pediu "olhar como esta a questao do controle de rota": o que ele
 * precisa ver e' quanto cada motorista gastou, em que, e em qual periodo.
 * Uma tela so' resolve -- filtra por motorista e por periodo, e o resumo do
 * topo responde a pergunta sem precisar de um relatorio separado.
 */

interface RotaDoc {
  id: string;
  motoristaId?: string;
  motoristaNome?: string;
  veiculo?: string;
  data?: string;
  observacao?: string;
  despesas?: DespesaRota[];
  total?: number;
  totalCentavos?: number;
}

const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

const RotasList: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { linha } = useLinhaSelecionavel();
  const { items: rotas, loading } = useTenantCollection<RotaDoc>('rotas', tenantId);
  const { items: motoristas } = useTenantCollection<{ id: string; nome?: string }>('motoristas', tenantId);

  const [busca, setBusca] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [motoristaId, setMotoristaId] = useState('');
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => (
    rotas
      .filter((r) => !motoristaId || r.motoristaId === motoristaId)
      .filter((r) => dentroDoPeriodo(r.data || '', periodoDe, periodoAte))
      .filter((r) => !termo
        || String(r.motoristaNome || '').toLowerCase().includes(termo)
        || String(r.veiculo || '').toLowerCase().includes(termo)
        || String(r.observacao || '').toLowerCase().includes(termo))
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  ), [rotas, motoristaId, periodoDe, periodoAte, termo]);

  // Resumo do que esta na tela: e' o "relatorio" que o dono precisa.
  const resumo = useMemo(() => {
    const todasAsDespesas = filtradas.flatMap((r) => r.despesas || []);
    const totalCentavos = filtradas.reduce((soma, r) => soma + Number(r.totalCentavos || Math.round(Number(r.total || 0) * 100)), 0);
    return { totalCentavos, porTipo: totaisPorTipo(todasAsDespesas) };
  }, [filtradas]);

  const filtrosAtivos = (motoristaId ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);
  const limparFiltros = () => { setMotoristaId(''); setPeriodoDe(''); setPeriodoAte(''); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Truck size={26} color="var(--accent-purple)" />
            Rotas e Despesas de Viagem
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Combustível, pedágio, alimentação e hospedagem por motorista e por dia — lançados de uma vez, já no financeiro.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => openTab('/operacoes/motoristas')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IdCard size={17} /> Motoristas
          </button>
          <button className="btn-primary" onClick={() => openTab('/operacoes/rotas/nova')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Nova Rota
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '20px 24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {filtrosAtivos > 0 ? 'Gasto no filtro atual' : 'Gasto em todas as rotas'}
          </div>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#ef4444' }}>{moeda(resumo.totalCentavos / 100)}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>{filtradas.length} rota(s)</div>
        </div>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {resumo.porTipo.map((t) => (
            <div key={t.tipo}>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.label}</div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{moeda(t.totalCentavos / 100)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar por motorista, veículo ou observação..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
        </div>

        <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={limparFiltros}>
          <CampoFiltro rotulo="Motorista">
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} style={estiloCampoFiltro}>
              <option value="">Todos</option>
              {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </CampoFiltro>
          <CampoPeriodo rotulo="Data da rota" de={periodoDe} ate={periodoAte} onChangeDe={setPeriodoDe} onChangeAte={setPeriodoAte} />
        </PainelFiltros>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '13px', textTransform: 'uppercase' }}>
                <th style={{ padding: '14px' }}>Data</th>
                <th style={{ padding: '14px' }}>Motorista</th>
                <th style={{ padding: '14px' }}>Veículo</th>
                <th style={{ padding: '14px' }}>Despesas</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '30px' }}>Carregando rotas...</td></tr>
              ) : filtradas.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <Truck size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{rotas.length === 0 ? 'Nenhuma rota lançada ainda.' : 'Nenhuma rota com esses filtros.'}</div>
                  </td>
                </tr>
              ) : filtradas.map((rota) => {
                const tipos = totaisPorTipo(rota.despesas || []);
                return (
                  <tr key={rota.id} {...linha(rota.id, () => openTab(`/operacoes/rotas/${rota.id}`))} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px' }}>{String(rota.data || '').split('-').reverse().join('/')}</td>
                    <td style={{ padding: '14px', fontWeight: 600 }}>{rota.motoristaNome || '-'}</td>
                    <td style={{ padding: '14px' }}>{rota.veiculo || '-'}</td>
                    <td style={{ padding: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {tipos.length > 0
                        ? tipos.map((t) => rotuloDoTipoDespesa(t.tipo)).join(', ')
                        : '-'}
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>
                      {moeda(Number(rota.totalCentavos || 0) / 100 || Number(rota.total || 0))}
                    </td>
                    <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                      <button className="icon-btn" title="Abrir a rota" onClick={() => openTab(`/operacoes/rotas/${rota.id}`)} style={{ color: '#3b82f6' }}>
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

export default RotasList;
