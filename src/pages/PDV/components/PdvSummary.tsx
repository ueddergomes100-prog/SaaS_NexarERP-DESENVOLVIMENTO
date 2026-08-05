import React from 'react';
import { Banknote, CreditCard, Eraser, ReceiptText, UserRound } from 'lucide-react';
import type { PdvClient, PdvSession, PdvTotals } from '../types';
import { currency } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';

interface PdvSummaryProps {
  totals: PdvTotals;
  client: PdvClient | null;
  session: PdvSession | null;
  disabled?: boolean;
  onOpenClient: () => void;
  onOpenDiscount: () => void;
  onOpenPayment: () => void;
  onClearSale: () => void;
  onOpenSession: () => void;
  onCloseSession: () => void;
  onOpenSangria: () => void;
}

const PdvSummary: React.FC<PdvSummaryProps> = ({
  totals,
  client,
  session,
  disabled,
  onOpenClient,
  onOpenDiscount,
  onOpenPayment,
  onClearSale,
  onOpenSession,
  onCloseSession,
  onOpenSangria,
}) => (
  <aside className="pdv-summary">
    <div className="pdv-session-card">
      <span>{session ? 'Caixa aberto' : 'Caixa fechado'}</span>
      <strong>{session ? session.operadorNome : 'Abra o caixa'}</strong>
      <div className="pdv-session-actions">
        {session && (
          <button type="button" className="btn-secondary" onClick={onOpenSangria} title="Registrar sangria">
            <Banknote size={16} />
            Sangria
          </button>
        )}
        <button type="button" onClick={session ? onCloseSession : onOpenSession}>
          {session ? 'Fechar caixa' : 'Abrir caixa'}
        </button>
      </div>
    </div>

    <button type="button" className="pdv-client-card" onClick={onOpenClient}>
      <UserRound size={18} />
      <span>
        <small>Cliente</small>
        <strong>{client?.nome || 'CONSUMIDOR FINAL'}</strong>
      </span>
    </button>

    <div className="pdv-total-card">
      <span>Subtotal</span>
      <strong>{currency.format(fromCents(totals.subtotalCentavos))}</strong>
      <span>Descontos</span>
      <strong className="discount">- {currency.format(fromCents(totals.descontoTotalCentavos))}</strong>
      <span>Itens</span>
      <strong>{totals.itemCount} itens · {totals.volumeCount.toLocaleString('pt-BR')} un.</strong>
      <div className="pdv-grand-total">
        <small>Total</small>
        <b>{currency.format(fromCents(totals.totalCentavos))}</b>
      </div>
    </div>

    <div className="pdv-actions">
      <button type="button" className="btn-secondary" onClick={onOpenDiscount} disabled={disabled}>
        <ReceiptText size={18} />
        Desconto
      </button>
      <button type="button" className="btn-secondary danger-lite" onClick={onClearSale} disabled={disabled}>
        <Eraser size={18} />
        Limpar
      </button>
      <button type="button" className="btn-primary pdv-pay-button" onClick={onOpenPayment} disabled={disabled || !session || totals.totalCentavos <= 0}>
        <CreditCard size={22} />
        Pagamento
      </button>
    </div>

    <div className="pdv-shortcuts">
      <span><kbd>F2</kbd> Cliente</span>
      <span><kbd>F3</kbd> Produto</span>
      <span><kbd>F4</kbd> Desconto</span>
      <span><kbd>F5</kbd> Quantidade</span>
      <span><kbd>F6</kbd> Pagamento</span>
      <span><kbd>F7</kbd> Finalizar</span>
      <span><kbd>Esc</kbd> Fechar</span>
      <span><kbd>Enter</kbd> Confirmar</span>
    </div>
  </aside>
);

export default React.memo(PdvSummary);
