import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Barcode, Check, FileInput, Printer, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import { buildDocumentUpdateMetadata } from '../../utils/documentMetadata';
import { resolveUnidadeMedidaProduto, temUnidadeMedidaCadastrada, avisoUnidadeMedidaAusente } from '../../utils/unidadeMedidaDomain';
import { formatDateInputPtBr } from '../../utils/dateTime';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import EtiquetaLabel, { type ProdutoEtiquetaDados } from '../../components/estoque/EtiquetaLabel';
import {
  MODELO_ETIQUETA_PADRAO,
  sanearModeloEtiqueta,
  serializarItensParaQuery,
  type CampoEtiquetaId,
  type ItemEtiqueta,
  type ModeloEtiqueta,
} from '../../utils/etiquetaDomain';

/** O que a tela precisa de cada produto do estoque -- leitura, nunca edita
 * preço/cadastro aqui (isso é papel do cadastro e da Precificação). */
interface ProdutoEtiquetaEstoque extends ProdutoEtiquetaDados {
  id: string;
  categoria?: string;
  /** True quando o produto chegou sem unidade cadastrada de verdade -- so
   * pra decidir se avisa o usuario ao adicionar, ver resolveUnidadeMedidaProduto. */
  unidadeFaltando: boolean;
}

interface LinhaEtiqueta {
  produtoId: string;
  produtoNome: string;
  quantidade: string;
}

interface NotaParaImportar {
  id: string;
  titulo: string;
  subtitulo: string;
  itens: ItemEtiqueta[];
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--text-primary)',
  width: '100%', textAlign: 'right', fontSize: '13px',
};

const labelStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--text-secondary)' };

const formatBRL = (valor: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);

const PRODUTO_AMOSTRA: ProdutoEtiquetaDados = {
  nome: 'Produto de exemplo',
  codigo: '000123',
  codigoBarras: '',
  precoVenda: 19.9,
  precoAVista: null,
  precoAPrazo: null,
  unidadeMedidaSigla: 'UN',
};

