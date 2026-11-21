import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { LISTAR_TUDO_TERM, searchProducts, type ProductSearchMode, type SearchableProduct } from '../../utils/productSearch';
import { DICA_BUSCA_MULTIPLA } from '../../utils/textSearch';
import { fichaDoProduto } from '../../utils/fichaProdutoBuscaDomain';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import { renderProdutoOpcaoBusca } from './ProdutoOpcaoBusca';
// A linha padrao de produto (produto-opcao__*) e' desenhada neste arquivo.
import './ProductAutocomplete.css';
import './ProductSearchModal.css';

/** Quantos produtos a lista traz de cada vez ("Mostrar mais" traz outros tantos). */
const PASSO_DA_LISTA = 100;
const PASSO_DA_PAGINA = 8;

export interface ProductSearchModalProps<T extends SearchableProduct & { id: string }> {
  open: boolean;
  onClose: () => void;
  products: T[];
  onSelect: (product: T) => void;
  /** Mesma assinatura do autocomplete, pras duas telas usarem a MESMA
   *  linha de produto -- `termo` marca onde a busca casou. */
  renderItem: (product: T, highlighted: boolean, termo: string) => React.ReactNode;
  initialQuery?: string;
  mode?: ProductSearchMode;
  title?: string;
  /**
   * Selecao MULTIPLA (2026-09-30, pedido do dono -- igual ao app do vendedor):
   * com isto, clicar no produto MARCA (com quantidade, comeca em 1) e a janela
   * continua aberta; a marcacao sobrevive a trocar a busca ("#pedra", depois
   * "#canela"...). "Adicionar" manda todos de uma vez. Sem isto, o clique
   * escolhe um produto e fecha (as outras telas seguem assim).
   */
  onSelectMany?: (itens: Array<{ product: T; quantidade: number }>) => void;
}

