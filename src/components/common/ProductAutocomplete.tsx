import React, { useEffect, useMemo, useRef, useState } from 'react';
import { zoomDoElemento } from '../../utils/modoCompactoDomain';
import { X } from 'lucide-react';
import {
  ordenarProdutosDaBusca,
  produtoVendavel,
  searchProducts,
  type ProductSearchMode,
  type ProductSearchResult,
  type SearchableProduct,
} from '../../utils/productSearch';
import ProductSearchModal from './ProductSearchModal';
import { renderProdutoOpcaoBusca } from './ProdutoOpcaoBusca';
import { useAuth } from '../../contexts/AuthContext';
import { chaveDoProdutoPeloId, itemDaFilial } from '../../utils/cadastroGrupoDomain';
import EstoqueNasFiliais from './EstoqueNasFiliais';
import './ProductAutocomplete.css';

export interface ProductAutocompleteProps<T extends SearchableProduct & { id: string }> {
  value: string;
  onChange: (value: string) => void;
  products: T[];
  onSelect: (product: T) => void;
  /** `termo` e o que foi digitado -- serve pra linha destacar onde casou. */
  renderItem: (product: T, highlighted: boolean, termo: string) => React.ReactNode;
  mode?: ProductSearchMode;
  limit?: number;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  emptyHint?: React.ReactNode;
  /**
   * O que fazer no "Ver mais". Sem isso (padrao desde 2026-10-06) o proprio
   * componente abre o pop-up de busca completa (ProductSearchModal), o mesmo
   * da venda -- toda tela com busca de produto passa a ter a lista inteira
   * ("#" tambem lista tudo), nao so' Pedido/PDV/OS.
   */
  onViewMore?: (result: ProductSearchResult<T>) => void;
  /**
   * Enter com um produto JA selecionado. Serve pra tela lancar o item direto
   * do campo de busca, sem o operador ter que sair de Tab ate o botao
   * Adicionar -- no balcao, com fila, cada Tab conta.
   *
   * Nao dispara no Enter que SELECIONA: ali o primeiro Enter escolhe o
   * produto (e ainda da tempo de mexer na quantidade), e o segundo lanca.
   * Enter sempre significa "avanca um passo", nunca dois de uma vez.
   */
  onEnterComProdutoSelecionado?: () => void;
  className?: string;
  /** Trava o campo depois de escolher (so' o X destrava). Padrao: sim.
   *  A Frente de Caixa desliga: ela lanca o item e limpa a busca na hora. */
  travarAoSelecionar?: boolean;
  /** Avisa o produto em destaque na lista (ou null), para a tela mostrar um resumo. */
  onDestacado?: (produto: T | null) => void;
  /** 'overlay' (padrao) flutua sobre o conteudo; 'inline' empurra o layout, usado no PDV. */
  variant?: 'overlay' | 'inline';
  /** Estoque nas outras filiais do item em destaque (padrao: sim). A composicao
   *  desliga: materia-prima nao esta' no estoque de produtos. */
  mostrarEstoqueNasFiliais?: boolean;
  /**
   * Lista em COLUNAS (codigo | produto | estoque | preco), com titulo das
   * colunas em cima e a contagem embaixo -- so' quando o painel e' largo; no
   * estreito a linha continua em duas linhas (21/11/2026). Padrao: ligado
   * para quem usa a linha padrao de produto (`renderProdutoOpcaoBusca`), que
   * e' a unica que tem essas quatro informacoes.
   */
  colunas?: boolean;
  /**
   * Elemento cuja LARGURA a lista acompanha. No Pedido de Venda e' a barra de
   * lancamento inteira: o campo de produto e' so' um pedaco dela, e a lista
   * presa a ele ficava estreita justamente onde o nome precisa de espaco.
   */
  ancora?: React.RefObject<HTMLElement | null>;
  /** Quantos pixels a lista passa da ancora de cada lado (cobre o contorno de foco dela). */
  ancoraFolga?: number;
  /**
   * Ao abrir, sobe a pagina o suficiente para a lista caber inteira. Em tela
   * de 20 polegadas o campo fica no meio da tela e sobravam 6 linhas; com a
   * pagina um pouco para cima cabem 10.
   */
  rolarAoAbrir?: boolean;
}

