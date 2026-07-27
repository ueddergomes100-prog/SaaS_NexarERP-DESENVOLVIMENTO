import React from 'react';
import { Barcode, PackageSearch, Search } from 'lucide-react';
import type { PdvProduct } from '../types';
import { currency } from '../pdvHelpers';
import ProductAutocomplete from '../../../components/common/ProductAutocomplete';

interface ProductSearchProps {
  value: string;
  products: PdvProduct[];
  selectedProduct: PdvProduct | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelect: (product: PdvProduct) => void;
}

const ProductSearch: React.FC<ProductSearchProps> = ({
  value,
  products,
  selectedProduct,
  inputRef,
  disabled,
  onChange,
  onSelect,
}) => (
  <section className="pdv-panel pdv-product-panel">
    <div className="pdv-section-title">
      <PackageSearch size={18} />
      <span>Produto</span>
    </div>

    <div className="pdv-scan-box">
      <Barcode size={22} />
      <ProductAutocomplete
        value={value}
        onChange={onChange}
        products={products}
        onSelect={onSelect}
        limit={8}
        inputRef={inputRef}
        disabled={disabled}
        placeholder="Código, barras, SKU, referência ou nome"
        ariaLabel="Pesquisar produto no PDV"
        renderItem={(product) => (
          <>
            <span>
              <strong>{product.nome}</strong>
              <small>{product.codigo || product.codigoBarras || product.skuSistema || 'Sem código'} · Estoque {product.quantidade || 0}</small>
            </span>
            <b>{currency.format(Number(product.precoVenda || 0))}</b>
          </>
        )}
      />
    </div>

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
