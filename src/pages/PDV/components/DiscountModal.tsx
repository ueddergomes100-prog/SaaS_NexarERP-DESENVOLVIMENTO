import React, { useEffect, useState } from 'react';
import { BadgePercent, X } from 'lucide-react';
import type { SaleDiscountMode } from '../types';
import { currency, fromCurrencyInput, toCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';

interface DiscountModalProps {
  open: boolean;
  subtotalCents: number;
  itemDiscountCents: number;
  saleDiscountCents: number;
  onClose: () => void;
  onApply: (discountCents: number) => void;
}

const DiscountModal: React.FC<DiscountModalProps> = ({
  open,
  subtotalCents,
  itemDiscountCents,
  saleDiscountCents,
  onClose,
  onApply,
}) => {
  const [mode, setMode] = useState<SaleDiscountMode>('valor');
  const [value, setValue] = useState('');
  const maxDiscountCents = Math.max(0, subtotalCents - itemDiscountCents);
  const calculatedDiscountCents = mode === 'percentual'
    ? Math.round(maxDiscountCents * ((Number(value.replace(',', '.')) || 0) / 100))
    : fromCurrencyInput(value);
  const finalDiscountCents = Math.min(Math.max(0, calculatedDiscountCents), maxDiscountCents);

  useEffect(() => {
    if (open) {
      setMode('valor');
      setValue(toCurrencyInput(saleDiscountCents));
    }
  }, [open, saleDiscountCents]);

  if (!open) return null;

  const apply = () => {
    onApply(finalDiscountCents);
    onClose();
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-small-modal" role="dialog" aria-modal="true" aria-label="Desconto da venda">
        <div className="pdv-modal-header">
          <div>
            <span>F4</span>
            <h2>Desconto</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="pdv-segmented">
          <button type="button" className={mode === 'valor' ? 'active' : ''} onClick={() => setMode('valor')}>Valor</button>
          <button type="button" className={mode === 'percentual' ? 'active' : ''} onClick={() => setMode('percentual')}>Percentual</button>
        </div>

        <label className="pdv-modal-field">
          <span>{mode === 'valor' ? 'Valor do desconto' : 'Percentual do desconto'}</span>
          <input
            autoFocus
            value={value}
            inputMode="decimal"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply();
            }}
          />
        </label>

        <div className="pdv-discount-preview">
          <span>Subtotal disponível</span>
          <strong>{currency.format(fromCents(maxDiscountCents))}</strong>
          <span>Desconto aplicado</span>
          <strong>{currency.format(fromCents(finalDiscountCents))}</strong>
          <span>Total previsto</span>
          <strong>{currency.format(fromCents(Math.max(0, maxDiscountCents - finalDiscountCents)))}</strong>
        </div>

        <button type="button" className="btn-primary pdv-modal-submit" onClick={apply}>
          <BadgePercent size={18} />
          Aplicar desconto
        </button>
      </div>
    </div>
  );
};

export default React.memo(DiscountModal);