/** Quantos produtos a lista traz antes de mandar para a consulta completa. */
const LIMITE_PADRAO = 50;
/** Cabecalho + 10 linhas + rodape: a altura que vale a pena conseguir. */
const ALTURA_BOA = 520;
const ALTURA_MINIMA = 240;
const ALTURA_MAXIMA = 640;
/** Espaco entre o campo e a lista, mais a folga ate' a beira de baixo da tela. */
const FOLGA_VERTICAL = 28;
/** O que fica visivel acima do campo quando a pagina sobe (rotulo e titulo do cartao). */
const RESPIRO_ACIMA = 104;
const PASSO_DA_PAGINA = 8;

interface Geometria {
  maxHeight?: number;
  left?: number;
  width?: number;
}

const acharRolavel = (elemento: HTMLElement): HTMLElement | null => {
  for (let atual = elemento.parentElement; atual; atual = atual.parentElement) {
    const rolagem = window.getComputedStyle(atual).overflowY;
    if ((rolagem === 'auto' || rolagem === 'scroll') && atual.scrollHeight > atual.clientHeight) return atual;
  }
  return null;
};

/**
 * Autocomplete de produto compartilhado por PDV, Pedido de Venda e OS (F2).
 * Busca via src/utils/productSearch.ts (F1): codigo exato tem prioridade,
 * modo exata/completa e corte por limite com total para "Ver mais".
 * Navegacao por teclado embutida: seta cima/baixo move, PageUp/PageDown pula
 * varias linhas, Enter seleciona, F3 abre a consulta completa, Esc fecha.
 */
