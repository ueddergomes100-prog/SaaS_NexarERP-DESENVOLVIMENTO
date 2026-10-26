import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, ArrowLeftRight, PackagePlus, PackageMinus, Boxes, Search, X } from 'lucide-react';
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, parseISO } from 'date-fns';
import { useTabs } from '../../contexts/TabsContext';
import StatCard from '../../components/Reports/StatCard';
import ReportFilter from '../../components/Reports/ReportFilter';
import RelatorioPreview, { type DocumentoRelatorioSemEmpresa } from '../../components/Reports/RelatorioPreview';
import EstadoVazio from '../../components/common/EstadoVazio';
import { nomeArquivoRelatorio, type ColunaRelatorio, type SecaoRelatorio } from '../../utils/relatorioPdfDomain';
import { labelMotivoAjusteEstoque } from '../../utils/ajusteEstoqueDomain';
import { consultarExtrato, consultarMovimentos } from '../../services/movimentosEstoqueService';
import {
  chaveDoItem,
  FILTROS_DA_TELA_VAZIOS,
  filtrarMovimentos,
  resumirMovimentos,
  ROTULO_GRUPO_ORIGEM,
  ROTULO_ORIGEM,
  ROTULO_TIPO_ITEM,
  type ExtratoDoItem,
  type FiltrosDaTela,
  type GrupoOrigem,
  type ItemDaMovimentacao,
  type LinhaDoExtrato,
  type MovimentoEstoque,
  type TipoDoItem,
} from '../../utils/movimentosEstoqueDomain';
import './Estoque.css';

/**
 * ESTOQUE > MOVIMENTACAO DE PRODUTOS (26/10/2026, pedido do dono).
 *
 * Todas as entradas e saidas de produtos, materias-primas e insumos no periodo,
 * montadas pelo servidor a partir dos documentos (venda, PDV, OS, compra, nota
 * avulsa, producao, ajuste, balanco, transferencia, troca, devolucoes, entrega
 * futura). Clicar no item abre o extrato dele com o saldo de cada movimento.
 * Regra em src/utils/movimentosEstoqueDomain.ts.
 */

const PAGINA = 200;

const COR_TIPO_ITEM: Record<TipoDoItem, string> = {
  acabado: '#10b981',
  semiacabado: '#f59e0b',
  revenda: '#3b82f6',
  materia_prima: '#8b5cf6',
  insumo: '#0ea5e9',
};

const formatarQtd = (q: number, casas: number) => q.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: Math.max(casas, 0) });

/** Nome da origem na tela: o ajuste manual mostra o motivo. */
const rotuloDaOrigem = (m: MovimentoEstoque) => (
  m.origem === 'ajuste' && m.motivo ? `Ajuste: ${labelMotivoAjusteEstoque(m.tipo, m.motivo)}` : ROTULO_ORIGEM[m.origem]
);

