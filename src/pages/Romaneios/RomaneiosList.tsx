import React, { useMemo, useState } from 'react';
import { ClipboardList, Eye, FileText, Plus, Search, Truck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTabs } from '../../contexts/TabsContext';
import { useTenantCollection } from '../../hooks/useTenantCollection';
import { semAbrirLinha, useLinhaSelecionavel } from '../../hooks/useLinhaSelecionavel';
import { CampoFiltro, CampoPeriodo, PainelFiltros, BotaoFiltros, estiloCampoFiltro } from '../../components/common/PainelFiltros';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';
import { dentroDoPeriodo } from '../../utils/filtroListaDomain';
import { addDaysToDateInput, getDateInputInTimeZone } from '../../utils/dateTime';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import { lerRomaneio } from '../../services/romaneioService';
import {
  montarDocumentoRelatorioRomaneios,
  resumoDoRomaneio,
  ROTULO_STATUS_ROMANEIO,
  tituloDoRomaneio,
  type RomaneioDaLista,
  type StatusRomaneio,
} from '../../utils/romaneioDomain';

/**
 * ROMANEIOS DE ENTREGA (2026-10-01): as rotas montadas, por situacao, e o
 * relatorio do periodo em PDF (rotas, entregas, nao entregues por motivo).
 */

type Aba = StatusRomaneio | 'todos';
const ABAS: Aba[] = ['montagem', 'em_rota', 'fechado', 'cancelado', 'todos'];
const ROTULO_ABA: Record<Aba, string> = { ...ROTULO_STATUS_ROMANEIO, todos: 'Todos' };

const COR_STATUS: Record<StatusRomaneio, string> = {
  montagem: '#f59e0b',
  em_rota: '#3b82f6',
  fechado: '#10b981',
  cancelado: '#94a3b8',
};