function ProductAutocompleteInner<T extends SearchableProduct & { id: string }>({
  value,
  onChange,
  products,
  onSelect,
  renderItem,
  mode = 'completa',
  limit = LIMITE_PADRAO,
  placeholder,
  ariaLabel,
  disabled,
  autoFocus,
  inputRef,
  emptyHint,
  onViewMore,
  onEnterComProdutoSelecionado,
  className,
  variant = 'overlay',
  travarAoSelecionar = true,
  onDestacado,
  mostrarEstoqueNasFiliais = true,
  colunas,
  ancora,
  ancoraFolga = 0,
  rolarAoAbrir = false,
}: ProductAutocompleteProps<T>) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef || internalRef;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // Campo VAZIO lista o catalogo inteiro (padrao "# lista tudo"), mas Enter so'
  // escolhe dali depois de a pessoa navegar com a seta. Sem isso, o Enter
  // "a mais" depois de lancar um item (campo ja' limpo) pegava o primeiro da
  // lista e relancava produto sem ninguem ter pesquisado nada (dono, 13/10).
  const [navegouComSeta, setNavegouComSeta] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // Depois de selecionado, o campo trava (so' o "x" remove) -- ninguem
  // apaga o produto sem querer digitando/dando backspace em cima do nome.
  // Comeca travado se ja' vier com valor.
  const [locked, setLocked] = useState(() => value.trim().length > 0);
  const [modalAberto, setModalAberto] = useState(false);
  const [geometria, setGeometria] = useState<Geometria>({});
  // So' o teclado rola a lista ate' o item em destaque: com o mouse a linha
  // ja' esta' embaixo do ponteiro, e rolar ali faria a lista fugir da mao.
  const rolarAteODestaqueRef = useRef(false);
  // Filiais (2026-10-06): o cadastro de produtos e' do grupo, mas a busca ja'
  // vem nos "Itens desta filial" (cadastrados nela ou com estoque nela). Quem
  // pode usar outras filiais troca para "Todos do grupo".
  const { grupo, tenantId, podeTrocarFilial } = useAuth();
  const [todasAsFiliais, setTodasAsFiliais] = useState(false);
  const produtosVisiveis = useMemo(
    () => (grupo && !todasAsFiliais
      ? products.filter((p) => itemDaFilial(p as unknown as { filialOrigem?: unknown; quantidade?: unknown }, tenantId))
      : products),
    [products, grupo, todasAsFiliais, tenantId],
  );
  const escondidosPelaFilial = products.length - produtosVisiveis.length;
  const emColunas = colunas ?? ((renderItem as unknown) === renderProdutoOpcaoBusca);

  const result = useMemo(() => {
    if (!value.trim()) {
      // Campo vazio lista o catalogo com o MESMO corte da busca: produto
      // inativo e o principal de uma grade (gradeProdutosDomain.ts) nunca
      // sao oferecidos -- antes (20/10/2026) so' a busca digitada cortava.
      // E na mesma ordem dela: alfabetica (21/11/2026).
      const oferecidos = ordenarProdutosDaBusca(produtosVisiveis.filter(produtoVendavel));
      return {
        items: oferecidos.slice(0, limit),
        total: oferecidos.length,
        truncated: oferecidos.length > limit,
      };
    }
    return searchProducts(produtosVisiveis, value, { mode, limit });
  }, [produtosVisiveis, value, mode, limit]);

  useEffect(() => {
    setHighlightedIndex(0);
    setNavegouComSeta(false);
    if (listaRef.current) listaRef.current.scrollTop = 0;
  }, [value, products]);

  // Rede de seguranca: se o valor for limpo por fora (ex: depois de
  // adicionar o item ao carrinho, a tela zera a busca pro proximo
  // produto), destrava tambem -- senao o campo fica vazio mas travado.
  useEffect(() => {
    if (!value.trim()) setLocked(false);
  }, [value]);

  const confirmSelect = (product: T) => {
    onSelect(product);
    // Frente de Caixa (20/10/2026): a tela lanca o item e limpa a busca na
    // hora, entao o campo nunca trava. Travar com o campo ja' vazio (produto
    // escolhido da lista sem digitar) deixava a busca presa ate clicar no X.
    if (travarAoSelecionar) setLocked(true);
    setIsOpen(false);
    // A seta vale para a escolha que acabou de ser feita, nao para a proxima.
    setNavegouComSeta(false);
    setHighlightedIndex(0);
  };

  // Produto em destaque na lista (seta/mouse), para a tela mostrar um resumo
  // dele antes de lancar. Sem lista aberta, ou sem nada digitado e sem seta, e' null.
  const onDestacadoRef = useRef(onDestacado);
  useEffect(() => { onDestacadoRef.current = onDestacado; }, [onDestacado]);
  const destacado = isOpen && !locked && (value.trim() || navegouComSeta)
    ? (result.items[highlightedIndex] ?? null)
    : null;
  useEffect(() => {
    onDestacadoRef.current?.(destacado);
  }, [destacado]);

  /**
   * Ao abrir a lista: sobe a pagina para ela caber (quando a tela pede) e mede
   * a altura e a largura.
   *
   * A altura e' o espaco que sobra do campo ate' a beira de baixo da janela (a
   * lista nunca passa da tela -- o rodape com a contagem ficava escondido); a
   * largura acompanha a ancora, quando ha'.
   *
   * A pagina sobe de uma vez, sem animacao: a pessoa clica no campo e ja' sai
   * digitando, e cada tecla faz o navegador reposicionar a pagina no cursor --
   * uma rolagem suave em andamento era cancelada no meio e a lista ficava para
   * fora da tela.
   */
  useEffect(() => {
    if (!isOpen || locked || variant === 'inline') return undefined;
    const campo = resolvedInputRef.current;
    const raiz = rootRef.current;
    if (!campo || !raiz) return undefined;

    if (rolarAoAbrir) {
      const retangulo = campo.getBoundingClientRect();
      const espaco = window.innerHeight - retangulo.bottom - FOLGA_VERTICAL;
      const rolavel = espaco < ALTURA_BOA ? acharRolavel(campo) : null;
      if (rolavel) {
        const podeSubir = retangulo.top - rolavel.getBoundingClientRect().top - RESPIRO_ACIMA;
        const restaDePagina = rolavel.scrollHeight - rolavel.clientHeight - rolavel.scrollTop;
        const quanto = Math.floor(Math.min(ALTURA_BOA - espaco, podeSubir, restaDePagina));
        if (quanto >= 8) rolavel.scrollTop += quanto;
      }
    }

    const medir = () => {
      // Modo compacto (28/11/2026): medidas da tela convertidas para o tamanho do conteudo reduzido.
      const z = zoomDoElemento(raiz);
      const retangulo = campo.getBoundingClientRect();
      const espaco = (window.innerHeight - retangulo.bottom) / z - FOLGA_VERTICAL;
      const nova: Geometria = { maxHeight: Math.round(Math.max(ALTURA_MINIMA, Math.min(espaco, ALTURA_MAXIMA))) };
      const alvo = ancora?.current;
      if (alvo) {
        const daAncora = alvo.getBoundingClientRect();
        const daRaiz = raiz.getBoundingClientRect();
        nova.left = Math.round((daAncora.left - daRaiz.left) / z - ancoraFolga);
        nova.width = Math.round(daAncora.width / z + ancoraFolga * 2);
      }
      setGeometria((atual) => (
        atual.maxHeight === nova.maxHeight && atual.left === nova.left && atual.width === nova.width ? atual : nova
      ));
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [isOpen, locked, variant, rolarAoAbrir, ancora, ancoraFolga, resolvedInputRef]);

  // Seta/PageDown: a linha em destaque tem que estar a' vista dentro da lista.
  useEffect(() => {
    if (!rolarAteODestaqueRef.current) return;
    rolarAteODestaqueRef.current = false;
    const lista = listaRef.current;
    const linha = lista?.children[highlightedIndex] as HTMLElement | undefined;
    if (!lista || !linha) return;
    const topo = linha.offsetTop - lista.offsetTop;
    if (topo < lista.scrollTop) lista.scrollTop = topo;
    else if (topo + linha.offsetHeight > lista.scrollTop + lista.clientHeight) {
      lista.scrollTop = topo + linha.offsetHeight - lista.clientHeight;
    }
  }, [highlightedIndex]);

  const clearSelection = () => {
    onChange('');
    setLocked(false);
    resolvedInputRef.current?.focus();
  };

  const moverDestaque = (passo: number) => {
    setIsOpen(true);
    setNavegouComSeta(true);
    rolarAteODestaqueRef.current = true;
    setHighlightedIndex((index) => Math.max(0, Math.min(index + passo, result.items.length - 1)));
  };

  const abrirVerMais = (resultado: ProductSearchResult<T>) => {
    if (onViewMore) onViewMore(resultado);
    else { setIsOpen(false); setModalAberto(true); }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (result.items.length === 0) return;
      event.preventDefault();
      moverDestaque(event.key === 'ArrowDown' ? 1 : -1);
    } else if ((event.key === 'PageDown' || event.key === 'PageUp') && isOpen && !locked) {
      if (result.items.length === 0) return;
      event.preventDefault();
      moverDestaque(event.key === 'PageDown' ? PASSO_DA_PAGINA : -PASSO_DA_PAGINA);
    } else if (event.key === 'F3' && !locked && !disabled) {
      // F3 leva ao campo de produto (atalho da tela); com o cursor ja' aqui,
      // abre a consulta completa -- a janela com a ficha do produto.
      event.preventDefault();
      event.stopPropagation();
      abrirVerMais(result);
    } else if (event.key === 'Enter') {
      // Produto ja escolhido (o campo trava quando isso acontece): Enter aqui
      // lanca o item. Ver onEnterComProdutoSelecionado.
      if (locked) {
        if (!onEnterComProdutoSelecionado) return;
        event.preventDefault();
        onEnterComProdutoSelecionado();
        return;
      }
      if (result.items.length === 0) return;
      // Nada digitado e sem seta: o Enter nao escolhe ninguem.
      if (!value.trim() && !navegouComSeta) return;
      event.preventDefault();
      const product = result.items[highlightedIndex] || result.items[0];
      if (product) confirmSelect(product);
    } else if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    }
  };

  const trimmedValue = value.trim();
  const showResults = isOpen && result.items.length > 0;
  // Filiais: nada desta filial (mas ha' itens de outras) tambem precisa dizer
  // algo -- senao a pessoa acha que o produto nao existe.
  const nadaDestaFilial = Boolean(grupo) && !todasAsFiliais && escondidosPelaFilial > 0 && result.items.length === 0;
  const showEmpty = isOpen && result.items.length === 0
    && ((trimmedValue.length > 0 && emptyHint !== undefined) || nadaDestaFilial);
  const extraCount = result.total - result.items.length;
  // Campo vazio e sem seta: nenhuma linha aparece escolhida, porque o Enter ali
  // nao escolhe ninguem (o mouse continua realcando a linha em que esta').
  const destaqueAtivo = Boolean(trimmedValue) || navegouComSeta;
  const estiloDoPainel: React.CSSProperties | undefined = variant === 'inline' ? undefined : {
    ...(geometria.maxHeight ? { maxHeight: geometria.maxHeight } : {}),
    ...(geometria.left !== undefined && geometria.width !== undefined
      ? { left: geometria.left, right: 'auto', width: geometria.width }
      : {}),
  };

  return (
    <div ref={rootRef} className={`product-autocomplete${className ? ` ${className}` : ''}`}>
      <input
        ref={resolvedInputRef}
        type="text"
        value={value}
        disabled={disabled}
        readOnly={locked}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => { if (!locked) setIsOpen(true); }}
        onBlur={() => { setIsOpen(false); setNavegouComSeta(false); }}
        onKeyDown={handleKeyDown}
        className={`product-autocomplete__input${locked ? ' product-autocomplete__input--locked' : ''}`}
      />

      {locked && !disabled && (
        <button
          type="button"
          className="product-autocomplete__clear"
          aria-label="Remover produto selecionado"
          title="Remover produto selecionado"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clearSelection}
        >
          <X size={16} />
        </button>
      )}

      {showResults && (
        <div
          className={`product-autocomplete__panel${variant === 'inline' ? ' product-autocomplete__panel--inline' : ''}${emColunas ? ' product-autocomplete__panel--colunas' : ''}`}
          style={estiloDoPainel}
          // Clicar na barra de rolagem ou no rodape nao pode tirar o foco do
          // campo: a lista fecharia no meio do gesto.
          onMouseDown={(event) => event.preventDefault()}
        >
          {emColunas && (
            <div className="product-autocomplete__cabecalho" aria-hidden="true">
              <span>Cód.</span>
              <span>Produto</span>
              <span>Estoque</span>
              <span>Preço</span>
            </div>
          )}

          <div className="product-autocomplete__lista" role="listbox" ref={listaRef}>
            {result.items.map((product, index) => (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={destaqueAtivo && highlightedIndex === index}
                className={
                  destaqueAtivo && highlightedIndex === index
                    ? 'product-autocomplete__option is-highlighted'
                    : 'product-autocomplete__option'
                }
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => confirmSelect(product)}
              >
                {renderItem(product, highlightedIndex === index, value)}
              </button>
            ))}
          </div>

          {grupo && mostrarEstoqueNasFiliais && result.items[highlightedIndex] && (
            <EstoqueNasFiliais chave={chaveDoProdutoPeloId(result.items[highlightedIndex].id, tenantId)} compacto atrasoMs={250} />
          )}

          {grupo && podeTrocarFilial && (escondidosPelaFilial > 0 || todasAsFiliais) && (
            <button
              type="button"
              className="product-autocomplete__escopo"
              onClick={() => setTodasAsFiliais((v) => !v)}
            >
              {todasAsFiliais ? 'Mostrar só os itens desta filial' : 'Ver itens de todas as filiais'}
            </button>
          )}

          {result.truncated && (
            <button
              type="button"
              className="product-autocomplete__view-more"
              onClick={() => abrirVerMais(result)}
            >
              Ver mais ({extraCount} {extraCount === 1 ? 'resultado' : 'resultados'} a mais)
            </button>
          )}

          {emColunas && (
            <div className="product-autocomplete__rodape">
              <span>
                <strong>{result.total} {result.total === 1 ? 'produto' : 'produtos'}</strong>
                {result.truncated ? `, mostrando os ${result.items.length} primeiros` : ''} em ordem alfabética
              </span>
              <span className="product-autocomplete__teclas">
                <span><kbd>↑</kbd><kbd>↓</kbd>escolher</span>
                <span><kbd>Enter</kbd>seleciona</span>
                <button type="button" onClick={() => abrirVerMais(result)} title="Abre a janela de consulta, com a ficha de cada produto">
                  <kbd>F3</kbd>consulta completa
                </button>
              </span>
            </div>
          )}
        </div>
      )}

      {showEmpty && (
        <div className="product-autocomplete__empty" onMouseDown={(event) => event.preventDefault()}>
          {nadaDestaFilial
            ? (trimmedValue ? 'Nenhum item desta filial com esse nome.' : 'Esta filial ainda não tem itens próprios nem estoque recebido.')
            : emptyHint}
          {podeTrocarFilial && nadaDestaFilial && (
            <button
              type="button"
              className="product-autocomplete__escopo"
              onClick={() => setTodasAsFiliais(true)}
            >
              Procurar em todas as filiais
            </button>
          )}
        </div>
      )}

      {!onViewMore && modalAberto && (
        <ProductSearchModal
          open={modalAberto}
          onClose={() => { setModalAberto(false); resolvedInputRef.current?.focus(); }}
          products={produtosVisiveis}
          onSelect={(product) => { setModalAberto(false); confirmSelect(product); }}
          renderItem={renderItem}
          initialQuery={trimmedValue}
          mode={mode}
        />
      )}
    </div>
  );
}

const ProductAutocomplete = React.memo(ProductAutocompleteInner) as typeof ProductAutocompleteInner;

export default ProductAutocomplete;