const MovimentacaoProdutos: React.FC = () => {
  const { openTab } = useTabs();
  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [movimentos, setMovimentos] = useState<MovimentoEstoque[]>([]);
  const [itens, setItens] = useState<Record<string, ItemDaMovimentacao>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [filtros, setFiltros] = useState<FiltrosDaTela>(FILTROS_DA_TELA_VAZIOS);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [previewAberto, setPreviewAberto] = useState(false);
  // Extrato de um item: { item, extrato } ou carregando.
  const [extratoDe, setExtratoDe] = useState<ItemDaMovimentacao | null>(null);
  const [extrato, setExtrato] = useState<ExtratoDoItem | null>(null);
  const [carregandoExtrato, setCarregandoExtrato] = useState(false);

  const intervalo = useMemo(() => {
    let inicio = startOfMonth(new Date());
    let fim = endOfMonth(new Date());
    switch (period) {
      case 'hoje': inicio = startOfDay(new Date()); fim = endOfDay(new Date()); break;
      case 'ontem': inicio = startOfDay(subDays(new Date(), 1)); fim = endOfDay(subDays(new Date(), 1)); break;
      case 'semana': inicio = startOfDay(subDays(new Date(), 7)); fim = endOfDay(new Date()); break;
      case 'mes': inicio = startOfMonth(new Date()); fim = endOfMonth(new Date()); break;
      case 'ano': inicio = startOfYear(new Date()); fim = endOfMonth(new Date()); break;
      case 'personalizado': inicio = startOfDay(parseISO(startDate)); fim = endOfDay(parseISO(endDate)); break;
      default: break;
    }
    return { inicio, fim };
  }, [period, startDate, endDate]);
  const de = Number.isNaN(intervalo.inicio.getTime()) ? '' : format(intervalo.inicio, 'yyyy-MM-dd');
  const ate = Number.isNaN(intervalo.fim.getTime()) ? '' : format(intervalo.fim, 'yyyy-MM-dd');

  const carregar = useCallback(async () => {
    if (!de || !ate) return;
    setCarregando(true);
    setErro('');
    try {
      const r = await consultarMovimentos(de, ate);
      setMovimentos(r.movimentos);
      setItens(r.itens);
      setVisiveis(PAGINA);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível montar a movimentação.');
    } finally {
      setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);

  const abrirExtrato = useCallback(async (item: ItemDaMovimentacao) => {
    if (!de || !ate) return;
    setExtratoDe(item);
    setExtrato(null);
    setCarregandoExtrato(true);
    try {
      const r = await consultarExtrato(de, ate, item.colecao, item.id);
      setExtrato(r.extrato || null);
      const atualizado = r.itens[item.chave];
      if (atualizado) setExtratoDe(atualizado);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível montar o extrato.');
      setExtratoDe(null);
    } finally {
      setCarregandoExtrato(false);
    }
  }, [de, ate]);

  // Trocar o periodo com o extrato aberto refaz o extrato.
  useEffect(() => {
    if (extratoDe) void abrirExtrato(extratoDe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const filtrados = useMemo(() => filtrarMovimentos(movimentos, itens, filtros), [movimentos, itens, filtros]);
  const resumo = useMemo(() => resumirMovimentos(filtrados), [filtrados]);
  const categorias = useMemo(() => Array.from(new Set(Object.values(itens).map((i) => i.categoria).filter(Boolean))).sort(), [itens]);
  const filtrosAtivos = filtros.tipoMovimento !== 'todos' || filtros.tiposDoItem.length > 0 || filtros.grupos.length > 0 || Boolean(filtros.categoria) || Boolean(filtros.busca.trim());
  const mudar = (m: Partial<FiltrosDaTela>) => { setFiltros((f) => ({ ...f, ...m })); setVisiveis(PAGINA); };
  const alternarTipoItem = (t: TipoDoItem) => mudar({ tiposDoItem: filtros.tiposDoItem.includes(t) ? filtros.tiposDoItem.filter((x) => x !== t) : [...filtros.tiposDoItem, t] });

  const itemDe = (m: MovimentoEstoque): ItemDaMovimentacao => itens[chaveDoItem(m.colecao, m.itemId)] || {
    chave: chaveDoItem(m.colecao, m.itemId), colecao: m.colecao, id: m.itemId, nome: m.itemNome, codigo: '', unidade: 'UN', categoria: '',
    tipo: m.colecao === 'materias_primas' ? 'materia_prima' : m.colecao === 'insumos' ? 'insumo' : 'revenda', casasDecimais: 3, saldoAtual: 0,
  };

  // ---------- PDF / Excel ----------
  const documento = useMemo<DocumentoRelatorioSemEmpresa | null>(() => {
    const periodo = de && ate ? `De ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}` : '';
    const colunasBase: ColunaRelatorio<MovimentoEstoque>[] = [
      { id: 'data', titulo: 'Data', tipo: 'dataHora', valor: (m) => new Date(m.dataMillis) },
      { id: 'tipo', titulo: 'Tipo', tipo: 'texto', largura: 16, valor: (m) => (m.tipo === 'entrada' ? 'Entrada' : 'Saída') },
      { id: 'item', titulo: 'Item', tipo: 'texto', largura: 60, valor: (m) => { const i = itemDe(m); return `${i.nome}${i.codigo ? ` (${i.codigo})` : ''}`; } },
      { id: 'tipoItem', titulo: 'Tipo do item', tipo: 'texto', largura: 28, padrao: false, valor: (m) => ROTULO_TIPO_ITEM[itemDe(m).tipo] },
      { id: 'categoria', titulo: 'Categoria', tipo: 'texto', largura: 26, padrao: false, valor: (m) => itemDe(m).categoria },
      { id: 'quantidade', titulo: 'Quantidade', tipo: 'texto', largura: 22, total: 'nenhum', valor: (m) => { const i = itemDe(m); return `${m.tipo === 'saida' ? '-' : '+'}${formatarQtd(m.quantidade, i.casasDecimais)} ${i.unidade}`; } },
      { id: 'origem', titulo: 'Origem', tipo: 'texto', largura: 40, valor: rotuloDaOrigem },
      { id: 'documento', titulo: 'Documento', tipo: 'texto', largura: 34, valor: (m) => m.documento },
      { id: 'pessoa', titulo: 'Cliente / fornecedor / observação', tipo: 'texto', largura: 44, valor: (m) => m.pessoa || '' },
      { id: 'usuario', titulo: 'Usuário', tipo: 'texto', largura: 24, padrao: false, valor: (m) => m.usuario || '' },
    ];
    if (extratoDe && extrato) {
      const colunasExtrato: ColunaRelatorio<LinhaDoExtrato>[] = [
        ...(colunasBase.filter((c) => !['item', 'tipoItem', 'categoria'].includes(c.id)) as ColunaRelatorio<LinhaDoExtrato>[]),
        { id: 'saldoAntes', titulo: 'Saldo antes', tipo: 'texto', largura: 20, total: 'nenhum', valor: (l) => formatarQtd(l.saldoAntes, extratoDe.casasDecimais) },
        { id: 'saldoDepois', titulo: 'Saldo depois', tipo: 'texto', largura: 20, total: 'nenhum', valor: (l) => formatarQtd(l.saldoDepois, extratoDe.casasDecimais) },
      ];
      return {
        titulo: 'Extrato de estoque',
        periodo,
        filtros: [`Item: ${extratoDe.nome}${extratoDe.codigo ? ` (código ${extratoDe.codigo})` : ''}`, `Tipo do item: ${ROTULO_TIPO_ITEM[extratoDe.tipo]}`, `Saldo atual: ${formatarQtd(extratoDe.saldoAtual, extratoDe.casasDecimais)} ${extratoDe.unidade}`],
        indicadores: [
          { rotulo: 'Saldo no início', valor: `${formatarQtd(extrato.saldoInicial, extratoDe.casasDecimais)} ${extratoDe.unidade}` },
          { rotulo: 'Entradas', valor: `${formatarQtd(extrato.totalEntradas, extratoDe.casasDecimais)} ${extratoDe.unidade}` },
          { rotulo: 'Saídas', valor: `${formatarQtd(extrato.totalSaidas, extratoDe.casasDecimais)} ${extratoDe.unidade}` },
          { rotulo: 'Saldo no fim', valor: `${formatarQtd(extrato.saldoFinal, extratoDe.casasDecimais)} ${extratoDe.unidade}` },
        ],
        secoes: [{ id: 'extrato', titulo: 'Movimentos', colunas: colunasExtrato, linhas: [...extrato.linhas].reverse(), unidade: ['movimento', 'movimentos'], mensagemVazia: 'Nenhum movimento no período.' } as SecaoRelatorio],
      };
    }
    const filtrosTexto: string[] = [];
    if (filtros.tipoMovimento !== 'todos') filtrosTexto.push(filtros.tipoMovimento === 'entrada' ? 'Só entradas' : 'Só saídas');
    if (filtros.tiposDoItem.length) filtrosTexto.push(`Tipo do item: ${filtros.tiposDoItem.map((t) => ROTULO_TIPO_ITEM[t]).join(', ')}`);
    if (filtros.grupos.length) filtrosTexto.push(`Origem: ${filtros.grupos.map((g) => ROTULO_GRUPO_ORIGEM[g]).join(', ')}`);
    if (filtros.categoria) filtrosTexto.push(`Categoria: ${filtros.categoria}`);
    if (filtros.busca.trim()) filtrosTexto.push(`Busca: ${filtros.busca.trim()}`);
    return {
      titulo: 'Movimentação de Produtos',
      periodo,
      filtros: filtrosTexto,
      indicadores: [
        { rotulo: 'Movimentos', valor: String(resumo.total) },
        { rotulo: 'Entradas', valor: String(resumo.entradas) },
        { rotulo: 'Saídas', valor: String(resumo.saidas) },
        { rotulo: 'Itens movimentados', valor: String(resumo.itens) },
      ],
      secoes: [{ id: 'movimentos', titulo: 'Movimentos', colunas: colunasBase, linhas: filtrados, unidade: ['movimento', 'movimentos'], mensagemVazia: 'Nenhum movimento para os filtros escolhidos.' } as SecaoRelatorio],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, resumo, filtros, extratoDe, extrato, de, ate, itens]);

  if (previewAberto) {
    return (
      <RelatorioPreview
        relatorioId={extratoDe ? 'estoque-extrato' : 'estoque-movimentacao'}
        documento={documento}
        nomeArquivo={nomeArquivoRelatorio(extratoDe ? `Extrato ${extratoDe.nome}` : 'Movimentacao de Produtos', de, ate)}
        onFechar={() => setPreviewAberto(false)}
        rotuloFechar="Voltar à tela"
      />
    );
  }

  const campo: React.CSSProperties = { backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 14px', color: 'var(--text-primary)', minWidth: '150px' };
  const rotulo: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' };
  const seloTipo = (t: TipoDoItem) => (
    <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: COR_TIPO_ITEM[t], whiteSpace: 'nowrap' }}>{ROTULO_TIPO_ITEM[t].toUpperCase()}</span>
  );
  const seloMovimento = (tipo: MovimentoEstoque['tipo']) => (
    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap', backgroundColor: tipo === 'entrada' ? '#10b98122' : '#ef444422', color: tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
      {tipo === 'entrada' ? 'Entrada' : 'Saída'}
    </span>
  );
  const celulaDocumento = (m: MovimentoEstoque) => (m.rota ? (
    <button type="button" className="link-btn" onClick={() => openTab(m.rota as string)} title="Abrir o documento" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-purple)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
      {m.documento}
    </button>
  ) : m.documento);

  return (
    <div className="estoque-page relatorio-caixa-alta">
      <div className="page-header">
        <div className="header-title-group">
          {extratoDe && (
            <button className="icon-btn back-btn" onClick={() => { setExtratoDe(null); setExtrato(null); }} title="Voltar à lista">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="page-title">{extratoDe ? `Extrato — ${extratoDe.nome}` : 'Movimentação de Produtos'}</h1>
            <p className="page-subtitle">
              {extratoDe
                ? `${ROTULO_TIPO_ITEM[extratoDe.tipo]}${extratoDe.codigo ? ` · código ${extratoDe.codigo}` : ''}${extratoDe.categoria ? ` · ${extratoDe.categoria}` : ''} · saldo atual ${formatarQtd(extratoDe.saldoAtual, extratoDe.casasDecimais)} ${extratoDe.unidade}`
                : 'Todas as entradas e saídas de produtos, matérias-primas e insumos: vendas, compras, produção, ajustes, balanço, transferências e devoluções.'}
            </p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => setPreviewAberto(true)} disabled={extratoDe ? !extrato : filtrados.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={18} /> Gerar relatório
        </button>
      </div>

      <ReportFilter
        period={period}
        setPeriod={setPeriod}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        onSearch={() => { if (extratoDe) void abrirExtrato(extratoDe); else void carregar(); }}
        extraFilters={extratoDe ? undefined : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={rotulo} htmlFor="mov-tipo">Entrada ou saída</label>
              <select id="mov-tipo" value={filtros.tipoMovimento} onChange={(e) => mudar({ tipoMovimento: e.target.value as FiltrosDaTela['tipoMovimento'] })} style={campo}>
                <option value="todos">Entradas e saídas</option>
                <option value="entrada">Só entradas</option>
                <option value="saida">Só saídas</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={rotulo} htmlFor="mov-origem">Origem do movimento</label>
              <select id="mov-origem" value={filtros.grupos[0] || ''} onChange={(e) => mudar({ grupos: e.target.value ? [e.target.value as GrupoOrigem] : [] })} style={campo}>
                <option value="">Todas</option>
                {(Object.keys(ROTULO_GRUPO_ORIGEM) as GrupoOrigem[]).map((g) => <option key={g} value={g}>{ROTULO_GRUPO_ORIGEM[g]}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={rotulo} htmlFor="mov-categoria">Categoria</label>
              <select id="mov-categoria" value={filtros.categoria} onChange={(e) => mudar({ categoria: e.target.value })} style={campo}>
                <option value="">Todas</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </>
        )}
      />

      {erro && (
        <div className="card" style={{ padding: '12px 16px', border: '1px solid #ef4444', color: 'var(--text-primary)' }}>{erro}</div>
      )}

      {extratoDe ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <StatCard title="Saldo no início" value={extrato ? `${formatarQtd(extrato.saldoInicial, extratoDe.casasDecimais)} ${extratoDe.unidade}` : '...'} icon={Boxes} color="#64748b" subtitle="Antes do 1º movimento do período" />
            <StatCard title="Entradas" value={extrato ? `${formatarQtd(extrato.totalEntradas, extratoDe.casasDecimais)} ${extratoDe.unidade}` : '...'} icon={PackagePlus} color="#10b981" subtitle="Soma no período" />
            <StatCard title="Saídas" value={extrato ? `${formatarQtd(extrato.totalSaidas, extratoDe.casasDecimais)} ${extratoDe.unidade}` : '...'} icon={PackageMinus} color="#ef4444" subtitle="Soma no período" />
            <StatCard title="Saldo no fim" value={extrato ? `${formatarQtd(extrato.saldoFinal, extratoDe.casasDecimais)} ${extratoDe.unidade}` : '...'} icon={Boxes} color="#8b5cf6" subtitle="Depois do último movimento do período" />
          </div>
          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
            <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-muted)' }}>
              O saldo de cada linha é calculado a partir do saldo atual do cadastro, voltando pelos movimentos. Saldo digitado no cadastro ou importado não tem documento e aparece só no saldo do início.
            </p>
            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Data</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Origem</th><th>Documento</th>
                    <th title="Cliente, fornecedor ou observação do movimento">Cliente / fornecedor</th><th style={{ textAlign: 'right' }}>Saldo antes</th><th style={{ textAlign: 'right' }}>Saldo depois</th>
                  </tr>
                </thead>
                <tbody>
                  {carregandoExtrato ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Montando o extrato...</td></tr>
                  ) : !extrato || extrato.linhas.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '8px' }}><EstadoVazio titulo="Nenhum movimento deste item no período." compacto /></td></tr>
                  ) : extrato.linhas.map((l) => (
                    <tr key={l.id}>
                      <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(l.dataMillis).toLocaleString('pt-BR')}</td>
                      <td>{seloMovimento(l.tipo)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: l.tipo === 'entrada' ? '#10b981' : '#ef4444', whiteSpace: 'nowrap' }}>
                        {l.tipo === 'entrada' ? '+' : '−'}{formatarQtd(l.quantidade, extratoDe.casasDecimais)} {extratoDe.unidade}
                      </td>
                      <td>{rotuloDaOrigem(l)}</td>
                      <td>{celulaDocumento(l)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{l.pessoa || '—'}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatarQtd(l.saldoAntes, extratoDe.casasDecimais)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: l.saldoDepois < 0 ? '#ef4444' : 'var(--text-primary)' }}>{formatarQtd(l.saldoDepois, extratoDe.casasDecimais)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
            <StatCard title="Movimentos" value={String(resumo.total)} icon={ArrowLeftRight} color="#3b82f6" subtitle="Com os filtros escolhidos" />
            <StatCard title="Entradas" value={String(resumo.entradas)} icon={PackagePlus} color="#10b981" subtitle="Linhas de entrada" />
            <StatCard title="Saídas" value={String(resumo.saidas)} icon={PackageMinus} color="#ef4444" subtitle="Linhas de saída" />
            <StatCard title="Itens movimentados" value={String(resumo.itens)} icon={Boxes} color="#8b5cf6" subtitle="Produtos, matérias-primas e insumos" />
          </div>

          <div className="card" style={{ padding: '20px 24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={rotulo}>Tipo do item</span>
              {(Object.keys(ROTULO_TIPO_ITEM) as TipoDoItem[]).map((t) => {
                const ligado = filtros.tiposDoItem.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    className="btn-secondary"
                    aria-pressed={ligado}
                    onClick={() => alternarTipoItem(t)}
                    style={{ padding: '6px 12px', fontSize: '13px', ...(ligado ? { borderColor: COR_TIPO_ITEM[t], color: COR_TIPO_ITEM[t], backgroundColor: `${COR_TIPO_ITEM[t]}1a` } : {}) }}
                  >
                    {ROTULO_TIPO_ITEM[t]}
                  </button>
                );
              })}
              <div className="search-box" style={{ position: 'relative', flex: '1 1 240px', minWidth: '220px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  value={filtros.busca}
                  onChange={(e) => mudar({ busca: e.target.value })}
                  placeholder="Buscar…"
                  title="Produto (nome ou código), documento ou cliente/fornecedor. Use + para exigir várias palavras."
                  style={{ ...campo, width: '100%', paddingLeft: '34px' }}
                />
              </div>
              {filtrosAtivos && (
                <button type="button" className="btn-secondary" onClick={() => mudar(FILTROS_DA_TELA_VAZIOS)} style={{ padding: '6px 12px', fontSize: '13px', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                  <X size={14} /> Limpar filtros
                </button>
              )}
            </div>

            <div className="table-wrapper">
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Data</th><th>Tipo</th><th>Item</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Origem</th><th>Documento</th><th title="Cliente, fornecedor ou observação do movimento">Cliente / fornecedor</th>
                  </tr>
                </thead>
                <tbody>
                  {carregando ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Montando a movimentação...</td></tr>
                  ) : filtrados.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: '8px' }}><EstadoVazio titulo={movimentos.length === 0 ? 'Nenhuma movimentação no período.' : 'Nenhum movimento para os filtros escolhidos.'} compacto /></td></tr>
                  ) : filtrados.slice(0, visiveis).map((m) => {
                    const item = itemDe(m);
                    return (
                      <tr key={m.id}>
                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(m.dataMillis).toLocaleString('pt-BR')}</td>
                        <td>{seloMovimento(m.tipo)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => { void abrirExtrato(item); }}
                            title="Ver o extrato deste item, com o saldo de cada movimento"
                            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit', fontWeight: 600, textAlign: 'left' }}
                          >
                            {item.nome}{item.codigo ? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> ({item.codigo})</span> : null}
                          </button>
                          {seloTipo(item.tipo)}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap', color: m.tipo === 'entrada' ? '#10b981' : '#ef4444' }}>
                          {m.tipo === 'entrada' ? '+' : '−'}{formatarQtd(m.quantidade, item.casasDecimais)} {item.unidade}
                        </td>
                        <td>{rotuloDaOrigem(m)}</td>
                        <td>{celulaDocumento(m)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{m.pessoa || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!carregando && filtrados.length > visiveis && (
              <button type="button" className="btn-secondary" onClick={() => setVisiveis((v) => v + PAGINA)} style={{ alignSelf: 'center' }}>
                Ver mais ({filtrados.length - visiveis})
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MovimentacaoProdutos;