const moeda = (centavos: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (data: string) => (data ? data.split('-').reverse().join('/') : '—');

const RomaneiosList: React.FC = () => {
  const { tenantId } = useAuth();
  const { openTab } = useTabs();
  const { linha } = useLinhaSelecionavel();
  const { items: brutos, loading } = useTenantCollection<{ id: string } & Record<string, unknown>>('romaneios', tenantId);
  const { items: motoristas } = useTenantCollection<{ id: string; nome?: string }>('motoristas', tenantId);
  const romaneios = useMemo<RomaneioDaLista[]>(() => brutos.map((r) => ({ ...lerRomaneio(r), id: r.id })), [brutos]);

  const [aba, setAba] = useState<Aba>('montagem');
  const [busca, setBusca] = useState('');
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [motoristaId, setMotoristaId] = useState('');
  const [periodoDe, setPeriodoDe] = useState('');
  const [periodoAte, setPeriodoAte] = useState('');
  const hoje = getDateInputInTimeZone();
  const [relatorio, setRelatorio] = useState<{ de: string; ate: string } | null>(null);

  const termo = busca.trim().toLowerCase();
  const filtrados = useMemo(() => romaneios
    .filter((r) => !motoristaId || r.motoristaId === motoristaId)
    .filter((r) => dentroDoPeriodo(r.dataSaida, periodoDe, periodoAte))
    .filter((r) => !termo
      || tituloDoRomaneio(r.numero, r.nome).toLowerCase().includes(termo)
      || r.motoristaNome.toLowerCase().includes(termo)
      || r.veiculoDescricao.toLowerCase().includes(termo)
      || r.entregas.some((e) => e.numeroPedido.includes(termo) || e.clienteNome.toLowerCase().includes(termo) || e.notaNumero.includes(termo)))
    .sort((a, b) => b.dataSaida.localeCompare(a.dataSaida) || b.numero - a.numero), [romaneios, motoristaId, periodoDe, periodoAte, termo]);

  const contagem = useMemo(() => {
    const c: Record<Aba, number> = { montagem: 0, em_rota: 0, fechado: 0, cancelado: 0, todos: filtrados.length };
    filtrados.forEach((r) => { c[r.status] += 1; });
    return c;
  }, [filtrados]);
  const daAba = aba === 'todos' ? filtrados : filtrados.filter((r) => r.status === aba);

  const filtrosAtivos = (motoristaId ? 1 : 0) + (periodoDe || periodoAte ? 1 : 0);

  if (relatorio) {
    const motorista = motoristas.find((m) => m.id === motoristaId);
    return (
      <RelatorioPreview
        relatorioId="romaneios-periodo"
        documento={montarDocumentoRelatorioRomaneios(romaneios, { ...relatorio, motoristaId }, motorista?.nome)}
        nomeArquivo={nomeArquivoRelatorio('Romaneios', relatorio.de, relatorio.ate)}
        onFechar={() => setRelatorio(null)}
        rotuloFechar="Voltar aos romaneios"
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardList size={26} color="var(--accent-purple)" />
            Romaneio de Entrega
          </h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>
            Monte a rota com os pedidos faturados, imprima para o motorista, registre as entregas e feche o acerto na volta.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn-secondary"
            onClick={() => setRelatorio({ de: periodoDe || addDaysToDateInput(hoje, -30), ate: periodoAte || hoje })}
            title={periodoDe || periodoAte ? 'Relatório do período filtrado' : 'Relatório dos últimos 30 dias (use o filtro de período para mudar)'}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <FileText size={17} /> Relatório
          </button>
          <button className="btn-secondary" onClick={() => openTab('/operacoes/motoristas')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Truck size={17} /> Motoristas
          </button>
          <button className="btn-primary" onClick={() => openTab('/operacoes/romaneios/novo')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={18} /> Novo romaneio
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Rota, motorista, veículo, nº do pedido, nota ou cliente..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: '100%', padding: '10px 14px 10px 42px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
          </div>
          <BotaoFiltros aberto={filtrosAbertos} onToggle={() => setFiltrosAbertos((v) => !v)} quantidadeAtiva={filtrosAtivos} />
        </div>

        <PainelFiltros aberto={filtrosAbertos} quantidadeAtiva={filtrosAtivos} onLimpar={() => { setMotoristaId(''); setPeriodoDe(''); setPeriodoAte(''); }}>
          <CampoFiltro rotulo="Motorista">
            <select value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)} style={estiloCampoFiltro}>
              <option value="">Todos</option>
              {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </CampoFiltro>
          <CampoPeriodo rotulo="Data de saída" de={periodoDe} ate={periodoAte} onChangeDe={setPeriodoDe} onChangeAte={setPeriodoAte} />
        </PainelFiltros>

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
                <th style={{ padding: '14px' }}>Rota</th>
                <th style={{ padding: '14px' }}>Saída</th>
                <th style={{ padding: '14px' }}>Motorista</th>
                <th style={{ padding: '14px' }}>Veículo</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Entregas</th>
                <th style={{ padding: '14px', textAlign: 'right' }}>Valor</th>
                <th style={{ padding: '14px' }}>Situação</th>
                <th style={{ padding: '14px', textAlign: 'center' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px' }}>Carregando romaneios...</td></tr>
              ) : daAba.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <ClipboardList size={44} style={{ margin: '0 auto 14px', opacity: 0.25 }} />
                    <div>{romaneios.length === 0 ? 'Nenhum romaneio ainda. Clique em "Novo romaneio" para montar a primeira rota.' : `Nenhum romaneio "${ROTULO_ABA[aba]}" com esses filtros.`}</div>
                  </td>
                </tr>
              ) : daAba.map((r) => {
                const resumo = resumoDoRomaneio(r);
                const abrir = () => openTab(`/operacoes/romaneios/${r.id}`);
                return (
                  <tr key={r.id} {...linha(r.id, abrir)} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px', fontWeight: 700 }}>{tituloDoRomaneio(r.numero, r.nome)}</td>
                    <td style={{ padding: '14px' }}>{dataBr(r.dataSaida)} {r.horarioSaida}</td>
                    <td style={{ padding: '14px' }}>{r.motoristaNome || '—'}</td>
                    <td style={{ padding: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>{r.veiculoDescricao || '—'}</td>
                    <td style={{ padding: '14px', textAlign: 'center' }}>
                      {r.status === 'montagem' ? resumo.totalEntregas : `${resumo.entregues}/${resumo.totalEntregas}`}
                      {resumo.naoEntregues > 0 && <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '12px' }}>({resumo.naoEntregues} não)</span>}
                    </td>
                    <td style={{ padding: '14px', textAlign: 'right', fontWeight: 600 }}>{moeda(resumo.valorTotalCentavos)}</td>
                    <td style={{ padding: '14px' }}>
                      <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700, color: COR_STATUS[r.status], backgroundColor: `${COR_STATUS[r.status]}22` }}>
                        {ROTULO_STATUS_ROMANEIO[r.status]}
                      </span>
                    </td>
                    <td {...semAbrirLinha} style={{ padding: '14px', textAlign: 'center' }}>
                      <button className="icon-btn" title="Abrir o romaneio" onClick={abrir} style={{ color: '#3b82f6' }}>
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

export default RomaneiosList;