const formatarPreco = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Consulta de produtos (o "Ver mais" / F3 da busca): a lista a' esquerda, em
 * ordem alfabetica, e a FICHA do produto em destaque a' direita -- preco
 * grande, disponivel, reservado, local, codigo de barras.
 *
 * Redesenhada em 21/11/2026 (cliente em monitor de 20": "pequeno e fora de
 * ordem"). O que a janela FAZ nao mudou: sem `onSelectMany`, escolher um
 * produto fecha; com ele, os produtos sao marcados com quantidade e vao todos
 * juntos no "Adicionar". Mudou onde se digita a quantidade (na ficha, nao
 * embaixo da linha) e o teclado, que agora anda a lista:
 *
 *   setas / PageUp / PageDown  -> anda a lista (a ficha acompanha)
 *   Enter na busca             -> marca o produto e vai para a quantidade
 *                                 (sem selecao multipla: escolhe e fecha)
 *   Enter na quantidade        -> volta para a busca, para o proximo produto
 *   Ctrl+Enter                 -> adiciona os marcados
 *   Esc                        -> fecha
 */
function ProductSearchModalInner<T extends SearchableProduct & { id: string }>({
  open,
  onClose,
  products,
  onSelect,
  renderItem,
  initialQuery = '',
  mode = 'completa',
  title = 'Buscar produto',
  onSelectMany,
}: ProductSearchModalProps<T>) {
  const [query, setQuery] = useState(initialQuery);
  // produtoId -> { produto, quantidade digitada }
  const [marcados, setMarcados] = useState<Record<string, { product: T; quantidade: string }>>({});
  const [destaque, setDestaque] = useState(0);
  const [limite, setLimite] = useState(PASSO_DA_LISTA);
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const quantidadeRef = useRef<HTMLInputElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  // So' o teclado rola a lista ate' o destaque; com o mouse a linha ja' esta' sob o ponteiro.
  const rolarAteODestaqueRef = useRef(false);
  const focarQuantidadeRef = useRef(false);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setMarcados({});
      setDestaque(0);
      setLimite(PASSO_DA_LISTA);
    }
  }, [open, initialQuery]);

  useEscapeLayer(open, onClose);

  // Janela aberta sem nada digitado mostra o catalogo, em ordem alfabetica:
  // antes ficava vazia pedindo para digitar "#".
  const termoDaBusca = query.trim() ? query : LISTAR_TUDO_TERM;
  const result = useMemo(
    () => searchProducts(products, termoDaBusca, { mode, limit: limite }),
    [products, termoDaBusca, mode, limite],
  );
  const semFiltro = termoDaBusca.trim() === LISTAR_TUDO_TERM;
  const destacado = result.items[Math.min(destaque, result.items.length - 1)] ?? null;
  const marcadoDoDestaque = destacado ? marcados[destacado.id] : undefined;
  const totalMarcados = Object.keys(marcados).length;
  const padrao = (renderItem as unknown) === renderProdutoOpcaoBusca;
  const ficha = useMemo(() => (destacado ? fichaDoProduto(destacado as unknown as Record<string, unknown>) : null), [destacado]);

  useEffect(() => {
    setDestaque(0);
    setLimite(PASSO_DA_LISTA);
    if (listaRef.current) listaRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    if (!rolarAteODestaqueRef.current) return;
    rolarAteODestaqueRef.current = false;
    const lista = listaRef.current;
    const linha = lista?.querySelector<HTMLElement>('[data-destaque="sim"]');
    if (!lista || !linha) return;
    const topo = linha.offsetTop - lista.offsetTop;
    if (topo < lista.scrollTop) lista.scrollTop = topo;
    else if (topo + linha.offsetHeight > lista.scrollTop + lista.clientHeight) {
      lista.scrollTop = topo + linha.offsetHeight - lista.clientHeight;
    }
  }, [destaque]);

  // Marcou (clique ou Enter): o cursor vai para a quantidade daquele produto.
  // Antes de o navegador desenhar (useLayoutEffect): quem digita rapido aperta
  // Enter e ja' o numero em seguida, e com o efeito comum o primeiro digito
  // ainda caia no campo de busca.
  useLayoutEffect(() => {
    if (!focarQuantidadeRef.current || !marcadoDoDestaque) return;
    focarQuantidadeRef.current = false;
    quantidadeRef.current?.focus();
    quantidadeRef.current?.select();
  }, [marcadoDoDestaque]);

  if (!open) return null;

  const voltarParaABusca = () => {
    buscaRef.current?.focus();
    buscaRef.current?.select();
  };

  const marcar = (product: T) => {
    focarQuantidadeRef.current = true;
    setMarcados((atual) => (atual[product.id] ? atual : { ...atual, [product.id]: { product, quantidade: '1' } }));
    // Ja' estava marcado: o efeito nao dispara, entao foca daqui.
    if (marcados[product.id]) {
      focarQuantidadeRef.current = false;
      quantidadeRef.current?.focus();
      quantidadeRef.current?.select();
    }
  };

  const desmarcar = (product: T) => {
    setMarcados((atual) => {
      if (!atual[product.id]) return atual;
      const resto = { ...atual };
      delete resto[product.id];
      return resto;
    });
  };

  const adicionarMarcados = () => {
    if (!onSelectMany || totalMarcados === 0) return;
    onSelectMany(Object.values(marcados).map((m) => ({ product: m.product, quantidade: Number(m.quantidade.replace(',', '.')) || 0 })));
    onClose();
  };

  const escolher = (product: T) => {
    onSelect(product);
    onClose();
  };

  const moverDestaque = (passo: number) => {
    if (result.items.length === 0) return;
    rolarAteODestaqueRef.current = true;
    setDestaque((atual) => Math.max(0, Math.min(atual + passo, result.items.length - 1)));
  };

  const aoTeclarNaBusca = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moverDestaque(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      moverDestaque(event.key === 'PageDown' ? PASSO_DA_PAGINA : -PASSO_DA_PAGINA);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (onSelectMany && (event.ctrlKey || event.metaKey)) { adicionarMarcados(); return; }
      if (!destacado) return;
      if (onSelectMany) marcar(destacado);
      else escolher(destacado);
    }
  };

  const termoDestaque = query.trim().replace(/^#/, '');
  const restantes = result.total - result.items.length;
  const contagem = `${result.total} ${result.total === 1 ? 'produto' : 'produtos'}`;

  return (
    <div className="product-search-modal__backdrop" onMouseDown={onClose}>
      <div
        className={`product-search-modal${padrao ? ' product-search-modal--padrao' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="product-search-modal__lado">
          <div className="product-search-modal__search">
            <Search size={22} />
            <input
              ref={buscaRef}
              autoFocus
              type="text"
              aria-label={title}
              placeholder="Nome, código, barras, marca ou categoria"
              title={`${DICA_BUSCA_MULTIPLA}. Digite # para listar todos.`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={aoTeclarNaBusca}
            />
          </div>

          <div className="product-search-modal__meta">
            {result.total === 0
              ? 'Nenhum produto na lista'
              : semFiltro ? `Catálogo completo: ${contagem}, em ordem alfabética` : `${contagem} com “${termoDestaque}”, em ordem alfabética`}
          </div>

          <div className="product-search-modal__results" ref={listaRef}>
            {result.items.map((product, index) => {
              const marcado = marcados[product.id];
              const emDestaque = destacado?.id === product.id;
              const classes = [
                'product-search-modal__option',
                onSelectMany ? 'product-search-modal__option--selectable' : '',
                marcado ? 'product-search-modal__option--selected' : '',
                emDestaque ? 'is-highlighted' : '',
              ].filter(Boolean).join(' ');
              return (
                <button
                  key={product.id}
                  type="button"
                  className={classes}
                  data-destaque={emDestaque ? 'sim' : undefined}
                  aria-pressed={onSelectMany ? Boolean(marcado) : undefined}
                  // Passar o mouse so' troca a ficha quando a janela escolhe UM
                  // produto. Na selecao multipla o cursor fica na quantidade da
                  // ficha: se o mouse trocasse o destaque, um esbarrao levava
                  // embora o campo em que a pessoa esta' digitando.
                  onMouseMove={onSelectMany ? undefined : () => { if (destaque !== index) setDestaque(index); }}
                  onClick={() => {
                    if (!onSelectMany) { escolher(product); return; }
                    // Clique marca; em produto ja' marcado, o primeiro clique
                    // traz a ficha dele (para mexer na quantidade) e o
                    // segundo desmarca.
                    if (!marcado) { setDestaque(index); marcar(product); return; }
                    if (!emDestaque) { focarQuantidadeRef.current = true; setDestaque(index); return; }
                    desmarcar(product);
                  }}
                >
                  {onSelectMany && (
                    <span className="product-search-modal__check" aria-hidden="true">{marcado && <Check size={13} strokeWidth={3} />}</span>
                  )}
                  {renderItem(product, emDestaque, termoDestaque)}
                  {marcado && <span className="product-search-modal__marcado">Qtd {marcado.quantidade || '0'}</span>}
                </button>
              );
            })}
            {result.truncated && (
              <button type="button" className="product-search-modal__mais" onClick={() => setLimite((atual) => atual + PASSO_DA_LISTA)}>
                Mostrar mais {Math.min(PASSO_DA_LISTA, restantes)} ({restantes} {restantes === 1 ? 'restante' : 'restantes'})
              </button>
            )}
            {result.items.length === 0 && (
              <div className="product-search-modal__empty">
                {semFiltro
                  ? 'Não há nenhum produto cadastrado no estoque.'
                  : `Nenhum produto encontrado para “${query.trim()}”. Confira a escrita ou busque pelo código.`}
              </div>
            )}
          </div>

          <div className="product-search-modal__teclas">
            <span><kbd>↑</kbd><kbd>↓</kbd>andar</span>
            <span><kbd>Enter</kbd>{onSelectMany ? 'marca e vai para a quantidade' : 'escolhe'}</span>
            {onSelectMany && <span><kbd>Ctrl</kbd><kbd>Enter</kbd>adiciona os marcados</span>}
            <span><kbd>Esc</kbd>fecha</span>
          </div>
        </div>

        <aside className="product-search-modal__ficha">
          <div className="product-search-modal__ficha-topo">
            <span>{title}</span>
            <button type="button" className="product-search-modal__close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">
              <X size={20} />
            </button>
          </div>

          {ficha ? (
            <div className="product-search-modal__ficha-corpo">
              <h3>{ficha.nome}</h3>
              {ficha.subtitulo && <p className="product-search-modal__sub">{ficha.subtitulo}</p>}

              {ficha.preco !== null && (
                <div className="product-search-modal__preco">
                  <strong>{formatarPreco(ficha.preco)}</strong>
                  <span>preço de venda{ficha.unidade ? `, por ${ficha.unidade}` : ''}</span>
                </div>
              )}
              {ficha.precoAVista !== null && (
                <p className="product-search-modal__avista">À vista: {formatarPreco(ficha.precoAVista)}</p>
              )}

              {ficha.linhas.length > 0 && (
                <dl className="product-search-modal__dados">
                  {ficha.linhas.map((linha) => (
                    <div key={linha.id}>
                      <dt>{linha.rotulo}</dt>
                      <dd className={linha.nivel ? `is-${linha.nivel}` : undefined}>{linha.valor}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : (
            <p className="product-search-modal__ficha-vazia">Os dados do produto aparecem aqui quando a lista tiver algum resultado.</p>
          )}

          <div className="product-search-modal__acoes">
            {onSelectMany ? (
              <>
                {destacado && marcadoDoDestaque && (
                  <div className="product-search-modal__qtd-linha">
                    <label className="product-search-modal__qty">
                      <span>Qtd{ficha?.unidade ? ` (${ficha.unidade})` : ''}</span>
                      <input
                        ref={quantidadeRef}
                        type="text"
                        inputMode="decimal"
                        value={marcadoDoDestaque.quantidade}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const valor = e.target.value.replace(/[^0-9,.]/g, '');
                          setMarcados((atual) => (atual[destacado.id] ? { ...atual, [destacado.id]: { ...atual[destacado.id], quantidade: valor } } : atual));
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          // Ctrl+Enter fecha a consulta; Enter volta para a busca, para o proximo produto.
                          if (e.ctrlKey || e.metaKey) adicionarMarcados();
                          else voltarParaABusca();
                        }}
                      />
                    </label>
                    <button type="button" className="btn-secondary" onClick={() => { desmarcar(destacado); voltarParaABusca(); }}>Desmarcar</button>
                  </div>
                )}
                {destacado && !marcadoDoDestaque && (
                  <button type="button" className="btn-secondary product-search-modal__marcar" onClick={() => marcar(destacado)}>
                    Marcar este produto
                  </button>
                )}
                <p className="product-search-modal__resumo">
                  {totalMarcados === 0
                    ? 'Marque os produtos e adicione todos de uma vez. Dá para buscar outro nome sem perder os marcados.'
                    : (
                      <>
                        <strong>{totalMarcados} {totalMarcados === 1 ? 'produto marcado' : 'produtos marcados'}</strong>
                        <button type="button" onClick={() => { setMarcados({}); voltarParaABusca(); }}>Limpar</button>
                      </>
                    )}
                </p>
                <button type="button" className="btn-primary product-search-modal__principal" disabled={totalMarcados === 0} onClick={adicionarMarcados}>
                  Adicionar {totalMarcados > 0 ? totalMarcados : ''} {totalMarcados === 1 ? 'item' : 'itens'}
                </button>
              </>
            ) : (
              <button type="button" className="btn-primary product-search-modal__principal" disabled={!destacado} onClick={() => { if (destacado) escolher(destacado); }}>
                Escolher este produto
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

const ProductSearchModal = React.memo(ProductSearchModalInner) as typeof ProductSearchModalInner;

export default ProductSearchModal;
