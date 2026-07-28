import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchProducts, type ProductSearchMode, type SearchableProduct } from '../../utils/productSearch';
import { useEscapeLayer } from '../../hooks/useKeyboardFlow';
import './ProductSearchModal.css';

const RESULTS_SAFETY_LIMIT = 100;

export interface ProductSearchModalProps<T extends SearchableProduct & { id: string }> {
  open: boolean;
  onClose: () => void;
  products: T[];
  onSelect: (product: T) => void;
  renderItem: (product: T) => React.ReactNode;
  initialQuery?: string;
  mode?: ProductSearchMode;
  title?: string;
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
}: ProductSearchModalProps<T>) {
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  useEscapeLayer(open, onClose);

  const result = useMemo(
    () => searchProducts(products, query, { mode, limit: RESULTS_SAFETY_LIMIT }),
    [products, query, mode],
  );

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
            placeholder="Nome, código, código de barras, referência, marca ou categoria..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="product-search-modal__meta">
          {query.trim()
            ? `${result.total} resultado${result.total === 1 ? '' : 's'}${result.truncated ? ` (mostrando os primeiros ${RESULTS_SAFETY_LIMIT})` : ''}`
            : 'Digite para buscar em todo o catálogo.'}
        </div>

        <div className="product-search-modal__results">
          {result.items.map((product) => (
            <button
              key={product.id}
              type="button"
              className="product-search-modal__option"
              onClick={() => {
                onSelect(product);
                onClose();
              }}
            >
              {renderItem(product)}
            </button>
          ))}
          {query.trim() && result.items.length === 0 && (
            <div className="product-search-modal__empty">Nenhum produto encontrado para "{query}".</div>
          )}
        </div>
      </div>
    </div>
  );
}

const ProductSearchModal = React.memo(ProductSearchModalInner) as typeof ProductSearchModalInner;

export default ProductSearchModal;
