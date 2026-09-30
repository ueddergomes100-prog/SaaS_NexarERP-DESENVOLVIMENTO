import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { isListarTudoTerm, searchProducts, type ProductSearchMode, type SearchableProduct } from '../../utils/productSearch';
import { DICA_BUSCA_MULTIPLA } from '../../utils/textSearch';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import './ProductSearchModal.css';

const RESULTS_SAFETY_LIMIT = 100;

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

/**
 * Busca completa de produto (Modulo 10, "Ver mais"): abre a partir do
 * ProductAutocomplete quando ha mais resultados do que o limite exibido
 * no dropdown. Pesquisa nome, codigo, codigo de barras, referencia,
 * codigo interno (skuSistema), marca e categoria (F1).
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

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setMarcados({});
    }
  }, [open, initialQuery]);

  const alternar = (product: T) => {
    setMarcados((atual) => {
      if (atual[product.id]) {
        const { [product.id]: _remover, ...resto } = atual;
        return resto;
      }
      return { ...atual, [product.id]: { product, quantidade: '1' } };
    });
  };
  const totalMarcados = Object.keys(marcados).length;
  const adicionarMarcados = () => {
    if (!onSelectMany || totalMarcados === 0) return;
    onSelectMany(Object.values(marcados).map((m) => ({ product: m.product, quantidade: Number(m.quantidade.replace(',', '.')) || 0 })));
    onClose();
  };

  useEscapeLayer(open, onClose);

  const result = useMemo(
    () => searchProducts(products, query, { mode, limit: RESULTS_SAFETY_LIMIT }),
    [products, query, mode],
  );
  const listandoTudo = isListarTudoTerm(query);

  if (!open) return null;

  return (
    <div className="product-search-modal__backdrop" onMouseDown={onClose}>
      <div className="product-search-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="product-search-modal__header">
          <h3>{title}</h3>
          <button type="button" className="product-search-modal__close" onClick={onClose} title="Fechar (Esc)">
            <X size={20} />
          </button>
        </div>

        <div className="product-search-modal__search">
          <Search size={18} />
          <input
            autoFocus
            type="text"
            placeholder={`Nome, código, barras, marca ou categoria — ${DICA_BUSCA_MULTIPLA} — # lista todos (#pedra filtra)`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="product-search-modal__meta">
          {listandoTudo
            ? `Catálogo completo: ${result.total} produto${result.total === 1 ? '' : 's'}${result.truncated ? ` (mostrando os primeiros ${RESULTS_SAFETY_LIMIT})` : ''}`
            : query.trim()
              ? `${result.total} resultado${result.total === 1 ? '' : 's'}${result.truncated ? ` (mostrando os primeiros ${RESULTS_SAFETY_LIMIT})` : ''}`
              : 'Digite para buscar em todo o catálogo, ou # para ver todos os produtos.'}
        </div>

        <div className="product-search-modal__results">
          {result.items.map((product) => {
            // O que casou na busca, sem o "#" (senao o destaque nao acha nada).
            const termoDestaque = query.trim().replace(/^#/, '');
            if (!onSelectMany) {
              return (
                <button
                  key={product.id}
                  type="button"
                  className="product-search-modal__option"
                  onClick={() => {
                    onSelect(product);
                    onClose();
                  }}
                >
                  {renderItem(product, false, termoDestaque)}
                </button>
              );
            }
            const marcado = marcados[product.id];
            return (
              <div key={product.id}>
                <button
                  type="button"
                  aria-pressed={Boolean(marcado)}
                  className={`product-search-modal__option product-search-modal__option--selectable${marcado ? ' product-search-modal__option--selected' : ''}`}
                  onClick={() => alternar(product)}
                >
                  <span className="product-search-modal__check" aria-hidden="true">{marcado && <Check size={12} strokeWidth={3} />}</span>
                  {renderItem(product, false, termoDestaque)}
                </button>
                {marcado && (
                  <label className="product-search-modal__qty">
                    Quantidade
                    <input
                      autoFocus
                      type="text"
                      inputMode="decimal"
                      value={marcado.quantidade}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const valor = e.target.value.replace(/[^0-9,.]/g, '');
                        setMarcados((atual) => (atual[product.id] ? { ...atual, [product.id]: { ...atual[product.id], quantidade: valor } } : atual));
                      }}
                      onKeyDown={(e) => {
                        // Enter volta pra busca, pra marcar o proximo produto.
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (document.querySelector('.product-search-modal__search input') as HTMLInputElement | null)?.focus();
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            );
          })}
          {query.trim() && result.items.length === 0 && (
            <div className="product-search-modal__empty">
              {listandoTudo
                ? 'Não há nenhum produto cadastrado no estoque.'
                : `Nenhum produto encontrado para "${query}".`}
            </div>
          )}
        </div>

        {onSelectMany && (
          <div className="product-search-modal__footer">
            <span>
              {totalMarcados === 0
                ? 'Clique nos produtos para marcar. Dá para buscar outro nome sem perder os marcados.'
                : `${totalMarcados} produto${totalMarcados === 1 ? '' : 's'} marcado${totalMarcados === 1 ? '' : 's'}`}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {totalMarcados > 0 && (
                <button type="button" className="btn-secondary" onClick={() => setMarcados({})}>Limpar</button>
              )}
              <button type="button" className="btn-primary" disabled={totalMarcados === 0} onClick={adicionarMarcados}>
                Adicionar {totalMarcados > 0 ? totalMarcados : ''} {totalMarcados === 1 ? 'item' : 'itens'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const ProductSearchModal = React.memo(ProductSearchModalInner) as typeof ProductSearchModalInner;

export default ProductSearchModal;
