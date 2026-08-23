import React from 'react';
import type { DescontoTipo } from '../../utils/descontoDomain';

export interface DescontoInputValue {
  tipo: DescontoTipo;
  /** Texto cru do campo -- o parse pra numero fica por conta de quem usa
   * (mesmo padrao dos campos numericos do resto do sistema). */
  valor: string;
}

interface DescontoInputProps {
  value: DescontoInputValue;
  onChange: (next: DescontoInputValue) => void;
  disabled?: boolean;
  idPrefix: string;
  label?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnterKey?: () => void;
}

/**
 * Par select(%/R$) + campo numerico, usado em toda tela que aceita
 * desconto em valor OU percentual (Pedido de Venda, OS, Orcamento, PDV).
 * Puramente controlado -- nao calcula nada sozinho, isso e' o papel de
 * calcularDescontoCents em src/utils/descontoDomain.ts.
 */
const DescontoInput: React.FC<DescontoInputProps> = ({ value, onChange, disabled, idPrefix, label, inputRef, onEnterKey }) => (
  <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
    {label && <label htmlFor={`${idPrefix}-valor`} style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</label>}
    <div style={{ display: 'flex', gap: '8px' }}>
      <select
        id={`${idPrefix}-tipo`}
        value={value.tipo}
        onChange={(e) => onChange({ ...value, tipo: e.target.value as DescontoTipo })}
        disabled={disabled}
        aria-label={label ? `${label} (unidade)` : 'Unidade do desconto'}
        style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 8px', color: 'var(--text-primary)', width: '76px' }}
      >
        <option value="valor">R$</option>
        <option value="percentual">%</option>
      </select>
      <input
        ref={inputRef}
        id={`${idPrefix}-valor`}
        type="number"
        min="0"
        max={value.tipo === 'percentual' ? 100 : undefined}
        step="0.01"
        value={value.valor}
        onChange={(e) => onChange({ ...value, valor: e.target.value })}
        onKeyDown={onEnterKey ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnterKey(); } } : undefined}
        disabled={disabled}
        style={{ flex: 1, backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '10px 12px', color: 'var(--text-primary)' }}
      />
    </div>
  </div>
);

export default DescontoInput;
