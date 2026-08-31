import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, PackageMinus, PackagePlus, Trash2 } from 'lucide-react';
import { collection, doc, getDoc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError, showSuccess, showWarning } from '../../utils/alerts';
import ProductAutocomplete from '../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../components/common/ProductSearchModal';
import type { SearchableProduct } from '../../utils/productSearch';
import {
  avisoUnidadeMedidaAusente,
  resolveUnidadeMedidaProduto,
  temUnidadeMedidaCadastrada,
} from '../../utils/unidadeMedidaDomain';
import { isValidSaleQuantity } from '../../utils/saleQuantity';
import {
  labelMotivoAjusteEstoque,
  motivosAjusteEstoquePorTipo,
  validarAjusteEstoque,
  type LoteEstoque,
  type TipoAjusteEstoque,
} from '../../utils/ajusteEstoqueDomain';
import { applyAjusteEstoqueManual } from '../../utils/firestoreAtomic';
import './Estoque.css';
import { DICA_BUSCA_MULTIPLA } from '../../utils/textSearch';
import './AjusteEstoque.css';

interface ProdutoAjuste extends SearchableProduct {
  id: string;
  nome: string;
  codigo?: string;
  quantidade: number;
  controlarLote: boolean;
  unidadeMedidaSigla?: string;
  unidadeMedidaFracionado?: boolean;
  unidadeMedidaCasasDecimais?: number;
  statusAtivo?: boolean;
}

/** Item já "gravado" na lista local, ainda não escrito no Firestore -- só
 * vira ajuste de verdade quando o usuário clica em "Salvar Todos os Ajustes". */
interface ItemAjustePendente {
  key: string;
  produtoId: string;
  produtoNome: string;
  produtoCodigo?: string;
  unidadeMedidaSigla: string;
  tipo: TipoAjusteEstoque;
  quantidade: number;
  motivo: string;
  observacao?: string;
  controlarLote: boolean;
  loteId?: string;
  loteLabel?: string;
  loteNovoCodigo?: string;
  loteNovoValidade?: string | null;
}

const makeItemKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const AjusteEstoque: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantId, currentUser } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [produtos, setProdutos] = useState<ProdutoAjuste[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const [selectedProduto, setSelectedProduto] = useState<ProdutoAjuste | null>(null);
  const [tipo, setTipo] = useState<TipoAjusteEstoque>('saida');
  const [motivo, setMotivo] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [observacao, setObservacao] = useState('');

  const [lotes, setLotes] = useState<LoteEstoque[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(false);
  const [loteSelecionadoId, setLoteSelecionadoId] = useState('');
  const [usarLoteNovo, setUsarLoteNovo] = useState(false);
  const [loteNovoCodigo, setLoteNovoCodigo] = useState('');
  const [loteNovoValidade, setLoteNovoValidade] = useState('');

  const [itensPendentes, setItensPendentes] = useState<ItemAjustePendente[]>([]);
  const [listaExpandida, setListaExpandida] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const carregarProdutos = async () => {
      if (!tenantId) return;
      const q = query(collection(db, 'estoque'), where('tenantId', '==', tenantId));
      const snap = await getDocs(q);
      const lista: ProdutoAjuste[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            nome: data.nome || '',
            codigo: data.codigo || '',
            codigoBarras: data.codigoBarras || '',
            referencia: data.referencia || '',
            skuSistema: data.skuSistema || '',
            marca: data.marca || '',
            categoria: data.categoria || '',
            quantidade: Number(data.quantidade || 0),
            controlarLote: data.controlarLote === true,
            unidadeMedidaSigla: data.unidadeMedidaSigla,
            unidadeMedidaFracionado: data.unidadeMedidaFracionado,
            unidadeMedidaCasasDecimais: data.unidadeMedidaCasasDecimais,
            statusAtivo: data.statusAtivo,
          };
        })
        .filter((produto) => produto.statusAtivo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome));
      setProdutos(lista);
    };
    carregarProdutos();
  }, [tenantId]);

  const carregarLotes = useCallback(async (produtoId: string) => {
    if (!tenantId) return;
    setLoadingLotes(true);
    try {
      const q = query(
        collection(db, 'estoque_lotes'),
        where('tenantId', '==', tenantId),
        where('produtoId', '==', produtoId)
      );
      const snap = await getDocs(q);
      const lista: LoteEstoque[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            lote: data.lote || '',
            validade: data.validade || null,
            quantidade: Number(data.quantidade || 0),
          };
        })
        .sort((a, b) => a.lote.localeCompare(b.lote));
      setLotes(lista);
    } catch (err) {
      console.error('Erro ao carregar lotes do produto:', err);
      showError('Erro ao carregar lotes', 'Não foi possível buscar os lotes deste produto. Tente novamente.');
    } finally {
      setLoadingLotes(false);
    }
  }, [tenantId]);

  const resetFormAjuste = () => {
    setTipo('saida');
    setMotivo('');
    setQuantidade('');
    setObservacao('');
    setLotes([]);
    setLoteSelecionadoId('');
    setUsarLoteNovo(false);
    setLoteNovoCodigo('');
    setLoteNovoValidade('');
  };

  const handleSelectProduto = useCallback((produto: ProdutoAjuste) => {
    setSelectedProduto(produto);
    setSearch('');
    resetFormAjuste();

    if (!temUnidadeMedidaCadastrada(produto)) {
      const aviso = avisoUnidadeMedidaAusente(produto.nome);
      showWarning(aviso.title, aviso.text);
    }

    if (produto.controlarLote) {
      carregarLotes(produto.id);
    }
  }, [carregarLotes]);

  useEffect(() => {
    const produtoIdParam = searchParams.get('produtoId');
    if (!produtoIdParam || produtos.length === 0 || selectedProduto) return;
    const produto = produtos.find((p) => p.id === produtoIdParam);
    if (produto) handleSelectProduto(produto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtos]);

  const unidade = selectedProduto ? resolveUnidadeMedidaProduto(selectedProduto) : null;
  const motivosDisponiveis = motivosAjusteEstoquePorTipo(tipo);
  const loteEscolhido = lotes.find((l) => l.id === loteSelecionadoId);

  const handleTipoChange = (novoTipo: TipoAjusteEstoque) => {
    setTipo(novoTipo);
    setMotivo('');
    setLoteSelecionadoId('');
    setUsarLoteNovo(false);
    setLoteNovoCodigo('');
    setLoteNovoValidade('');
  };

  const resolveUsuarioNome = useCallback(async (): Promise<string> => {
    if (!currentUser) return 'Desconhecido';
    let nome = currentUser.displayName || currentUser.email || currentUser.uid;
    try {
      const perfilSnap = await getDoc(doc(db, 'usuarios', currentUser.uid));
      if (perfilSnap.exists()) {
        const perfil = perfilSnap.data();
        nome = perfil.nome || perfil.nomeResponsavel || nome;
      }
    } catch {
      // mantem o fallback ja calculado
    }
    return nome;
  }, [currentUser]);

  // Saldo do produto considerando os itens que ja estao na lista local (ainda
  // nao gravados no Firestore) -- sem isso, dava pra "gravar" duas saidas que
  // juntas passam do estoque disponivel sem nenhum aviso ate a hora de salvar.
  const saldoEfetivoProduto = useCallback((produtoId: string, saldoBase: number): number => {
    return itensPendentes
      .filter((item) => item.produtoId === produtoId)
      .reduce((saldo, item) => (item.tipo === 'entrada' ? saldo + item.quantidade : saldo - item.quantidade), saldoBase);
  }, [itensPendentes]);

  const saldoEfetivoLote = useCallback((loteId: string, saldoBase: number): number => {
    return itensPendentes
      .filter((item) => item.loteId === loteId)
      .reduce((saldo, item) => (item.tipo === 'entrada' ? saldo + item.quantidade : saldo - item.quantidade), saldoBase);
  }, [itensPendentes]);

  const handleAdicionarItem = () => {
    if (!selectedProduto || !unidade) return;

    const quantidadeNum = Number(String(quantidade).replace(',', '.'));
    const controlarLote = selectedProduto.controlarLote;
    const entradaComLoteNovo = controlarLote && tipo === 'entrada' && usarLoteNovo;

    // Mesma regra unica de quantidade fracionada usada em Pedido de Venda, OS,
    // Orcamento e PDV (saleQuantity.ts) -- sem isso, um produto em UN aceitava
    // "1.5" no ajuste porque o atributo `step` do input nao bloqueia digitacao.
    if (!isValidSaleQuantity(quantidadeNum, unidade.unidadeMedidaFracionado, unidade.unidadeMedidaCasasDecimais)) {
      showError('Não foi possível adicionar o item', unidade.unidadeMedidaFracionado
        ? `A quantidade de ${selectedProduto.nome} aceita no máximo ${unidade.unidadeMedidaCasasDecimais ?? 0} casa(s) decimal(is), conforme a unidade ${unidade.unidadeMedidaSigla}.`
        : `${selectedProduto.nome} está configurado na unidade ${unidade.unidadeMedidaSigla}, que NÃO permite quantidade fracionada. Utilize uma quantidade inteira.`);
      return;
    }

    const erro = validarAjusteEstoque({
      tipo,
      motivo,
      quantidade: quantidadeNum,
      controlarLote,
      saldoProduto: saldoEfetivoProduto(selectedProduto.id, selectedProduto.quantidade),
      loteSelecionadoId: controlarLote && !entradaComLoteNovo ? loteSelecionadoId : undefined,
      saldoLoteSelecionado: loteEscolhido ? saldoEfetivoLote(loteEscolhido.id, loteEscolhido.quantidade) : undefined,
      loteNovoCodigo: entradaComLoteNovo ? loteNovoCodigo : undefined,
    });

    if (erro) {
      showError('Não foi possível adicionar o item', erro);
      return;
    }

    const novoItem: ItemAjustePendente = {
      key: makeItemKey(),
      produtoId: selectedProduto.id,
      produtoNome: selectedProduto.nome,
      produtoCodigo: selectedProduto.codigo || undefined,
      unidadeMedidaSigla: unidade.unidadeMedidaSigla,
      tipo,
      quantidade: quantidadeNum,
      motivo,
      observacao: observacao || undefined,
      controlarLote,
      loteId: controlarLote && !entradaComLoteNovo ? (loteSelecionadoId || undefined) : undefined,
      loteLabel: controlarLote && !entradaComLoteNovo ? loteEscolhido?.lote : undefined,
      loteNovoCodigo: entradaComLoteNovo ? loteNovoCodigo.trim() : undefined,
      loteNovoValidade: entradaComLoteNovo ? (loteNovoValidade || null) : undefined,
    };

    setItensPendentes((prev) => [...prev, novoItem]);
    setListaExpandida(true);
    setSelectedProduto(null);
    resetFormAjuste();
    searchInputRef.current?.focus();
  };

  const handleRemoverPendente = (key: string) => {
    setItensPendentes((prev) => prev.filter((item) => item.key !== key));
  };

  const handleSalvarTudo = async () => {
    if (itensPendentes.length === 0 || !tenantId || !currentUser) return;

    setSaving(true);
    const processados: string[] = [];
    try {
      const usuarioNome = await resolveUsuarioNome();

      for (const item of itensPendentes) {
        await runTransaction(db, async (transaction) => {
          await applyAjusteEstoqueManual(transaction, db, {
            tenantId,
            produtoId: item.produtoId,
            produtoNome: item.produtoNome,
            produtoCodigo: item.produtoCodigo,
            tipo: item.tipo,
            quantidade: item.quantidade,
            motivo: item.motivo,
            observacao: item.observacao,
            controlarLote: item.controlarLote,
            loteId: item.loteId,
            loteNovoCodigo: item.loteNovoCodigo,
            loteNovoValidade: item.loteNovoValidade,
            usuarioId: currentUser.uid,
            usuarioNome,
          });
        });
        processados.push(item.key);
        setProdutos((prev) => prev.map((p) => (
          p.id === item.produtoId
            ? { ...p, quantidade: item.tipo === 'entrada' ? p.quantidade + item.quantidade : p.quantidade - item.quantidade }
            : p
        )));
      }

      showSuccess(`${itensPendentes.length} ${itensPendentes.length === 1 ? 'ajuste registrado' : 'ajustes registrados'}`);
      setItensPendentes([]);
    } catch (err) {
      setItensPendentes((prev) => prev.filter((item) => !processados.includes(item.key)));
      const codigo = (err as { code?: string })?.code;
      const mensagem = codigo === 'permission-denied'
        ? 'Você não tem permissão para fazer ajuste manual de estoque. Peça ao administrador para liberar em Usuários.'
        : (err instanceof Error ? err.message : 'Tente novamente em instantes.');
      const parcial = processados.length > 0 ? ` ${processados.length} já foram salvos e saíram da lista; o restante continua pendente.` : '';
      showError('Não foi possível salvar todos os ajustes', `${mensagem}${parcial}`);
    } finally {
      setSaving(false);
    }
  };

  const podeAdicionar = !!selectedProduto && !!motivo && Number(String(quantidade).replace(',', '.')) > 0 && !saving;

  const resumoPendentes = useMemo(() => ({
    total: itensPendentes.length,
    entradas: itensPendentes.filter((item) => item.tipo === 'entrada').length,
    saidas: itensPendentes.filter((item) => item.tipo === 'saida').length,
  }), [itensPendentes]);

  return (
    <div className="estoque-page ajuste-estoque-page">
      <div className="page-header">
        <div className="header-title-group">
          <button className="icon-btn back-btn" onClick={() => navigate('/estoque')} title="Voltar">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="page-title">Ajuste Manual de Estoque</h1>
            <p className="page-subtitle">Adicione quantos itens precisar e salve todos de uma vez, com motivo registrado no relatório de ajustes.</p>
          </div>
        </div>
      </div>

      {itensPendentes.length > 0 && (
        <div className="card form-section product-card ajuste-estoque__pendentes">
          <button type="button" className="ajuste-estoque__pendentes-header" onClick={() => setListaExpandida((v) => !v)}>
            <span>
              <strong>{resumoPendentes.total}</strong> {resumoPendentes.total === 1 ? 'item pronto' : 'itens prontos'} para salvar
              {' '}({resumoPendentes.entradas} entrada{resumoPendentes.entradas === 1 ? '' : 's'}, {resumoPendentes.saidas} saída{resumoPendentes.saidas === 1 ? '' : 's'})
            </span>
            {listaExpandida ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {listaExpandida && (
            <div className="ajuste-estoque__pendentes-lista">
              {itensPendentes.map((item) => (
                <div key={item.key} className="ajuste-estoque__pendente-item">
                  <span className={`ajuste-estoque__pendente-tipo ${item.tipo}`}>
                    {item.tipo === 'entrada' ? <PackagePlus size={16} /> : <PackageMinus size={16} />}
                  </span>
                  <div className="ajuste-estoque__pendente-info">
                    <strong>{item.produtoNome}</strong>
                    <span>
                      {item.quantidade} {item.unidadeMedidaSigla} · {labelMotivoAjusteEstoque(item.tipo, item.motivo)}
                      {item.loteLabel ? ` · Lote ${item.loteLabel}` : ''}
                      {item.loteNovoCodigo ? ` · Lote novo ${item.loteNovoCodigo}` : ''}
                    </span>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => handleRemoverPendente(item.key)} title="Remover da lista" disabled={saving}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="ajuste-estoque__acoes">
            <button type="button" className="btn-primary" disabled={saving} onClick={handleSalvarTudo}>
              {saving ? <Loader2 size={18} className="spin-icon" /> : null}
              {saving ? 'Salvando...' : `Salvar Todos os Ajustes (${resumoPendentes.total})`}
            </button>
          </div>
        </div>
      )}

      <div className="card form-section product-card ajuste-estoque__busca">
        <div className="input-group">
          <label>Buscar produto (código, nome ou código de barras)</label>
          <ProductAutocomplete
            value={search}
            onChange={setSearch}
            products={produtos}
            onSelect={handleSelectProduto}
            inputRef={searchInputRef}
            placeholder={`Digite o código, nome ou bipe o código de barras — ${DICA_BUSCA_MULTIPLA}`}
            onViewMore={() => setModalOpen(true)}
            renderItem={(produto) => (
              <div className="ajuste-estoque__option">
                <span className="ajuste-estoque__option-nome">{produto.nome}</span>
                <span className="ajuste-estoque__option-meta">
                  {produto.codigo ? `Cód. ${produto.codigo} · ` : ''}
                  Estoque: {saldoEfetivoProduto(produto.id, produto.quantidade)}{produto.unidadeMedidaSigla ? ` ${produto.unidadeMedidaSigla}` : ''}
                </span>
              </div>
            )}
          />
        </div>
      </div>

      <ProductSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        products={produtos}
        onSelect={handleSelectProduto}
        title="Buscar produto para ajuste"
        renderItem={(produto) => (
          <div className="ajuste-estoque__option">
            <span className="ajuste-estoque__option-nome">{produto.nome}</span>
            <span className="ajuste-estoque__option-meta">
              {produto.codigo ? `Cód. ${produto.codigo} · ` : ''}
              Estoque: {saldoEfetivoProduto(produto.id, produto.quantidade)}{produto.unidadeMedidaSigla ? ` ${produto.unidadeMedidaSigla}` : ''}
            </span>
          </div>
        )}
      />

      {selectedProduto && unidade && (
        <div className="card form-section product-card">
          <div className="ajuste-estoque__produto-selecionado">
            <div>
              <h3>{selectedProduto.nome}</h3>
              <p>
                {selectedProduto.codigo ? `Código ${selectedProduto.codigo} · ` : ''}
                Estoque atual: <strong>{saldoEfetivoProduto(selectedProduto.id, selectedProduto.quantidade)} {unidade.unidadeMedidaSigla}</strong>
                {selectedProduto.controlarLote ? ' · Controla lote e validade' : ''}
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={() => { setSelectedProduto(null); resetFormAjuste(); }}>
              Trocar produto
            </button>
          </div>

          <div className="ajuste-estoque__tipo-toggle">
            <button
              type="button"
              className={tipo === 'entrada' ? 'active entrada' : 'entrada'}
              onClick={() => handleTipoChange('entrada')}
            >
              <PackagePlus size={18} /> Entrada
            </button>
            <button
              type="button"
              className={tipo === 'saida' ? 'active saida' : 'saida'}
              onClick={() => handleTipoChange('saida')}
            >
              <PackageMinus size={18} /> Saída
            </button>
          </div>

          <div className="form-grid-3">
            <div className="input-group">
              <label>Motivo *</label>
              <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="form-select">
                <option value="">Selecione o motivo</option>
                {motivosDisponiveis.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label>Quantidade * ({unidade.unidadeMedidaSigla})</label>
              <input
                type="number"
                min="0"
                step={unidade.unidadeMedidaFracionado ? 1 / (10 ** Math.max(1, unidade.unidadeMedidaCasasDecimais)) : 1}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {selectedProduto.controlarLote && (
            <div className="ajuste-estoque__lotes">
              {loadingLotes ? (
                <span className="field-hint">Carregando lotes...</span>
              ) : tipo === 'saida' ? (
                <div className="input-group">
                  <label>Lote que está saindo *</label>
                  <select value={loteSelecionadoId} onChange={(e) => setLoteSelecionadoId(e.target.value)} className="form-select">
                    <option value="">Selecione o lote</option>
                    {lotes.filter((l) => saldoEfetivoLote(l.id, l.quantidade) > 0).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.lote} {l.validade ? `— válido até ${l.validade}` : ''} — saldo {saldoEfetivoLote(l.id, l.quantidade)}
                      </option>
                    ))}
                  </select>
                  {lotes.filter((l) => saldoEfetivoLote(l.id, l.quantidade) > 0).length === 0 && (
                    <span className="field-hint">Nenhum lote com saldo disponível para este produto.</span>
                  )}
                </div>
              ) : (
                <>
                  <div className="ajuste-estoque__tipo-toggle ajuste-estoque__tipo-toggle--secundario">
                    <button type="button" className={!usarLoteNovo ? 'active' : ''} onClick={() => setUsarLoteNovo(false)}>
                      Lote existente
                    </button>
                    <button type="button" className={usarLoteNovo ? 'active' : ''} onClick={() => setUsarLoteNovo(true)}>
                      Lote novo
                    </button>
                  </div>
                  {usarLoteNovo ? (
                    <div className="form-grid-3">
                      <div className="input-group">
                        <label>Código do lote *</label>
                        <input type="text" value={loteNovoCodigo} onChange={(e) => setLoteNovoCodigo(e.target.value)} placeholder="Ex: L2026-08" />
                      </div>
                      <div className="input-group">
                        <label>Validade</label>
                        <input type="date" value={loteNovoValidade} onChange={(e) => setLoteNovoValidade(e.target.value)} />
                      </div>
                    </div>
                  ) : (
                    <div className="input-group">
                      <label>Lote *</label>
                      <select value={loteSelecionadoId} onChange={(e) => setLoteSelecionadoId(e.target.value)} className="form-select">
                        <option value="">Selecione o lote</option>
                        {lotes.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.lote} {l.validade ? `— válido até ${l.validade}` : ''} — saldo atual {saldoEfetivoLote(l.id, l.quantidade)}
                          </option>
                        ))}
                      </select>
                      {lotes.length === 0 && (
                        <span className="field-hint">Este produto ainda não tem lote cadastrado — use "Lote novo".</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="input-group">
            <label>Observação</label>
            <textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Detalhes opcionais sobre o ajuste" />
          </div>

          <div className="ajuste-estoque__acoes">
            <button type="button" className="btn-primary" disabled={!podeAdicionar} onClick={handleAdicionarItem}>
              Gravar Item
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AjusteEstoque;
