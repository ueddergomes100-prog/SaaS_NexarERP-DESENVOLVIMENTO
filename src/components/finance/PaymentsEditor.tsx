import React, { useEffect, useRef, useState } from 'react';
import {
  Banknote,
  CalendarClock,
  Check,
  ChevronDown,
  CreditCard,
  Landmark,
  QrCode,
  Receipt,
  RefreshCw,
  X,
  type LucideIcon,
} from 'lucide-react';
import { addDaysToDateInput, formatDateInputPtBr } from '../../utils/dateTime';
import {
  buildCardFeeSchedulesByBrand,
  fromCents,
  isCardPayment,
  paymentRequiresBankAccount,
  toCents,
  type CreditCardFeeSchedule,
  type PaymentDraft,
  type PaymentMethod,
} from '../../utils/financeDomain';
import { useTenantCollection, type TenantCollectionItem } from '../../hooks/useTenantCollection';
import './PaymentsEditor.css';

interface BandeiraCartao extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
  taxaDebitoPercentual?: number;
  taxasCreditoPorParcela?: Record<string, number>;
  prazoRecebimentoCreditoDias?: number;
  prazoRecebimentoDebitoDias?: number;
}

interface Banco extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
}

/**
 * Opcoes de bandeira para um pagamento: bandeiras ativas do catalogo do
 * tenant, mais o valor atual do pagamento caso seja um texto legado que
 * nao esta mais (ou nunca esteve) no catalogo -- nunca perde o valor
 * gravado em vendas antigas.
 */
const buildBrandOptions = (bandeiras: BandeiraCartao[], currentValue: string): string[] => {
  const active = bandeiras.filter((b) => b.ativo).map((b) => b.nome);
  const trimmedCurrent = currentValue.trim();
  if (trimmedCurrent && !active.some((nome) => nome.toLowerCase() === trimmedCurrent.toLowerCase())) {
    return [...active, trimmedCurrent];
  }
  return active;
};

export interface PaymentFinanceConfig {
  defaultTermDays: number;
  maxCreditInstallments: number;
  creditFeePercentByInstallment: CreditCardFeeSchedule;
  debitFeePercent: number;
  creditSettlementDays?: number;
  debitSettlementDays?: number;
}

interface PaymentsEditorProps {
  customerName: string;
  disabled?: boolean;
  drafts: PaymentDraft[];
  embedded?: boolean;
  financeConfig: PaymentFinanceConfig;
  idPrefix: string;
  onAddPayment: () => void;
  onRemovePayment: (id: string) => void;
  onTransactionDateChange: (date: string) => void;
  onUpdatePayment: (id: string, updates: Partial<PaymentDraft>) => void;
  sourceLabel?: string;
  tenantId?: string | null;
  totalCents: number;
  transactionDate: string;
  transactionDateLabel: string;
}

const PAYMENT_METHOD_PRESENTATION: Record<PaymentMethod, {
  description: string;
  icon: LucideIcon;
}> = {
  Dinheiro: {
    description: 'Entrada no caixa físico',
    icon: Banknote,
  },
  Pix: {
    description: 'Recebimento digital',
    icon: QrCode,
  },
  'Cartão de Crédito': {
    description: 'Recebível parcelado',
    icon: CreditCard,
  },
  'Cartão de Débito': {
    description: 'Recebível em parcela única',
    icon: CreditCard,
  },
  Transferência: {
    description: 'Recebimento digital',
    icon: Landmark,
  },
  'Pagamento a Prazo': {
    description: 'Gera uma conta a receber',
    icon: CalendarClock,
  },
  'Crédito de Devolução': {
    description: 'Usa o saldo de uma devolução',
    icon: RefreshCw,
  },
  Boleto: {
    description: 'Cobrança bancária',
    icon: Receipt,
  },
  Outros: {
    description: 'Outra forma de recebimento',
    icon: Landmark,
  },
};

interface PaymentMethodSelectProps {
  disabled?: boolean;
  id: string;
  onChange: (method: PaymentMethod) => void;
  options: PaymentMethod[];
  value: PaymentMethod;
}

