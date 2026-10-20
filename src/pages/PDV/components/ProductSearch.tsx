import React, { useState } from 'react';
import { Barcode, PackageSearch } from 'lucide-react';
import type { PdvProduct } from '../types';
import { currency } from '../pdvHelpers';
import ProductAutocomplete from '../../../components/common/ProductAutocomplete';
import ProductSearchModal from '../../../components/common/ProductSearchModal';
import type { ProductSearchMode } from '../../../utils/productSearch';
import { renderProdutoOpcaoBusca } from '../../../components/common/ProdutoOpcaoBusca';

interface ProductSearchProps {
  value: string;
  products: PdvProduct[];
  selectedProduct: PdvProduct | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  mode?: ProductSearchMode;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSelect: (product: PdvProduct) => void;
  /** Produto em destaque na lista de busca (ou null): vira o quadro de consulta. */
  onDestacado: (product: PdvProduct | null) => void;
}

// A linha de produto e a MESMA nas quatro telas de busca -- antes cada uma
// desenhava a sua, com informacao diferente (a OS nem mostrava estoque).
// Ver src/components/common/ProdutoOpcaoBusca.tsx.
const renderProductRow = renderProdutoOpcaoBusca;

/**
 * Busca da Frente de Caixa (visual "Lavanda", 20/10/2026): o campo grande a
 * esquerda e o quadro "Produto pesquisado" ao lado -- assim a lista de
 * sugestoes nunca cobre a consulta.
 */
const ProductSearch: React.FC<ProductSearchProps> = ({
  value,
  products,
  selectedProduct,
  inputRef,
  mode,
  disabled,
  onChange,
  onSelect,
  onDestacado,
}) => {
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  return (
    <section className="pdv-panel pdv-product-panel">
      <div className="pdv-search-col">
        <span className="pdv-section-title">Produto (F3)</span>
        <div className="pdv-scan-box">
          <Barcode size={22} aria-hidden="true" />
          <ProductAutocomplete
            value={value}
            onChange={onChange}
            products={products}
            onSelect={onSelect}
            inputRef={inputRef}
            mode={mode}
            disabled={disabled}
            placeholder="Código, barras, SKU ou nome"
            ariaLabel="Pesquisar produto no PDV"
            onViewMore={() => setIsSearchModalOpen(true)}
            renderItem={renderProductRow}
            travarAoSelecionar={false}
            onDestacado={onDestacado}
          />
        </div>
        <span className="pdv-search-hint">Leitor ou digitação · Enter lança · ↑↓ escolhe da lista</span>
      </div>

      {/* Consulta (decisao do dono, 20/10/2026): mostra o produto em destaque
          na busca, antes de lancar; some quando o item entra no cupom, quando a
          busca e' apagada e quando um item e' removido. */}
      <div className={selectedProduct ? 'pdv-product-card' : 'pdv-product-card pdv-product-card--vazio'} aria-live="polite">
        <span className="pdv-product-card__label">Produto pesquisado</span>
        {selectedProduct ? (
          <>
            <div className="pdv-product-card__name">
              {selectedProduct.imagemProduto ? <img src={selectedProduct.imagemProduto} alt="" /> : null}
              <strong>{selectedProduct.nome}</strong>
            </div>
            <div className="pdv-product-card__facts">
              <span><small>Preço</small><b>{currency.format(Number(selectedProduct.precoVenda || 0))}</b></span>
              <span><small>Estoque</small><b>{(selectedProduct.quantidade || 0).toLocaleString('pt-BR')} {selectedProduct.unidadeMedidaSigla || 'UN'}</b></span>
              <span><small>Categoria</small><b>{selectedProduct.categoria || '-'}</b></span>
            </div>
            <span className="pdv-product-card__hint">Some ao lançar o item.</span>
          </>
        ) : (
          <span className="pdv-product-card__vazio">
            <PackageSearch size={20} aria-hidden="true" />
            Digite ou use as setas na lista para ver preço e estoque antes de lançar.
          </span>
        )}
      </div>

      <ProductSearchModal
        open={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        products={products}
        onSelect={onSelect}
        mode={mode}
        renderItem={renderProductRow}
        initialQuery={value}
        title="Buscar produto"
      />
    </section>
  );
};

export default React.memo(ProductSearch);
