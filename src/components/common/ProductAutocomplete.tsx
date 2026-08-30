import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  searchProducts,
  type ProductSearchMode,
  type ProductSearchResult,
  type SearchableProduct,
} from '../../utils/productSearch';
import './ProductAutocomplete.css';

export interface ProductAutocompleteProps<T extends SearchableProduct & { id: string }> {
  value: string;
  onChange: (value: string) => void;
  products: T[];
  onSelect: (product: T) => void;
  renderItem: (product: T, highlighted: boolean) => React.ReactNode;
  mode?: ProductSearchMode;
  limit?: number;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  emptyHint?: React.ReactNode;
  onViewMore?: (result: ProductSearchResult<T>) => void;
  className?: string;
  /** 'overlay' (padrao) flutua sobre o conteudo; 'inline' empurra o layout, usado no PDV. */
  variant?: 'overlay' | 'inline';
}

/**
 * Autocomplete de produto compartilhado por PDV, Pedido de Venda e OS (F2).
 * Busca via src/utils/productSearch.ts (F1): codigo exato tem prioridade,
 * modo exata/completa e corte por limite com total para "Ver mais".
 * Navegacao por teclado embutida: seta cima/baixo move, Enter seleciona, Esc fecha.
 */
function ProductAutocompleteInner<T extends SearchableProduct & { id: string }>({
  value,
  onChange,
  products,
  onSelect,
  renderItem,
  mode = 'completa',
  limit = 6,
  placeholder,
  ariaLabel,
  disabled,
  autoFocus,
  inputRef,
  emptyHint,
  onViewMore,
  className,
  variant = 'overlay',
}: ProductAutocompleteProps<T>) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const resolvedInputRef = inputRef || internalRef;
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Depois de selecionado, o campo trava (so' o "x" remove) -- ninguem
  // apaga o produto sem querer digitando/dando backspace em cima do nome.
  // Comeca travado se ja' vier com valor.
  const [locked, setLocked] = useState(() => value.trim().length > 0);

  const result = useMemo(() => {
    if (!value.trim()) {
      return {
        items: products.slice(0, limit),
        total: products.length,
        truncated: products.length > limit,
      };
    }
    return searchProducts(products, value, { mode, limit });
  }, [products, value, mode, limit]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, products]);

  // Rede de seguranca: se o valor for limpo por fora (ex: depois de
  // adicionar o item ao carrinho, a tela zera a busca pro proximo
  // produto), destrava tambem -- senao o campo fica vazio mas travado.
  useEffect(() => {
    if (!value.trim()) setLocked(false);
  }, [value]);

  const confirmSelect = (product: T) => {
    onSelect(product);
    setLocked(true);
    setIsOpen(false);
  };

  const clearSelection = () => {
    onChange('');
    setLocked(false);
    resolvedInputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (result.items.length === 0) return;
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((index) => Math.min(index + 1, result.items.length - 1));
    } else if (event.key === 'ArrowUp') {
      if (result.items.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      if (result.items.length === 0) return;
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
  const showEmpty = isOpen && trimmedValue.length > 0 && result.items.length === 0 && emptyHint !== undefined;
  const extraCount = result.total - result.items.length;

  return (
    <div className={`product-autocomplete${className ? ` ${className}` : ''}`}>
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
        onBlur={() => setIsOpen(false)}
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
          className={`product-autocomplete__panel${variant === 'inline' ? ' product-autocomplete__panel--inline' : ''}`}
          role="listbox"
        >
          {result.items.map((product, index) => (
            <button
              key={product.id}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              className={
                highlightedIndex === index
                  ? 'product-autocomplete__option is-highlighted'
                  : 'product-autocomplete__option'
              }
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => confirmSelect(product)}
            >
              {renderItem(product, highlightedIndex === index)}
            </button>
          ))}

          {result.truncated && onViewMore && (
            <button
              type="button"
              className="product-autocomplete__view-more"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onViewMore(result)}
            >
              Ver mais ({extraCount} {extraCount === 1 ? 'resultado' : 'resultados'} a mais)
            </button>
          )}
        </div>
      )}

      {showEmpty && (
        <div className="product-autocomplete__empty">{emptyHint}</div>
      )}
    </div>
  );
}

const ProductAutocomplete = React.memo(ProductAutocompleteInner) as typeof ProductAutocompleteInner;

export default ProductAutocomplete;
