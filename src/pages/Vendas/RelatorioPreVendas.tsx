import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Download, FilterX, Loader2, Search } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { dateInputToUtcStart, formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import { toCents, fromCents } from '../../utils/financeDomain';
import { isPedidoAberto, resolveOrigemPedido, STATUS_PRE_VENDA, type OrigemPedido } from '../../utils/preVendaDomain';

/**
 * Relatorio de PRE-VENDAS EM ABERTO.
 *
 * Existe porque pre-venda nao pode aparecer em faturamento nem em caixa --
 * ela nao gerou lancamento financeiro nenhum. O Relatório de Vendas
 * (RelatoriosVendas.tsx) filtra esses pedidos justamente por isso, entao sem
 * esta tela o dinheiro "separado mas nao vendido" ficaria invisivel.
 *
 * O que se le aqui NAO e' receita: e' compromisso em aberto + estoque
 * reservado. A tela repete isso na cara do usuario de proposito, pra ninguem
 * somar esse total com o faturamento do mes.
 */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateInputToUtcStart(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/** BOM UTF-8 na frente do CSV -- sem ele o Excel abre "Pré-venda" como
 * "PrÃ©-venda" no duplo clique. Escrito como escape, nao como o caractere
 * literal, que e' invisivel no editor e o lint recusa. */
const BOM_EXCEL = '\uFEFF';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
};

interface PreVendaLinha {
  id: string;
  numeroPedido: string;
  clienteNome: string;
  vendedorNome: string;
  origem: OrigemPedido;
  status: string;
  data: Date | null;
  diasEmAberto: number;
  totalCents: number;
  itensCount: number;
  reservaEstoque: boolean;
}

const RelatorioPreVendas: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser } = useAuth();
  const [linhas, setLinhas] = useState<PreVendaLinha[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [origemFiltro, setOrigemFiltro] = useState<'' | OrigemPedido>('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    let cancelado = false;

    const carregar = async () => {
      if (!tenantId || !currentUser) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const [pedidosSnap, usuariosSnap] = await Promise.all([
          getDocs(query(collection(db, 'pedidos_venda'), where('tenantId', '==', tenantId))),
          getDocs(query(collection(db, 'usuarios'), where('tenantId', '==', tenantId))),
        ]);
        if (cancelado) return;

        const usuarios: Record<string, any> = {};
        usuariosSnap.forEach((documento) => { usuarios[documento.id] = documento.data(); });

        const hoje = new Date();
        const dados: PreVendaLinha[] = pedidosSnap.docs
          .map((documento) => ({ id: documento.id, ...documento.data() } as any))
          // So o que esta EM ABERTO. Pedido finalizado ja e' faturamento e
          // vive no Relatório de Vendas; cancelado nao interessa aqui.
          .filter((pedido) => isPedidoAberto(pedido.status))
          .map((pedido) => {
            const data = toDate(pedido.dataVenda) || toDate(pedido.createdAt);
            const vendedor = usuarios[pedido.vendedorId || pedido.usuarioResponsavelId || ''];
            return {
              id: pedido.id,
              numeroPedido: pedido.numeroPedido || '',
              clienteNome: pedido.clienteNome || 'Não informado',
              vendedorNome: pedido.vendedorNome || vendedor?.nome || vendedor?.nomeResponsavel || 'Não identificado',
              origem: resolveOrigemPedido(pedido),
              status: pedido.status || STATUS_PRE_VENDA,
              data,
              diasEmAberto: data ? Math.max(0, Math.floor((hoje.getTime() - data.getTime()) / 86400000)) : 0,
              totalCents: Number(pedido.valorTotalCentavos ?? toCents(pedido.valorTotal)),
              itensCount: Array.isArray(pedido.itens) ? pedido.itens.length : 0,
              reservaEstoque: pedido.estoqueReservado === true,
            };
          })
          .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

        setLinhas(dados);
      } catch (erro) {
        console.error('Erro ao carregar pré-vendas em aberto:', erro);
        if (!cancelado) setError('Não foi possível carregar as pré-vendas. Verifique sua conexão e permissões.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    void carregar();
    return () => { cancelado = true; };
  }, [currentUser, tenantId]);

  const linhasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const inicio = dataInicio ? dateInputToUtcStart(dataInicio) : null;
    const fim = dataFim ? dateInputToUtcStart(dataFim) : null;

    return linhas.filter((linha) => {
      if (origemFiltro && linha.origem !== origemFiltro) return false;
      if (inicio && (!linha.data || linha.data < inicio)) return false;
      // Comparacao inclusiva no dia final: soma 1 dia em vez de exigir hora
      // zero, senao uma pre-venda gravada as 14h do dia final ficaria fora.
      if (fim && (!linha.data || linha.data.getTime() >= fim.getTime() + 86400000)) return false;
      if (!termo) return true;
      return linha.clienteNome.toLowerCase().includes(termo)
        || linha.numeroPedido.toLowerCase().includes(termo)
        || linha.vendedorNome.toLowerCase().includes(termo);
    });
  }, [linhas, busca, origemFiltro, dataInicio, dataFim]);

  const totais = useMemo(() => ({
    quantidade: linhasFiltradas.length,
    valorCents: linhasFiltradas.reduce((soma, linha) => soma + linha.totalCents, 0),
    comReserva: linhasFiltradas.filter((linha) => linha.reservaEstoque).length,
    maisAntiga: linhasFiltradas.reduce((maximo, linha) => Math.max(maximo, linha.diasEmAberto), 0),
  }), [linhasFiltradas]);

  const exportarCsv = () => {
    const cabecalho = ['Número', 'Data', 'Dias em aberto', 'Cliente', 'Vendedor', 'Origem', 'Status', 'Itens', 'Estoque reservado', 'Valor'];
    const linhasCsv = linhasFiltradas.map((linha) => [
      linha.numeroPedido,
      linha.data ? formatDateInputPtBr(getDateInputInTimeZone(linha.data)) : '',
      linha.diasEmAberto,
      linha.clienteNome,
      linha.vendedorNome,
      linha.origem === 'agente' ? 'Agente (WhatsApp)' : 'Balcão',
      linha.status,
      linha.itensCount,
      linha.reservaEstoque ? 'Sim' : 'Não',
      fromCents(linha.totalCents).toFixed(2),
    ]);
    const csv = [cabecalho, ...linhasCsv].map((linha) => linha.map(csvCell).join(';')).join('\n');
    // BOM na frente pro Excel abrir acentuacao certa direto do duplo clique.
    const blob = new Blob([BOM_EXCEL + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pre-vendas-em-aberto-${getDateInputInTimeZone()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const limparFiltros = () => {
    setBusca('');
    setOrigemFiltro('');
    setDataInicio('');
    setDataFim('');
  };

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="header-title-group">
          <div>
            <h1 className="page-title">Pré-vendas em Aberto</h1>
            <p className="page-subtitle">Pedidos gravados que ainda não viraram venda</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={exportarCsv} disabled={linhasFiltradas.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Download size={18} /> Exportar CSV
        </button>
      </div>

      {/* Aviso permanente, nao dispensavel: o numero grande desta tela e' a
          coisa mais facil de confundir com faturamento no sistema inteiro. */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}>
        <strong style={{ color: '#f59e0b' }}>Estes valores não são faturamento.</strong>
        <span style={{ color: 'var(--text-secondary)' }}>
          {' '}Pré-venda em aberto não gerou nenhum lançamento financeiro: não entra no caixa, no Relatório de Vendas nem em comissão.
          O estoque está <strong>reservado</strong>, não baixado. Tudo isso só acontece quando alguém finaliza a venda.
        </span>
      </div>

      <div className="card form-section" style={{ padding: '20px', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'end' }}>
        <label className="input-group">
          <span>Buscar</span>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              style={{ ...inputStyle, paddingLeft: '32px' }}
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Cliente, número ou vendedor"
            />
          </div>
        </label>
        <label className="input-group">
          <span>Origem</span>
          <select style={inputStyle} value={origemFiltro} onChange={(evento) => setOrigemFiltro(evento.target.value as '' | OrigemPedido)}>
            <option value="">Todas</option>
            <option value="balcao">Balcão (pré-venda)</option>
            <option value="agente">Agente (WhatsApp)</option>
          </select>
        </label>
        <label className="input-group">
          <span>De</span>
          <input type="date" style={inputStyle} value={dataInicio} onChange={(evento) => setDataInicio(evento.target.value)} />
        </label>
        <label className="input-group">
          <span>Até</span>
          <input type="date" style={inputStyle} value={dataFim} onChange={(evento) => setDataFim(evento.target.value)} />
        </label>
        <button className="btn-secondary" onClick={limparFiltros} style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
          <FilterX size={16} /> Limpar
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Pré-vendas em aberto</p>
          <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>{totais.quantidade}</p>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Valor comprometido (não é receita)</p>
          <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: '#f59e0b' }}>{currency.format(fromCents(totais.valorCents))}</p>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Com estoque reservado</p>
          <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>{totais.comReserva}</p>
        </div>
        <div className="card" style={{ padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>Mais antiga em aberto</p>
          <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)' }}>{totais.maisAntiga} dia(s)</p>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', color: 'var(--text-muted)' }}>
            <Loader2 size={20} className="spin" /> Carregando pré-vendas...
          </div>
        ) : error ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444' }}>{error}</div>
        ) : linhasFiltradas.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <ClipboardList size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <p style={{ margin: 0 }}>
              {linhas.length === 0
                ? 'Nenhuma pré-venda em aberto no momento.'
                : 'Nenhuma pré-venda encontrada com os filtros aplicados.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-tertiary)', textAlign: 'left' }}>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Número</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Data</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Em aberto</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Cliente</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Vendedor</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Origem</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Estoque</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.map((linha) => (
                  <tr
                    key={linha.id}
                    onDoubleClick={() => navigate(`/pedidos-venda/visualizar/${linha.id}`)}
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                    title="Duplo clique para abrir a pré-venda"
                  >
                    <td style={{ padding: '14px 16px', fontWeight: 600 }}>#{linha.numeroPedido}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                      {linha.data ? formatDateInputPtBr(getDateInputInTimeZone(linha.data)) : '—'}
                    </td>
                    <td style={{ padding: '14px 16px', color: linha.diasEmAberto > 7 ? '#f59e0b' : 'var(--text-secondary)' }}>
                      {linha.diasEmAberto} dia(s)
                    </td>
                    <td style={{ padding: '14px 16px' }}>{linha.clienteNome}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{linha.vendedorNome}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        backgroundColor: linha.origem === 'agente' ? 'rgba(59,130,246,0.2)' : 'rgba(245,158,11,0.2)',
                        color: linha.origem === 'agente' ? '#3b82f6' : '#f59e0b',
                        padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
                      }}>
                        {linha.origem === 'agente' ? 'Agente' : 'Balcão'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      {linha.reservaEstoque ? 'Reservado' : 'Sem reserva'}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600 }}>
                      {currency.format(fromCents(linha.totalCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default RelatorioPreVendas;