const Etiquetas: React.FC = () => {
  const { currentUser, tenantId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [produtos, setProdutos] = useState<Map<string, ProdutoEtiquetaEstoque>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [buscaProduto, setBuscaProduto] = useState('');

  const [linhas, setLinhas] = useState<LinhaEtiqueta[]>([]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const [modalImportacao, setModalImportacao] = useState<null | 'avulsa' | 'fiscal'>(null);
  const [notasParaImportar, setNotasParaImportar] = useState<NotaParaImportar[]>([]);
  const [carregandoNotas, setCarregandoNotas] = useState(false);

  const [modelo, setModelo] = useState<ModeloEtiqueta>(MODELO_ETIQUETA_PADRAO);
  const [painelModeloAberto, setPainelModeloAberto] = useState(false);
  const [salvandoModelo, setSalvandoModelo] = useState(false);

  const importouDaQuery = useRef(false);

  // Leitura unica do estoque, mesmo motivo de Precificacao.tsx: a tela e' um
  // rascunho de impressao, nao precisa reagir a mudanca de estoque em tempo real.
  useEffect(() => {
    if (!tenantId) return;
    setCarregando(true);
    getDocs(query(collection(db, 'estoque'), where('tenantId', '==', tenantId)))
      .then((snap) => {
        const mapa = new Map<string, ProdutoEtiquetaEstoque>();
        snap.docs.forEach((d) => {
          const data = d.data();
          const unidade = resolveUnidadeMedidaProduto(data);
          mapa.set(d.id, {
            id: d.id,
            nome: data.nome || '',
            codigo: data.codigo,
            codigoBarras: data.codigoBarras,
            categoria: data.categoria,
            precoVenda: Number(data.precoVenda ?? data.precos?.venda ?? 0),
            precoAVista: data.precoAVista ?? data.precos?.aVista ?? null,
            precoAPrazo: data.precoAPrazo ?? data.precos?.aPrazo ?? null,
            unidadeMedidaSigla: unidade.unidadeMedidaSigla,
            unidadeFaltando: !temUnidadeMedidaCadastrada(data),
          });
        });
        setProdutos(mapa);
      })
      .catch((error) => {
        console.error('Erro ao carregar produtos:', error);
        showError('Erro ao carregar produtos', 'Não foi possível carregar o estoque. Atualize a página e tente novamente.');
      })
      .finally(() => setCarregando(false));
  }, [tenantId]);

  // Modelo salvo por tenant -- cai no padrao de fabrica se nao existir ainda.
  useEffect(() => {
    if (!tenantId) return;
    getDoc(doc(db, 'configuracoes', tenantId))
      .then((snap) => {
        const data = snap.exists() ? snap.data() : null;
        setModelo(sanearModeloEtiqueta(data?.etiquetaModelo));
      })
      .catch((error) => {
        console.error('Erro ao carregar modelo de etiqueta:', error);
      });
  }, [tenantId]);

  const produtosLista = useMemo(() => Array.from(produtos.values()), [produtos]);

  const adicionarProdutos = (itens: ItemEtiqueta[]) => {
    // Montagem fora do updater de proposito -- StrictMode chama a funcao de
    // atualizacao duas vezes, e encher um array declarado fora dela duplicaria
    // a linha (mesma armadilha documentada em Precificacao.tsx).
    const existentes = new Set(linhas.map((l) => l.produtoId));
    const novas: LinhaEtiqueta[] = [];
    let jaNaGrade = 0;
    let semCadastro = 0;
    let semUnidade = 0;
    let nomeSemUnidade = '';

    itens.forEach(({ produtoId, quantidade }) => {
      if (existentes.has(produtoId)) { jaNaGrade += 1; return; }
      const produto = produtos.get(produtoId);
      if (!produto) { semCadastro += 1; return; }
      existentes.add(produtoId);
      if (produto.unidadeFaltando) { semUnidade += 1; nomeSemUnidade = produto.nome; }
      novas.push({
        produtoId,
        produtoNome: produto.nome,
        quantidade: String(quantidade && quantidade > 0 ? Math.floor(quantidade) : 1),
      });
    });

    if (novas.length > 0) {
      setLinhas((atual) => {
        const jaNaLista = new Set(atual.map((l) => l.produtoId));
        return [...atual, ...novas.filter((linha) => !jaNaLista.has(linha.produtoId))];
      });
    }

    if (semCadastro > 0) {
      showWarning(`${semCadastro} item da nota não está mais no estoque e ficou de fora da lista.`);
    } else if (novas.length === 0 && jaNaGrade > 0) {
      showWarning('Todos os produtos já estavam na lista.');
    }
    if (semUnidade === 1) {
      const aviso = avisoUnidadeMedidaAusente(nomeSemUnidade);
      showWarning(aviso.title, aviso.text);
    } else if (semUnidade > 1) {
      showWarning(`${semUnidade} produtos sem unidade de medida cadastrada entraram na lista como UN.`, 'Corrija o cadastro deles em Estoque quando puder.');
    }
  };

  // Atalho vindo de "Gerar etiquetas" na lista de Nota Avulsa/NF-e de entrada.
  useEffect(() => {
    if (importouDaQuery.current) return;
    if (!tenantId || produtos.size === 0) return;
    const notaAvulsaId = searchParams.get('notaAvulsaId');
    const notaFiscalId = searchParams.get('notaFiscalId');
    if (!notaAvulsaId && !notaFiscalId) return;
    importouDaQuery.current = true;

    (async () => {
      try {
        if (notaAvulsaId) {
          const snap = await getDoc(doc(db, 'notas_avulsas', notaAvulsaId));
          if (snap.exists()) {
            const data = snap.data();
            const itensRaw: Array<{ produtoId?: string; quantidade?: number }> = Array.isArray(data.itens) ? data.itens : [];
            const itens = itensRaw
              .map((item) => ({ produtoId: String(item.produtoId || ''), quantidade: Number(item.quantidade) || 1 }))
              .filter((item) => item.produtoId);
            adicionarProdutos(itens);
          }
        } else if (notaFiscalId) {
          const snap = await getDoc(doc(db, 'notas_fiscais_entrada', notaFiscalId));
          if (snap.exists()) {
            const data = snap.data();
            const itensRaw: Array<{ itemId?: string; tipo?: string; quantidade?: number }> = Array.isArray(data.itens) ? data.itens : [];
            const itens = itensRaw
              .filter((item) => item.tipo === 'revenda')
              .map((item) => ({ produtoId: String(item.itemId || ''), quantidade: Number(item.quantidade) || 1 }))
              .filter((item) => item.produtoId);
            adicionarProdutos(itens);
          }
        }
      } catch (error) {
        console.error('Erro ao importar nota para etiquetas:', error);
        showError('Erro ao importar nota', 'Não foi possível carregar os produtos dessa nota. Adicione manualmente ou tente de novo.');
      }
      // NAO limpa notaAvulsaId/notaFiscalId da URL depois de importar: o
      // Sistema de Abas (TabsContext.updateTabLocation) funde duas abas que
      // "pousam" no mesmo path -- limpar a query aqui faria esta aba (recem
      // criada, com os itens ja importados) virar identica a aba "Etiquetas"
      // vazia que ja podia estar aberta, e ser fechada em favor dela,
      // jogando fora a importacao que acabou de rodar. O guard
      // importouDaQuery ja impede reimportar se o efeito rodar de novo.
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, produtos, searchParams]);

  const atualizarQuantidade = (produtoId: string, quantidade: string) => {
    setLinhas((atual) => atual.map((linha) => (linha.produtoId === produtoId ? { ...linha, quantidade } : linha)));
  };

  const removerLinha = (produtoId: string) => {
    setLinhas((atual) => atual.filter((l) => l.produtoId !== produtoId));
    setSelecionados((atual) => {
      const novo = new Set(atual);
      novo.delete(produtoId);
      return novo;
    });
  };

  const alternarSelecao = (produtoId: string) => {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(produtoId)) novo.delete(produtoId); else novo.add(produtoId);
      return novo;
    });
  };

  const todosSelecionados = linhas.length > 0 && selecionados.size === linhas.length;
  const alternarTodos = () => {
    setSelecionados(todosSelecionados ? new Set() : new Set(linhas.map((l) => l.produtoId)));
  };

  const removerSelecionados = () => {
    setLinhas((atual) => atual.filter((l) => !selecionados.has(l.produtoId)));
    setSelecionados(new Set());
  };

  const abrirImportacao = async (origem: 'avulsa' | 'fiscal') => {
    if (!tenantId) return;
    setModalImportacao(origem);
    setCarregandoNotas(true);
    try {
      if (origem === 'avulsa') {
        const snap = await getDocs(query(collection(db, 'notas_avulsas'), where('tenantId', '==', tenantId)));
        const lista = snap.docs
          .filter((d) => d.data().status === 'ativa')
          .map((d) => {
            const data = d.data();
            const itensRaw: Array<{ produtoId?: string; quantidade?: number }> = Array.isArray(data.itens) ? data.itens : [];
            const itens = itensRaw
              .map((item) => ({ produtoId: String(item.produtoId || ''), quantidade: Number(item.quantidade) || 1 }))
              .filter((item) => item.produtoId);
            return {
              id: d.id,
              titulo: `Nota Avulsa #${data.numero || '—'}`,
              subtitulo: `${data.fornecedorNome || 'Sem fornecedor'} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`,
              itens,
            };
          })
          .sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR', { numeric: true }));
        setNotasParaImportar(lista);
      } else {
        const snap = await getDocs(query(collection(db, 'notas_fiscais_entrada'), where('tenantId', '==', tenantId)));
        const lista = snap.docs
          .filter((d) => d.data().status === 'ativa')
          .map((d) => {
            const data = d.data();
            // So itens de revenda: materia-prima aponta pra outra colecao,
            // que nem tem os campos de venda que a etiqueta mostra.
            const itensRaw: Array<{ itemId?: string; tipo?: string; quantidade?: number }> = Array.isArray(data.itens) ? data.itens : [];
            const itens = itensRaw
              .filter((item) => item.tipo === 'revenda')
              .map((item) => ({ produtoId: String(item.itemId || ''), quantidade: Number(item.quantidade) || 1 }))
              .filter((item) => item.produtoId);
            return {
              id: d.id,
              titulo: `NF-e ${data.numeroNF || '—'}`,
              subtitulo: `${data.fornecedorNome || 'Sem fornecedor'} · ${formatDateInputPtBr(data.dataEmissao)} · ${itens.length} ${itens.length === 1 ? 'item de revenda' : 'itens de revenda'}`,
              itens,
            };
          })
          .sort((a, b) => b.titulo.localeCompare(a.titulo, 'pt-BR', { numeric: true }));
        setNotasParaImportar(lista);
      }
    } catch (error) {
      console.error('Erro ao carregar notas:', error);
      showError('Erro ao carregar notas', 'Não foi possível listar as notas. Atualize a página e tente novamente.');
      setModalImportacao(null);
    } finally {
      setCarregandoNotas(false);
    }
  };

  const importarNota = (nota: NotaParaImportar) => {
    if (nota.itens.length === 0) {
      showWarning('Essa nota não tem nenhum produto de revenda para gerar etiqueta.');
      return;
    }
    adicionarProdutos(nota.itens);
    setModalImportacao(null);
  };

  const moverCampoModelo = (campo: CampoEtiquetaId, xMm: number, yMm: number) => {
    setModelo((m) => ({ ...m, campos: { ...m.campos, [campo]: { ...m.campos[campo], xMm, yMm } } }));
  };

  const restaurarPosicoesPadrao = () => {
    setModelo((m) => ({ ...m, campos: MODELO_ETIQUETA_PADRAO.campos }));
  };

  const salvarModeloPadrao = async () => {
    if (!tenantId || !currentUser) return;
    setSalvandoModelo(true);
    try {
      try {
        await updateDoc(doc(db, 'configuracoes', tenantId), {
          etiquetaModelo: modelo,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Modelo de etiqueta atualizado'),
        });
      } catch {
        await setDoc(doc(db, 'configuracoes', tenantId), {
          tenantId,
          etiquetaModelo: modelo,
          ...buildDocumentUpdateMetadata(currentUser.uid, serverTimestamp(), 'Modelo de etiqueta atualizado'),
        }, { merge: true });
      }
      showSuccess('Modelo de etiqueta salvo como padrão!');
    } catch (error) {
      console.error('Erro ao salvar modelo de etiqueta:', error);
      showError('Erro ao salvar modelo', 'Não foi possível salvar o modelo de etiqueta. Tente novamente.');
    } finally {
      setSalvandoModelo(false);
    }
  };

  const handleImprimir = () => {
    if (linhas.length === 0) {
      showError('Nenhum produto na lista', 'Adicione ao menos um produto antes de imprimir as etiquetas.');
      return;
    }
    const itens: ItemEtiqueta[] = linhas.map((l) => ({
      produtoId: l.produtoId,
      quantidade: Number(l.quantidade.replace(',', '.')) || 1,
    }));
    navigate(`/estoque/etiquetas/imprimir?itens=${encodeURIComponent(serializarItensParaQuery(itens))}`);
  };

  const produtoPreview = linhas.length > 0 ? produtos.get(linhas[0].produtoId) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Barcode size={28} color="var(--accent-purple)" />
            Etiquetas
          </h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Gere etiquetas de produto com preço e código de barras pra imprimir e colar — o mesmo código pode ser bipado na venda.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button type="button" className="btn-secondary" onClick={() => setPainelModeloAberto((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SlidersHorizontal size={18} /> Configurar etiqueta
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleImprimir}
            disabled={linhas.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: linhas.length === 0 ? 0.6 : 1 }}
          >
            <Printer size={18} /> Imprimir
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '2 1 480px', padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: '260px', position: 'relative' }}>
              <label style={labelStyle}>Adicionar produto</label>
              <ProductAutocomplete
                value={buscaProduto}
                products={produtosLista}
                onChange={setBuscaProduto}
                onSelect={(produto) => { adicionarProdutos([{ produtoId: produto.id, quantidade: 1 }]); setBuscaProduto(''); }}
                placeholder="Busque pelo nome ou código..."
                ariaLabel="Buscar produto para gerar etiqueta"
                renderItem={(p) => (
                  <>
                    <span>{p.codigo ? `#${p.codigo} — ${p.nome}` : p.nome}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{p.categoria}</span>
                  </>
                )}
              />
            </div>
            <button type="button" className="btn-secondary" onClick={() => void abrirImportacao('avulsa')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileInput size={16} /> Importar Nota Avulsa
            </button>
            <button type="button" className="btn-secondary" onClick={() => void abrirImportacao('fiscal')} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileInput size={16} /> Importar Nota Fiscal
            </button>
          </div>

          {selecionados.size > 0 && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{selecionados.size} {selecionados.size === 1 ? 'produto selecionado' : 'produtos selecionados'}</span>
              <button type="button" className="btn-secondary" onClick={removerSelecionados} style={{ padding: '6px 14px', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Trash2 size={14} /> Remover da lista
              </button>
            </div>
          )}

          {carregando ? (
            <p style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>Carregando produtos...</p>
          ) : linhas.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Barcode size={48} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
              <p>Nenhum produto na lista ainda.</p>
              <p style={{ fontSize: '13px' }}>Busque um produto acima ou importe os itens de uma nota.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '10px', width: '36px' }}>
                      <input type="checkbox" checked={todosSelecionados} onChange={alternarTodos} aria-label="Selecionar todos" />
                    </th>
                    <th style={{ padding: '10px' }}>Produto</th>
                    <th style={{ padding: '10px' }}>Código</th>
                    <th style={{ padding: '10px' }}>Unidade</th>
                    <th style={{ padding: '10px', textAlign: 'right' }}>Preço</th>
                    <th style={{ padding: '10px', textAlign: 'right', width: '110px' }}>Etiquetas</th>
                    <th style={{ padding: '10px', width: '44px' }} />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => {
                    const produto = produtos.get(linha.produtoId);
                    if (!produto) return null;
                    return (
                      <tr key={linha.produtoId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '10px' }}>
                          <input
                            type="checkbox"
                            checked={selecionados.has(linha.produtoId)}
                            onChange={() => alternarSelecao(linha.produtoId)}
                            aria-label={`Selecionar ${linha.produtoNome}`}
                          />
                        </td>
                        <td style={{ padding: '10px', fontSize: '13px' }}>{linha.produtoNome}</td>
                        <td style={{ padding: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          {produto.codigoBarras || produto.codigo || <span title="Produto sem código cadastrado">—</span>}
                        </td>
                        <td style={{ padding: '10px', fontSize: '13px', color: 'var(--text-secondary)' }}>{produto.unidadeMedidaSigla}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontSize: '13px' }}>{formatBRL(produto.precoAVista ?? produto.precoVenda)}</td>
                        <td style={{ padding: '10px' }}>
                          <input
                            type="text"
                            value={linha.quantidade}
                            onChange={(e) => atualizarQuantidade(linha.produtoId, e.target.value)}
                            style={inputStyle}
                          />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          <button type="button" className="icon-btn" title="Tirar da lista" onClick={() => removerLinha(linha.produtoId)} style={{ color: '#ef4444' }}>
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(painelModeloAberto || produtoPreview) && (
          <div className="card" style={{ flex: '1 1 320px', minWidth: '300px', padding: '20px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {painelModeloAberto ? (
              <>
                <div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    Arraste nome, unidade, código de barras e preço pra onde quiser na etiqueta.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', overflow: 'auto' }}>
                    <div style={{ zoom: 3 }}>
                      <EtiquetaLabel produto={produtoPreview ?? PRODUTO_AMOSTRA} modelo={modelo} editable onMoverCampo={moverCampoModelo} />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Largura (mm)</label>
                      <input type="number" min={20} max={150} value={modelo.larguraMm} onChange={(e) => setModelo((m) => ({ ...m, larguraMm: Number(e.target.value) }))} style={{ ...inputStyle, textAlign: 'left' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Altura (mm)</label>
                      <input type="number" min={15} max={150} value={modelo.alturaMm} onChange={(e) => setModelo((m) => ({ ...m, alturaMm: Number(e.target.value) }))} style={{ ...inputStyle, textAlign: 'left' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Fonte do nome (pt)</label>
                      <input
                        type="number" min={6} max={30} value={modelo.campos.nome.fontePt}
                        onChange={(e) => setModelo((m) => ({ ...m, campos: { ...m.campos, nome: { ...m.campos.nome, fontePt: Number(e.target.value) } } }))}
                        style={{ ...inputStyle, textAlign: 'left' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Fonte do preço (pt)</label>
                      <input
                        type="number" min={6} max={40} value={modelo.campos.precoAVista.fontePt}
                        onChange={(e) => setModelo((m) => ({ ...m, campos: { ...m.campos, precoAVista: { ...m.campos.precoAVista, fontePt: Number(e.target.value) } } }))}
                        style={{ ...inputStyle, textAlign: 'left' }}
                      />
                    </div>
                  </div>
                  {([
                    ['nome', 'Mostrar nome do produto'],
                    ['precoAVista', 'Mostrar preço à vista'],
                    ['precoAPrazo', 'Mostrar preço a prazo (se cadastrado)'],
                    ['unidade', 'Mostrar unidade de medida'],
                    ['codigoBarras', 'Mostrar código de barras'],
                  ] as Array<[CampoEtiquetaId, string]>).map(([campo, texto]) => (
                    <label key={campo} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={modelo.campos[campo].visivel}
                        onChange={(e) => setModelo((m) => ({ ...m, campos: { ...m.campos, [campo]: { ...m.campos[campo], visivel: e.target.checked } } }))}
                      /> {texto}
                    </label>
                  ))}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" className="btn-secondary" onClick={restaurarPosicoesPadrao} style={{ flex: 1 }}>
                      Restaurar posições padrão
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => void salvarModeloPadrao()}
                      disabled={salvandoModelo}
                      style={{ flex: 1, opacity: salvandoModelo ? 0.6 : 1 }}
                    >
                      {salvandoModelo ? 'Salvando...' : 'Salvar como padrão'}
                    </button>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    Ajustes não salvos valem só pra impressão de agora.
                  </p>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <EtiquetaLabel produto={produtoPreview ?? PRODUTO_AMOSTRA} modelo={modelo} />
              </div>
            )}
          </div>
        )}
      </div>

      {modalImportacao && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 1300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
        }}>
          <div className="card" style={{
            backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>
                {modalImportacao === 'avulsa' ? 'Importar de uma Nota Avulsa' : 'Importar de uma Nota Fiscal'}
              </h2>
              <button type="button" onClick={() => setModalImportacao(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
                A nota só escolhe quais produtos entram e sugere a quantidade de etiquetas pela quantidade recebida.
              </p>
              {carregandoNotas ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>Carregando notas...</p>
              ) : notasParaImportar.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>Nenhuma nota ativa encontrada.</p>
              ) : (
                notasParaImportar.map((nota) => (
                  <button
                    key={nota.id}
                    type="button"
                    onClick={() => importarNota(nota)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                      padding: '12px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span>
                      <strong style={{ fontSize: '14px' }}>{nota.titulo}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{nota.subtitulo}</div>
                    </span>
                    <Check size={18} color="var(--accent-purple)" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Etiquetas;
