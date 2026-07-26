import React from 'react';
import { Barcode, PackageSearch, Search } from 'lucide-react';
import type { PdvProduct } from '../types';
import { currency } from '../pdvHelpers';

interface ProductSearchProps {
  value: string;
  products: PdvProduct[];
  selectedProduct: PdvProduct | null;
  highlightedIndex: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onChange: (value: string) => void;
  onHighlight: (index: number) => void;
  onSelect: (product: PdvProduct) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

const ProductSearch: React.FC<ProductSearchProps> = ({
  value,
  products,
  selectedProduct,
  highlightedIndex,
  inputRef,
  disabled,
  onChange,
  onHighlight,
  onSelect,
  onKeyDown,
}) => (
  <section className="pdv-panel pdv-product-panel">
    <div className="pdv-section-title">
      <PackageSearch size={18} />
      <span>Produto</span>
    </div>

    <div className="pdv-scan-box">
      <Barcode size={22} />
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Código, barras, SKU, referência ou nome"
        aria-label="Pesquisar produto no PDV"
        autoComplete="off"
      />
    </div>

    {value.trim() && products.length > 0 && (
      <div className="pdv-search-results">
        {products.slice(0, 8).map((product, index) => (
          <button
            key={product.id}
            type="button"
            className={highlightedIndex === index ? 'pdv-result active' : 'pdv-result'}
            onMouseEnter={() => onHighlight(index)}
            onClick={() => onSelect(product)}
          >
            <span>
              <strong>{product.nome}</strong>
              <small>{product.codigo || product.codigoBarras || product.skuSistema || 'Sem código'} · Estoque {product.quantidade || 0}</small>
            </span>
            <b>{currency.format(Number(product.precoVenda || 0))}</b>
          </button>
        ))}
      </div>
    )}

    {!value.trim() && (
      <div className="pdv-search-empty">
        <Search size={18} />
        <span>Use o leitor ou digite para buscar instantaneamente.</span>
      </div>
    )}

    {selectedProduct && (
      <div className="pdv-product-card">
        <div className="pdv-product-image">
          {selectedProduct.imagemProduto ? (
            <img src={selectedProduct.imagemProduto} alt={selectedProduct.nome} />
          ) : (
            <PackageSearch size={42} />
          )}
        </div>
        <div className="pdv-product-info">
          <span>Produto selecionado</span>
          <strong>{selectedProduct.nome}</strong>
          <div>
            <small>Preço</small>
            <b>{currency.format(Number(selectedProduct.precoVenda || 0))}</b>
          </div>
          <div>
            <small>Estoque</small>
            <b>{selectedProduct.quantidade || 0}</b>
          </div>
          <div>
            <small>Categoria</small>
            <b>{selectedProduct.categoria || '-'}</b>
          </div>
        </div>
      </div>
    )}
  </section>
);

export default React.memo(ProductSearch);
