import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Boxes, Download, DollarSign, AlertCircle, XCircle } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../components/Reports/StatCard';
import ReportFilter from '../../components/Reports/ReportFilter';
import { ROTULO_POR_ORIGEM, normalizarComponente, type ComponenteComposicao } from '../../utils/producaoDomain';
import {
  format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, startOfYear, isWithinInterval, parseISO,
} from 'date-fns';
import './Estoque.css';

interface ProdutoRelatorio {
  id: string;
  nome: string;
  codigo: string;
  categoria: string;
  marca: string;
  ncm: string;
  codigoBarras: string;
  referencia: string;
  localizacao: string;
  quantidade: number;
  estoqueMinimo: number;
  precoVenda: number;
  precoCusto: number;
  unidadeMedidaSigla?: string;
  ativo: boolean;
  produtoRevenda: boolean;
  createdAt?: { toDate: () => Date } | null;
}

/**
 * Colunas que o usuario liga/desliga. `composicao` nao e' uma coluna de
 * verdade: ela abre uma linha extra por produto com a receita dele, porque
 * uma receita tem N itens e nao cabe numa celula.
 */
interface ColunasVisiveis {
  quantidade: boolean;
  unidade: boolean;
  categoria: boolean;
  marca: boolean;
  referencia: boolean;
  localizacao: boolean;
  estoqueMinimo: boolean;
  custo: boolean;
  preco: boolean;
  valorTotal: boolean;
  ncm: boolean;
  codigoBarras: boolean;
  composicao: boolean;
}

const ROTULO_COLUNA: Record<keyof ColunasVisiveis, string> = {
  quantidade: 'Quantidade',
  unidade: 'Unidade',
  categoria: 'Categoria',
  marca: 'Marca',
  referencia: 'Referência',
  localizacao: 'Localização',
  estoqueMinimo: 'Estoque mínimo',
  custo: 'Custo',
  preco: 'Preço de venda',
  valorTotal: 'Valor total',
  ncm: 'NCM',
  codigoBarras: 'Código de barras',
  composicao: 'Composição (receita)',
};

