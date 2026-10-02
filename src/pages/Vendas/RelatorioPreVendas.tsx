import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { compararPorNumero, useOrdemNumero } from '../../hooks/useOrdemNumero';
import { ClipboardList, FileText, FilterX, Loader2, Search } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateInputPtBr, getDateInputInTimeZone } from '../../utils/dateTime';
import { fromCents } from '../../utils/financeDomain';
import { isPedidoAberto, type OrigemPedido } from '../../utils/preVendaDomain';
import { filtrarVendasVisiveis } from '../../utils/visibilidadeVendasDomain';
import { rotuloNotaFiscalPedido } from '../../utils/pedidoVendedorDomain';
import { hasTenantFullAccess } from '../../utils/roles';
import { nomeArquivoRelatorio } from '../../utils/relatorioPdfDomain';
import {
  filtrarPreVendas,
  linhaDePreVenda,
  montarDocumentoPreVendas,
  totaisPreVendas,
  type PreVendaDoRelatorio,
} from '../../utils/relatorioPreVendasDomain';
import RelatorioPreview from '../../components/Reports/RelatorioPreview';

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
 *
 * Relatorio (padrao do sistema, 2026-10-02): o antigo "Exportar CSV" virou
 * "Gerar relatório", que abre no RelatorioPreview (PDF, colunas por caixa de
 * marcar, Excel dentro da visualizacao) com exatamente o que esta filtrado
 * aqui. A conversao dados -> documento mora em relatorioPreVendasDomain.ts.
 */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
};

/** Uma linha da tela = uma linha do relatorio. */
type PreVendaLinha = PreVendaDoRelatorio;

const RelatorioPreVendas: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId, currentUser, vendasVisiveisDeUsuarioId, userRole, isOwner } = useAuth();
  // Funcionario comum nao ve valor nem contagem em resumo nenhum -- so' dono
  // e gestor (Master/Admin) enxergam este quadro de totais.
  const podeVerResumo = hasTenantFullAccess(userRole, isOwner);
  const [linhas, setLinhas] = useState<PreVendaLinha[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [ordemNumero, inverterOrdemNumero] = useOrdemNumero('preVendas.ordemNumero');
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
        const dados: PreVendaLinha[] = filtrarVendasVisiveis(
          pedidosSnap.docs.map((documento) => ({ id: documento.id, ...documento.data() } as any)),
          vendasVisiveisDeUsuarioId,
        )
          // So o que esta EM ABERTO. Pedido finalizado ja e' faturamento e
          // vive no Relatório de Vendas; cancelado nao interessa aqui.
          .filter((pedido) => isPedidoAberto(pedido.status))
          .map((pedido) => linhaDePreVenda(pedido, usuarios, hoje))
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
  }, [currentUser, tenantId, vendasVisiveisDeUsuarioId]);

  const filtro = useMemo(
    () => ({ busca, origem: origemFiltro, de: dataInicio, ate: dataFim }),
    [busca, origemFiltro, dataInicio, dataFim],
  );

  const linhasFiltradas = useMemo(() => (
    filtrarPreVendas(linhas, filtro)
      .sort((a, b) => compararPorNumero(a.numeroPedido, b.numeroPedido, ordemNumero))
  ), [linhas, filtro, ordemNumero]);

  const totais = useMemo(() => totaisPreVendas(linhasFiltradas), [linhasFiltradas]);

  // O relatorio sai com exatamente o que esta na tela (filtro + ordem).
  const [previewAberto, setPreviewAberto] = useState(false);
  const documento = useMemo(
    () => (previewAberto ? montarDocumentoPreVendas(linhasFiltradas, filtro, podeVerResumo) : null),
    [previewAberto, linhasFiltradas, filtro, podeVerResumo],
  );

  const limparFiltros = () => {
    setBusca('');
    setOrigemFiltro('');
    setDataInicio('');
    setDataFim('');
  };

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId="pre-vendas-abertas"
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio('Pré-vendas em Aberto', dataInicio || getDateInputInTimeZone(), dataFim || getDateInputInTimeZone())}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar às pré-vendas"
      />
    );
  }

  return (
    <div className="os-page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="header-title-group">
          <div>
            <h1 className="page-title">Pré-vendas em Aberto</h1>
            <p className="page-subtitle">Pedidos gravados que ainda não viraram venda</p>
          </div>
        </div>
        <button
          className="btn-secondary"
          onClick={() => setPreviewAberto(true)}
          disabled={linhasFiltradas.length === 0}
          title="Abre em PDF o que está filtrado na tela (dali dá para imprimir, salvar o PDF ou salvar em Excel)"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FileText size={18} /> Gerar relatório
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

      {podeVerResumo && (
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
      )}

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
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                  <button type="button" onClick={inverterOrdemNumero} title="Inverter a ordem pelo número"
                    style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Número {ordemNumero === 'asc' ? '▲' : '▼'}
                  </button>
                  </th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Data</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Em aberto</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Cliente</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Vendedor</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Origem</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Estoque</th>
                  <th style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>Nota fiscal</th>
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
                    <td style={{ padding: '14px 16px' }}>
                      {rotuloNotaFiscalPedido(linha.comNotaFiscal) ? (
                        <span style={{
                          padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                          backgroundColor: rotuloNotaFiscalPedido(linha.comNotaFiscal)?.tom === 'com' ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.18)', color: rotuloNotaFiscalPedido(linha.comNotaFiscal)?.tom === 'com' ? '#10b981' : 'var(--text-muted)',
                        }}>
                          {rotuloNotaFiscalPedido(linha.comNotaFiscal)?.texto}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                      )}
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
