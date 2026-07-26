import React from 'react';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { PdvCartItem } from '../types';
import { cartLineGrossCents, cartLineNetCents, currency, fromCurrencyInput, toCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';

interface CartPanelProps {
  items: PdvCartItem[];
  selectedItemId: string;
  onSelectItem: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
  onDiscountChange: (id: string, discountCents: number) => void;
  onRemoveItem: (id: string) => void;
}

const CartPanel: React.FC<CartPanelProps> = ({
  items,
  selectedItemId,
  onSelectItem,
  onQuantityChange,
  onDiscountChange,
  onRemoveItem,
}) => (
  <section className="pdv-panel pdv-cart-panel">
    <div className="pdv-section-title">
      <ShoppingBag size={18} />
      <span>Cupom</span>
    </div>

    <div className="pdv-cart-head">
      <span>Item</span>
      <span>Qtd</span>
      <span>Desconto</span>
      <span>Total</span>
      <span />
    </div>

    <div className="pdv-cart-list">
      {items.length === 0 ? (
        <div className="pdv-empty-cart">
          <ShoppingBag size={38} />
          <strong>Nenhum item lançado</strong>
          <span>Leia o código de barras ou pesquise um produto.</span>
        </div>
      ) : items.map((item, index) => {
        const selected = selectedItemId === item.id;
        const lineGrossCents = cartLineGrossCents(item);
        const lineNetCents = cartLineNetCents(item);

        return (
          <div
            key={item.id}
            className={selected ? 'pdv-cart-row selected' : 'pdv-cart-row'}
            onClick={() => onSelectItem(item.id)}
          >
            <div className="pdv-cart-product">
              <small>{String(index + 1).padStart(3, '0')}</small>
              <div>
                <strong>{item.nome}</strong>
                <span>{currency.format(fromCents(item.precoUnitarioCentavos))} · {item.unidadeMedidaSigla || 'UN'}</span>
              </div>
            </div>

            <div className="pdv-quantity-control">
              <button type="button" onClick={(event) => { event.stopPropagation(); onQuantityChange(item.id, item.quantidade - 1); }}>
                <Minus size={14} />
              </button>
              <input
                value={String(item.quantidade)}
                inputMode="decimal"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onQuantityChange(item.id, Number(event.target.value.replace(',', '.')) || 0)}
              />
              <button type="button" onClick={(event) => { event.stopPropagation(); onQuantityChange(item.id, item.quantidade + 1); }}>
                <Plus size={14} />
              </button>
            </div>

            <input
              className="pdv-money-input"
              value={toCurrencyInput(item.descontoCentavos)}
              inputMode="decimal"
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onDiscountChange(item.id, Math.min(fromCurrencyInput(event.target.value), lineGrossCents))}
              aria-label={`Desconto do item ${item.nome}`}
            />

            <strong className="pdv-line-total">{currency.format(fromCents(lineNetCents))}</strong>

            <button
              type="button"
              className="pdv-row-action"
              title="Cancelar item"
              onClick={(event) => { event.stopPropagation(); onRemoveItem(item.id); }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
    </div>
  </section>
);

export default React.memo(CartPanel);
