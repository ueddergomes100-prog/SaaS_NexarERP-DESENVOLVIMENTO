import React, { useEffect, useState } from 'react';
import { BadgePercent, X } from 'lucide-react';
import type { SaleDiscountMode } from '../types';
import { currency, fromCurrencyInput, toCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';
import { centavosDoValorDigitado, descontoParaOTotalDigitado } from '../../../utils/totalDigitadoDomain';

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
  // "Total" (pedido do cliente, 15/10/2026): digita o valor combinado e o
  // desconto e' a diferenca -- mesma regra do Pedido de Venda (totalDigitadoDomain).
  const resultadoTotal = mode === 'total'
    ? descontoParaOTotalDigitado({ subtotalCents: maxDiscountCents, acrescimosCents: 0, totalDigitadoCents: centavosDoValorDigitado(value) })
    : null;
  const calculatedDiscountCents = mode === 'percentual'
    ? Math.round(maxDiscountCents * ((Number(value.replace(',', '.')) || 0) / 100))
    : mode === 'total'
      ? (resultadoTotal?.ok ? resultadoTotal.descontoCents : 0)
      : fromCurrencyInput(value);
  const finalDiscountCents = Math.min(Math.max(0, calculatedDiscountCents), maxDiscountCents);
  const erroTotal = mode === 'total' && value.trim() && resultadoTotal && !resultadoTotal.ok ? resultadoTotal.erro : '';
  const podeAplicar = mode !== 'total' || Boolean(resultadoTotal?.ok);

  useEffect(() => {
    if (open) {
      setMode('valor');
      setValue(toCurrencyInput(saleDiscountCents));
    }
  }, [open, saleDiscountCents]);

  if (!open) return null;

  const apply = () => {
    if (!podeAplicar) return;
    onApply(finalDiscountCents);
    onClose();
  };

  const escolherModo = (novo: SaleDiscountMode) => {
    setMode(novo);
    // No "Total" o campo ja' vem com o total de agora, para so' corrigir.
    if (novo === 'total') setValue(toCurrencyInput(Math.max(0, maxDiscountCents - finalDiscountCents)).replace('.', ','));
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
          <button type="button" className={mode === 'valor' ? 'active' : ''} onClick={() => escolherModo('valor')}>Valor</button>
          <button type="button" className={mode === 'percentual' ? 'active' : ''} onClick={() => escolherModo('percentual')}>Percentual</button>
          <button type="button" className={mode === 'total' ? 'active' : ''} onClick={() => escolherModo('total')} title="Digite o total combinado com o cliente; a diferença vira desconto">Total</button>
        </div>

        <label className="pdv-modal-field">
          <span>{mode === 'valor' ? 'Valor do desconto' : mode === 'percentual' ? 'Percentual do desconto' : 'Total combinado com o cliente'}</span>
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
        {erroTotal && <p style={{ margin: '0 0 12px', color: '#ef4444', fontSize: '13px' }}>{erroTotal}</p>}

        <div className="pdv-discount-preview">
          <span>Subtotal disponível</span>
          <strong>{currency.format(fromCents(maxDiscountCents))}</strong>
          <span>Desconto aplicado</span>
          <strong>{currency.format(fromCents(finalDiscountCents))}</strong>
          <span>Total previsto</span>
          <strong>{currency.format(fromCents(Math.max(0, maxDiscountCents - finalDiscountCents)))}</strong>
        </div>

        <button type="button" className="btn-primary pdv-modal-submit" onClick={apply} disabled={!podeAplicar}>
          <BadgePercent size={18} />
          Aplicar desconto
        </button>
      </div>
    </div>
  );
};

export default React.memo(DiscountModal);