const ORDEM_COLUNAS = Object.keys(ROTULO_COLUNA) as Array<keyof ColunasVisiveis>;
const COLUNAS_NUMERICAS: Array<keyof ColunasVisiveis> = ['quantidade', 'estoqueMinimo', 'custo', 'preco', 'valorTotal'];
const COLUNAS_MONETARIAS: Array<keyof ColunasVisiveis> = ['custo', 'preco', 'valorTotal'];

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const RelatorioEstoque: React.FC = () => {
  const navigate = useNavigate();
  const { tenantId } = useAuth();

  const [produtos, setProdutos] = useState<ProdutoRelatorio[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [composicoes, setComposicoes] = useState<Record<string, ComponenteComposicao[]>>({});
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('mes');
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  /**
   * Relatorio de estoque e' POSICAO ATUAL: o que interessa e' quanto tem
   * hoje, nao quando o produto foi cadastrado. Com o periodo valendo, um
   * produto cadastrado ano passado sumia do relatorio deste mes -- e o
   * usuario nao tem como adivinhar que o filtro era por data de CADASTRO.
   * Por isso o padrao e' ignorar o periodo; quem quiser ver "o que entrou
   * no cadastro neste mes" desmarca.
   */
  const [ignorarPeriodo, setIgnorarPeriodo] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroNcm, setFiltroNcm] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [apenasAtivos, setApenasAtivos] = useState(true);

  const [colunas, setColunas] = useState<ColunasVisiveis>({
    quantidade: true,
    unidade: false,
    categoria: true,
    marca: false,
    referencia: false,
    localizacao: false,
    estoqueMinimo: false,
    custo: false,
    preco: true,
    valorTotal: false,
    ncm: false,
    codigoBarras: false,
    composicao: false,
  });

  /**
   * Ids desmarcados. Guardar o que SAIU (e nao o que entrou) mantem produto
   * novo dentro do relatorio por padrao -- mexer no filtro nao pode esvaziar
   * a selecao do usuario sem ele perceber.
   */
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());

  const carregarDados = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [snapProdutos, snapCategorias, snapComposicoes] = await Promise.all([
        getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'categorias'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'produtos_composicao'), where('tenantId', '==', tenantId))),
      ]);

      setProdutos(snapProdutos.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          nome: data.nome || '',
          codigo: data.codigo || '',
          categoria: data.categoria || '',
          marca: data.marca || '',
          ncm: data.ncm || data.fiscal?.ncm || '',
          codigoBarras: data.codigoBarras || '',
          referencia: data.referencia || '',
          localizacao: data.localizacaoEstoque || data.estoqueConfig?.localizacao || '',
          quantidade: Number(data.quantidade || 0),
          estoqueMinimo: Number(data.estoqueMinimo ?? data.estoqueConfig?.estoqueMinimo ?? 0),
          precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
          precoCusto: Number(data.precoCusto ?? data.precos?.custo ?? 0),
          unidadeMedidaSigla: data.unidadeMedidaSigla,
          ativo: data.ativo !== false && data.statusAtivo !== false,
          produtoRevenda: data.produtoRevenda !== false,
          createdAt: data.createdAt,
        };
      }));

      setCategorias(snapCategorias.docs.map((d) => d.data().nome).filter(Boolean));

      const mapa: Record<string, ComponenteComposicao[]> = {};
      snapComposicoes.forEach((d) => {
        const itens = d.data().itens;
        if (Array.isArray(itens) && itens.length > 0) mapa[d.id] = itens.map(normalizarComponente);
      });
      setComposicoes(mapa);
    } catch (err) {
      console.error('Erro ao carregar relatório de estoque:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  const filtrados = useMemo(() => {
    let start = startOfDay(new Date());
    let end = endOfDay(new Date());
    switch (period) {
      case 'hoje': start = startOfDay(new Date()); end = endOfDay(new Date()); break;
      case 'ontem': start = startOfDay(subDays(new Date(), 1)); end = endOfDay(subDays(new Date(), 1)); break;
      case 'semana': start = startOfDay(subDays(new Date(), 7)); end = endOfDay(new Date()); break;
      case 'mes': start = startOfMonth(new Date()); end = endOfMonth(new Date()); break;
      case 'ano': start = startOfYear(new Date()); end = endOfMonth(new Date()); break;
      case 'personalizado': start = startOfDay(parseISO(startDate)); end = endOfDay(parseISO(endDate)); break;
    }
    const termo = filtroTexto.trim().toLowerCase();

    return produtos.filter((produto) => {
      if (apenasAtivos && !produto.ativo) return false;
      if (!ignorarPeriodo) {
        const data = produto.createdAt?.toDate ? produto.createdAt.toDate() : null;
        if (data && !isWithinInterval(data, { start, end })) return false;
      }
      if (filtroCategoria && produto.categoria !== filtroCategoria) return false;
      if (filtroNcm.trim() && !produto.ncm.includes(filtroNcm.trim())) return false;
      if (termo && !`${produto.nome} ${produto.codigo} ${produto.marca}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [produtos, period, startDate, endDate, ignorarPeriodo, filtroCategoria, filtroNcm, filtroTexto, apenasAtivos]);

  /** O que realmente sai no relatorio: o filtro menos o que foi desmarcado. */
  const selecionados = useMemo(
    () => filtrados.filter((p) => !desmarcados.has(p.id)),
    [filtrados, desmarcados],
  );

  const stats = useMemo(() => ({
    total: selecionados.length,
    valorEstoque: selecionados.reduce((soma, p) => soma + p.quantidade * (p.precoCusto || p.precoVenda || 0), 0),
    estoqueBaixo: selecionados.filter((p) => p.quantidade > 0 && p.estoqueMinimo > 0 && p.quantidade <= p.estoqueMinimo).length,
    esgotados: selecionados.filter((p) => p.quantidade <= 0).length,
  }), [selecionados]);

  const colunasAtivas = ORDEM_COLUNAS.filter((c) => c !== 'composicao' && colunas[c]);

  const valorDaColuna = (p: ProdutoRelatorio, coluna: keyof ColunasVisiveis): string => {
    switch (coluna) {
      case 'quantidade': return String(p.quantidade);
      case 'unidade': return p.unidadeMedidaSigla || '';
      case 'categoria': return p.categoria;
      case 'marca': return p.marca;
      case 'referencia': return p.referencia;
      case 'localizacao': return p.localizacao;
      case 'estoqueMinimo': return String(p.estoqueMinimo);
      case 'custo': return p.precoCusto.toFixed(2);
      case 'preco': return p.precoVenda.toFixed(2);
      case 'valorTotal': return (p.quantidade * (p.precoCusto || p.precoVenda || 0)).toFixed(2);
      case 'ncm': return p.ncm;
      case 'codigoBarras': return p.codigoBarras;
      default: return '';
    }
  };

  const exportCsv = () => {
    const headers = ['Produto', 'Código', ...colunasAtivas.map((c) => ROTULO_COLUNA[c])];
    const linhas: string[][] = [];
    selecionados.forEach((p) => {
      linhas.push([p.nome, p.codigo, ...colunasAtivas.map((c) => valorDaColuna(p, c))]);
      if (colunas.composicao) {
        // Receita vira uma linha por componente logo abaixo do produto, com as
        // demais colunas vazias -- formato de ficha tecnica, que e' o que se
        // espera ao abrir isso numa planilha.
        (composicoes[p.id] || []).forEach((item) => {
          linhas.push([
            `   - ${item.componenteNome}`,
            ROTULO_POR_ORIGEM[item.origem],
            ...colunasAtivas.map((c) => (c === 'quantidade' ? `${item.quantidade} ${item.unidade}` : '')),
          ]);
        });
      }
    });
    const csv = '﻿' + [headers, ...linhas].map((row) => row.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-estoque-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleColuna = (chave: keyof ColunasVisiveis) => setColunas((prev) => ({ ...prev, [chave]: !prev[chave] }));

  const alternarProduto = (id: string) => setDesmarcados((prev) => {
    const novo = new Set(prev);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    return novo;
  });

  const todosMarcados = filtrados.length > 0 && selecionados.length === filtrados.length;
  const alternarTodos = () => setDesmarcados((prev) => {
    if (todosMarcados) return new Set([...prev, ...filtrados.map((p) => p.id)]);
    const novo = new Set(prev);
    filtrados.forEach((p) => novo.delete(p.id));
    return novo;
  });

  const totalColunas = colunasAtivas.length + 3;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)' }}>
      Carregando relatório de estoque...
    </div>
  );

  return (
    <div className="estoque-page relatorio-caixa-alta">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Relatório de Estoque</h1>
            <p className="page-subtitle">Escolha as colunas e os produtos que entram no relatório.</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={exportCsv} disabled={selecionados.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Download size={18} /> Exportar CSV ({selecionados.length})
        </button>
      </div>

      <ReportFilter
        period={period}
        setPeriod={setPeriod}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        onSearch={carregarDados}
        extraFilters={(
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Buscar</label>
              <input
                type="text"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                placeholder="Nome, código ou marca"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Categoria</label>
              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)', minWidth: '160px' }}
              >
                <option value="">Todas</option>
                {categorias.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>NCM</label>
              <input
                type="text"
                value={filtroNcm}
                onChange={(e) => setFiltroNcm(e.target.value)}
                placeholder="Buscar por NCM"
                style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 16px', color: 'var(--text-primary)' }}
              />
            </div>
          </>
        )}
      />

      <div className="card" style={{ padding: '16px 20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Exibir colunas:</span>
          {ORDEM_COLUNAS.map((chave) => (
            <label key={chave} className="switch-row" style={{ minHeight: 'auto' }}>
              <input type="checkbox" checked={colunas[chave]} onChange={() => toggleColuna(chave)} />
              <span>{ROTULO_COLUNA[chave]}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
          <label className="switch-row" style={{ minHeight: 'auto' }}>
            <input type="checkbox" checked={ignorarPeriodo} onChange={() => setIgnorarPeriodo((v) => !v)} />
            <span>Posição atual (ignorar o período)</span>
          </label>
          <label className="switch-row" style={{ minHeight: 'auto' }}>
            <input type="checkbox" checked={apenasAtivos} onChange={() => setApenasAtivos((v) => !v)} />
            <span>Somente produtos ativos</span>
          </label>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            O período filtra pela data de <strong>cadastro</strong> do produto, não pela movimentação.
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        <StatCard title="Itens no relatório" value={String(stats.total)} icon={Boxes} color="#3b82f6" subtitle={`De ${filtrados.length} no filtro`} />
        <StatCard title="Valor em Estoque" value={currency.format(stats.valorEstoque)} icon={DollarSign} color="#10b981" subtitle="Quantidade × custo" />
        <StatCard title="Estoque Baixo" value={String(stats.estoqueBaixo)} icon={AlertCircle} color="#f59e0b" subtitle="No ou abaixo do mínimo" />
        <StatCard title="Itens Esgotados" value={String(stats.esgotados)} icon={XCircle} color="#ef4444" subtitle="Quantidade zerada" />
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 8px', width: '36px' }}>
                  <input type="checkbox" checked={todosMarcados} onChange={alternarTodos} title="Marcar / desmarcar todos" />
                </th>
                <th style={{ padding: '14px 8px' }}>Produto</th>
                <th style={{ padding: '14px 8px' }}>Código</th>
                {colunasAtivas.map((c) => (
                  <th key={c} style={{ padding: '14px 8px', textAlign: COLUNAS_NUMERICAS.includes(c) ? 'right' : 'left' }}>
                    {ROTULO_COLUNA[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => {
                const fora = desmarcados.has(p.id);
                const receita = composicoes[p.id] || [];
                return (
                  <React.Fragment key={p.id}>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', opacity: fora ? 0.4 : 1 }}>
                      <td style={{ padding: '12px 8px' }}>
                        <input type="checkbox" checked={!fora} onChange={() => alternarProduto(p.id)} />
                      </td>
                      <td style={{ padding: '12px 8px', fontWeight: 600 }}>
                        {p.nome}
                        {!p.produtoRevenda && <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>(uso interno)</span>}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{p.codigo}</td>
                      {colunasAtivas.map((c) => {
                        const bruto = valorDaColuna(p, c);
                        const sufixoUnidade = c === 'quantidade' && p.unidadeMedidaSigla && !colunas.unidade ? ` ${p.unidadeMedidaSigla}` : '';
                        return (
                          <td key={c} style={{ padding: '12px 8px', textAlign: COLUNAS_NUMERICAS.includes(c) ? 'right' : 'left' }}>
                            {COLUNAS_MONETARIAS.includes(c) ? currency.format(Number(bruto)) : `${bruto}${sufixoUnidade}`}
                          </td>
                        );
                      })}
                    </tr>
                    {colunas.composicao && receita.length > 0 && (
                      <tr style={{ borderBottom: '1px solid var(--border-color)', opacity: fora ? 0.4 : 1 }}>
                        <td />
                        <td colSpan={totalColunas - 1} style={{ padding: '4px 8px 14px 8px' }}>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                            Composição para 1 {p.unidadeMedidaSigla || 'UN'}:
                          </div>
                          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {receita.map((item) => (
                              <li key={`${item.origem}:${item.componenteId}`}>
                                {item.componenteNome} — <strong>{item.quantidade} {item.unidade}</strong>
                                <span style={{ color: 'var(--text-muted)' }}> · {ROTULO_POR_ORIGEM[item.origem]}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={totalColunas} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Nenhum produto encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RelatorioEstoque;