const PaymentMethodSelect: React.FC<PaymentMethodSelectProps> = ({
  disabled = false,
  id,
  onChange,
  options,
  value,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.indexOf(value)));
  const listboxId = `${id}-options`;
  const selectedPresentation = PAYMENT_METHOD_PRESENTATION[value];
  const SelectedIcon = selectedPresentation.icon;

  useEffect(() => {
    const selectedIndex = options.indexOf(value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [options, value]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isOpen]);

  const selectMethod = (method: PaymentMethod) => {
    onChange(method);
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || options.length === 0) return;

    if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;

      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(Math.max(0, options.indexOf(value)));
        return;
      }

      setHighlightedIndex((current) => (current + direction + options.length) % options.length);
      return;
    }

    if (isOpen && event.key === 'Home') {
      event.preventDefault();
      setHighlightedIndex(0);
      return;
    }

    if (isOpen && event.key === 'End') {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
      return;
    }

    if (isOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      selectMethod(options[highlightedIndex]);
    }
  };

  return (
    <div
      className={`payment-method-select${isOpen ? ' is-open' : ''}`}
      onKeyDown={handleKeyDown}
      ref={containerRef}
    >
      <button
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="payment-method-select__trigger"
        disabled={disabled}
        id={id}
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className="payment-method-select__value">
          <SelectedIcon aria-hidden="true" size={17} strokeWidth={1.9} />
          <span>{value}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="payment-method-select__chevron"
          size={17}
          strokeWidth={2}
        />
      </button>

      {isOpen && !disabled && (
        <div
          aria-labelledby={id}
          className="payment-method-select__menu"
          id={listboxId}
          role="listbox"
        >
          {options.map((method, index) => {
            const presentation = PAYMENT_METHOD_PRESENTATION[method];
            const MethodIcon = presentation.icon;
            const isSelected = method === value;

            return (
              <button
                aria-selected={isSelected}
                className="payment-method-select__option"
                data-highlighted={index === highlightedIndex}
                key={method}
                onClick={() => selectMethod(method)}
                onMouseEnter={() => setHighlightedIndex(index)}
                role="option"
                type="button"
              >
                <span className="payment-method-select__option-icon">
                  <MethodIcon aria-hidden="true" size={18} strokeWidth={1.9} />
                </span>
                <span className="payment-method-select__option-copy">
                  <strong>{method}</strong>
                  <small>{presentation.description}</small>
                </span>
                <span className="payment-method-select__check" aria-hidden="true">
                  {isSelected && <Check size={17} strokeWidth={2.4} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PaymentsEditor: React.FC<PaymentsEditorProps> = ({
  customerName,
  disabled = false,
  drafts,
  embedded = false,
  financeConfig,
  idPrefix,
  onAddPayment,
  onRemovePayment,
  onTransactionDateChange,
  onUpdatePayment,
  sourceLabel = 'operação',
  tenantId,
  totalCents,
  transactionDate,
  transactionDateLabel,
}) => {
  const { items: bandeiras } = useTenantCollection<BandeiraCartao>('bandeiras_cartao', tenantId, {
    sortField: 'ordem',
  });
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, {
    sortField: 'ordem',
  });
  const bancosAtivos = bancos.filter((b) => b.ativo);
  const cardFeeSchedulesByBrand = buildCardFeeSchedulesByBrand(bandeiras);
  const informedCents = drafts.reduce((sum, payment) => sum + toCents(payment.valor), 0);
  const isFinalConsumer = customerName.toLowerCase().includes('consumidor final');
  const availableMethods: PaymentMethod[] = isFinalConsumer
    ? ['Dinheiro', 'Pix']
    : ['Dinheiro', 'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Transferência', 'Pagamento a Prazo'];

  return (
    <div className={`payments-editor${embedded ? ' payments-editor--embedded' : ' card'}`}>
      <div className="payments-editor__header">
        <h3>Pagamentos e condição</h3>
        {!disabled && (
          <button type="button" className="btn-secondary payments-editor__add" onClick={onAddPayment}>
            + Adicionar forma
          </button>
        )}
      </div>

      <div className="input-group">
        <label htmlFor={`${idPrefix}-date`}>{transactionDateLabel}</label>
        <input
          disabled={disabled}
          id={`${idPrefix}-date`}
          onChange={(event) => onTransactionDateChange(event.target.value)}
          type="date"
          value={transactionDate}
        />
      </div>

      {drafts.map((payment, index) => {
        const paymentCents = toCents(payment.valor);
        const installmentCount = payment.forma === 'Cartão de Crédito'
          ? Math.max(1, Number.parseInt(payment.parcelas, 10) || 1)
          : 1;
        const installmentPreview = fromCents(Math.floor(paymentCents / installmentCount));
        const dueDate = payment.dataVencimento
          || addDaysToDateInput(transactionDate, Number.parseInt(payment.prazoDias, 10) || 0);
        const brandSchedule = payment.bandeira?.trim() ? cardFeeSchedulesByBrand[payment.bandeira.trim()] : undefined;
        const settlementDays = payment.forma === 'Cartão de Crédito'
          ? (brandSchedule?.creditSettlementDays ?? financeConfig.creditSettlementDays)
          : (brandSchedule?.debitSettlementDays ?? financeConfig.debitSettlementDays);
        const defaultSettlementDate = Number.isInteger(settlementDays) && Number(settlementDays) >= 0
          ? addDaysToDateInput(transactionDate, Number(settlementDays))
          : '';
        const settlementDatePreview = payment.dataPrevistaRecebimento || defaultSettlementDate;

        return (
          <div className="payments-editor__payment" key={payment.id}>
            <div className="payments-editor__payment-header">
              <strong>Pagamento {index + 1}</strong>
              {!disabled && drafts.length > 1 && (
                <button
                  className="payments-editor__remove"
                  onClick={() => onRemovePayment(payment.id)}
                  title="Remover forma"
                  type="button"
                >
                  <X size={17} />
                </button>
              )}
            </div>

            <div className="payments-editor__main-fields">
              <div className="input-group">
                <label htmlFor={`${idPrefix}-method-${payment.id}`}>Forma de pagamento</label>
                <PaymentMethodSelect
                  disabled={disabled}
                  id={`${idPrefix}-method-${payment.id}`}
                  onChange={(method) => {
                    onUpdatePayment(payment.id, {
                      forma: method,
                      parcelas: method === 'Cartão de Débito' ? '1' : payment.parcelas,
                      dataVencimento: method === 'Pagamento a Prazo' ? payment.dataVencimento : '',
                    });
                  }}
                  options={availableMethods}
                  value={payment.forma}
                />
              </div>
              <div className="input-group">
                <label htmlFor={`${idPrefix}-amount-${payment.id}`}>Valor (R$)</label>
                <input
                  disabled={disabled}
                  id={`${idPrefix}-amount-${payment.id}`}
                  min="0.01"
                  onChange={(event) => onUpdatePayment(payment.id, { valor: event.target.value })}
                  step="0.01"
                  type="number"
                  value={payment.valor}
                />
              </div>
            </div>

            {paymentRequiresBankAccount(payment.forma) && (
              <div className="input-group">
                <label htmlFor={`${idPrefix}-banco-${payment.id}`}>Banco de destino *</label>
                <select
                  disabled={disabled}
                  id={`${idPrefix}-banco-${payment.id}`}
                  onChange={(event) => {
                    const banco = bancosAtivos.find((b) => b.id === event.target.value);
                    onUpdatePayment(payment.id, { bancoId: event.target.value, bancoNome: banco?.nome || '' });
                  }}
                  value={payment.bancoId}
                >
                  <option value="">Selecione...</option>
                  {bancosAtivos.map((banco) => (
                    <option key={banco.id} value={banco.id}>{banco.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {payment.forma === 'Pagamento a Prazo' && (
              <div className="payments-editor__term-fields">
                <div className="input-group">
                  <label htmlFor={`${idPrefix}-term-${payment.id}`}>Prazo em dias *</label>
                  <input
                    disabled={disabled}
                    id={`${idPrefix}-term-${payment.id}`}
                    min="1"
                    onChange={(event) => {
                      const days = Number.parseInt(event.target.value, 10);
                      onUpdatePayment(payment.id, {
                        prazoDias: event.target.value,
                        dataVencimento: Number.isInteger(days) && days > 0
                          ? addDaysToDateInput(transactionDate, days)
                          : '',
                      });
                    }}
                    step="1"
                    type="number"
                    value={payment.prazoDias}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor={`${idPrefix}-due-${payment.id}`}>Data de vencimento *</label>
                  <input
                    disabled={disabled}
                    id={`${idPrefix}-due-${payment.id}`}
                    min={addDaysToDateInput(transactionDate, 1)}
                    onChange={(event) => onUpdatePayment(payment.id, { dataVencimento: event.target.value })}
                    type="date"
                    value={payment.dataVencimento || dueDate}
                  />
                </div>
                <div className="payments-editor__term-notice">
                  Vencimento calculado: <strong>{formatDateInputPtBr(dueDate)}</strong>. Este valor ficará em Contas a Receber e não entra no caixa físico.
                </div>
              </div>
            )}

            {isCardPayment(payment.forma) && (
              <div className="payments-editor__card-fields">
                <div className="payments-editor__card-grid">
                  <div className="input-group">
                    <label htmlFor={`${idPrefix}-brand-${payment.id}`}>Bandeira</label>
                    <select
                      disabled={disabled}
                      id={`${idPrefix}-brand-${payment.id}`}
                      onChange={(event) => onUpdatePayment(payment.id, { bandeira: event.target.value })}
                      value={payment.bandeira}
                    >
                      <option value="">Selecione...</option>
                      {buildBrandOptions(bandeiras, payment.bandeira).map((nome) => (
                        <option key={nome} value={nome}>{nome}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor={`${idPrefix}-authorization-${payment.id}`}>NSU / autorização</label>
                    <input
                      disabled={disabled}
                      id={`${idPrefix}-authorization-${payment.id}`}
                      onChange={(event) => onUpdatePayment(payment.id, { autorizacao: event.target.value })}
                      placeholder="Opcional"
                      value={payment.autorizacao}
                    />
                  </div>
                  {payment.forma === 'Cartão de Crédito' && (
                    <div className="input-group">
                      <label htmlFor={`${idPrefix}-installments-${payment.id}`}>Parcelas *</label>
                      <input
                        disabled={disabled}
                        id={`${idPrefix}-installments-${payment.id}`}
                        max={financeConfig.maxCreditInstallments || undefined}
                        min="1"
                        onChange={(event) => onUpdatePayment(payment.id, { parcelas: event.target.value })}
                        step="1"
                        type="number"
                        value={payment.parcelas}
                      />
                    </div>
                  )}
                  <div className="input-group">
                    <label htmlFor={`${idPrefix}-settlement-${payment.id}`}>Primeiro recebimento previsto</label>
                    <input
                      disabled={disabled}
                      id={`${idPrefix}-settlement-${payment.id}`}
                      onChange={(event) => onUpdatePayment(payment.id, { dataPrevistaRecebimento: event.target.value })}
                      type="date"
                      value={settlementDatePreview}
                    />
                  </div>
                </div>
                {defaultSettlementDate && !payment.dataPrevistaRecebimento && (
                  <div className="payments-editor__term-notice">
                    Recebimento calculado a partir da configuração de{' '}
                    {payment.forma === 'Cartão de Crédito' ? 'crédito' : 'débito'}: <strong>{formatDateInputPtBr(defaultSettlementDate)}</strong>.
                  </div>
                )}
                <div className="payments-editor__card-summary">
                  {payment.forma === 'Cartão de Crédito' ? (
                    <span>Parcelamento: <strong>{installmentCount}x de aproximadamente R$ {installmentPreview.toFixed(2)}</strong></span>
                  ) : (
                    <span>Pagamento registrado em <strong>parcela única</strong>.</span>
                  )}
                </div>
                <span className="payments-editor__pending-notice">
                  Pagamento registrado para conciliação financeira.
                </span>
              </div>
            )}

            {payment.forma === 'Dinheiro' ? (
              <span className="payments-editor__cash-notice">Este pagamento movimenta o caixa físico.</span>
            ) : payment.forma === 'Pix' || payment.forma === 'Transferência' ? (
              <span className="payments-editor__digital-notice">Recebimento digital confirmado; não movimenta o caixa físico.</span>
            ) : null}
          </div>
        );
      })}

      <div className="payments-editor__total">
        <span>Soma informada</span>
        <strong data-matches={informedCents === totalCents}>
          R$ {fromCents(informedCents).toFixed(2)} / R$ {fromCents(totalCents).toFixed(2)}
        </strong>
      </div>

      <span className="payments-editor__source-note">
        Os lançamentos financeiros desta {sourceLabel} serão individualizados por forma de pagamento.
      </span>
    </div>
  );
};

export default PaymentsEditor;
