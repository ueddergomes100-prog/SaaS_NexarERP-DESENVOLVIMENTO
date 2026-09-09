import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Plus, Trash2, X } from 'lucide-react';
import {
  createEmptyPaymentDraft,
  fromCents,
  isCardPayment,
  paymentRequiresBankAccount,
  toCents,
  type PaymentDraft,
  type PaymentMethod,
} from '../../../utils/financeDomain';
import { useTenantCollection, type TenantCollectionItem } from '../../../hooks/useTenantCollection';
import ChequeCaptureModal from '../../../components/finance/ChequeCaptureModal';
import { getDateInputInTimeZone } from '../../../utils/dateTime';
import type { PdvFinanceConfig } from '../pdvHelpers';
import { currency } from '../pdvHelpers';

interface Banco extends TenantCollectionItem {
  nome: string;
  ativo: boolean;
  ordem: number;
}

interface PaymentModalProps {
  open: boolean;
  totalCents: number;
  financeConfig: PdvFinanceConfig;
  tenantId?: string | null;
  saving?: boolean;
  onClose: () => void;
  onFinalize: (drafts: PaymentDraft[], observation: string) => void;
}

const paymentMethods: PaymentMethod[] = [
  'Dinheiro',
  'Pix',
  'Cartão de Débito',
  'Cartão de Crédito',
  'Cheque',
];

const makePaymentDraft = (id: string, amountCents: number, defaultTermDays: number): PaymentDraft => ({
  ...createEmptyPaymentDraft(id, amountCents, defaultTermDays),
  forma: 'Dinheiro',
  parcelas: '1',
});

const PaymentModal: React.FC<PaymentModalProps> = ({
  open,
  totalCents,
  financeConfig,
  tenantId,
  saving,
  onClose,
  onFinalize,
}) => {
  const [drafts, setDrafts] = useState<PaymentDraft[]>([]);
  const [observation, setObservation] = useState('');
  const [chequeModalDraftId, setChequeModalDraftId] = useState<string | null>(null);
  const { items: bancos } = useTenantCollection<Banco>('bancos', tenantId, { sortField: 'ordem' });
  const bancosAtivos = bancos.filter((b) => b.ativo);
  const draftDoModalCheque = drafts.find((d) => d.id === chequeModalDraftId) || null;

  useEffect(() => {
    if (open) {
      setDrafts([makePaymentDraft('pdv-payment-1', totalCents, financeConfig.defaultTermDays)]);
      setObservation('');
    }
  }, [financeConfig.defaultTermDays, open, totalCents]);

  const paidCents = useMemo(() => drafts.reduce((sum, draft) => sum + toCents(draft.valor), 0), [drafts]);
  const remainingCents = totalCents - paidCents;
  const canFinalize = totalCents > 0 && remainingCents === 0 && !saving;

  if (!open) return null;

  const updateDraft = (id: string, changes: Partial<PaymentDraft>) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...changes };
      if (changes.forma === 'Cartão de Débito') {
        next.parcelas = '1';
      }
      return next;
    }));
  };

  const addPayment = () => {
    const amount = Math.max(0, remainingCents);
    setDrafts((current) => [
      ...current,
      makePaymentDraft(`pdv-payment-${Date.now()}`, amount, financeConfig.defaultTermDays),
    ]);
  };

  const removePayment = (id: string) => {
    setDrafts((current) => current.length === 1 ? current : current.filter((draft) => draft.id !== id));
  };

  return (
    <div className="pdv-modal-backdrop" role="presentation">
      <div className="pdv-modal pdv-payment-modal" role="dialog" aria-modal="true" aria-label="Pagamento do PDV">
        <div className="pdv-modal-header">
          <div>
            <span>F6</span>
            <h2>Pagamento</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar" disabled={saving}>
            <X size={20} />
          </button>
        </div>

        <div className="pdv-payment-total">
          <span>Total da venda</span>
          <strong>{currency.format(fromCents(totalCents))}</strong>
          <small className={remainingCents === 0 ? 'ok' : remainingCents > 0 ? 'warn' : 'danger'}>
            {remainingCents === 0
              ? 'Pagamento completo'
              : remainingCents > 0
                ? `Faltam ${currency.format(fromCents(remainingCents))}`
                : `Excedeu ${currency.format(fromCents(Math.abs(remainingCents)))}`
            }
          </small>
        </div>

        <div className="pdv-payment-list">
          {drafts.map((draft, index) => (
            <div className="pdv-payment-row" key={draft.id}>
              <label>
                <span>Forma</span>
                <select
                  value={draft.forma}
                  onChange={(event) => updateDraft(draft.id, { forma: event.target.value as PaymentMethod })}
                >
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Valor</span>
                <input
                  value={draft.valor}
                  inputMode="decimal"
                  autoFocus={index === 0}
                  onChange={(event) => updateDraft(draft.id, { valor: event.target.value })}
                />
              </label>

              {draft.forma !== '' && paymentRequiresBankAccount(draft.forma) && !(financeConfig.pagamentoCartaoSimplificadoAtivo && isCardPayment(draft.forma)) && (
                <label>
                  <span>Banco de destino</span>
                  <select
                    value={draft.bancoId}
                    onChange={(event) => {
                      const banco = bancosAtivos.find((b) => b.id === event.target.value);
                      updateDraft(draft.id, { bancoId: event.target.value, bancoNome: banco?.nome || '' });
                    }}
                  >
                    <option value="">Selecione...</option>
                    {bancosAtivos.map((banco) => (
                      <option key={banco.id} value={banco.id}>{banco.nome}</option>
                    ))}
                  </select>
                </label>
              )}

              {draft.forma === 'Cartão de Crédito' && !financeConfig.pagamentoCartaoSimplificadoAtivo && (
                <label>
                  <span>Parcelas</span>
                  <select
                    value={draft.parcelas}
                    onChange={(event) => updateDraft(draft.id, { parcelas: event.target.value })}
                  >
                    {Array.from({ length: financeConfig.maxCreditInstallments }, (_, idx) => String(idx + 1)).map((installment) => (
                      <option key={installment} value={installment}>{installment}x</option>
                    ))}
                  </select>
                </label>
              )}

              {draft.forma === 'Cheque' && (
                <div className="pdv-payment-placeholder">
                  <button type="button" className="btn-secondary" onClick={() => setChequeModalDraftId(draft.id)}>
                    {draft.chequeNumero ? `Cheque nº ${draft.chequeNumero}` : 'Preencher dados do cheque'}
                  </button>
                </div>
              )}

              {draft.forma !== 'Cheque' && (draft.forma !== 'Cartão de Crédito' || financeConfig.pagamentoCartaoSimplificadoAtivo) && (
                <div className="pdv-payment-placeholder">
                  <span>
                    {isCardPayment(draft.forma) && financeConfig.pagamentoCartaoSimplificadoAtivo
                      ? 'Confirmado na hora'
                      : draft.forma === 'Cartão de Débito' ? 'À vista' : 'Confirmado'}
                  </span>
                </div>
              )}

              <button type="button" className="pdv-row-action" onClick={() => removePayment(draft.id)} disabled={drafts.length === 1}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="btn-secondary pdv-add-payment" onClick={addPayment} disabled={remainingCents <= 0}>
          <Plus size={17} />
          Adicionar forma
        </button>

        <label className="pdv-modal-field">
          <span>Observação</span>
          <textarea
            rows={3}
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            placeholder="Observação interna da venda"
          />
        </label>

        <button
          type="button"
          className="btn-primary pdv-modal-submit"
          onClick={() => onFinalize(drafts, observation)}
          disabled={!canFinalize}
        >
          <CreditCard size={20} />
          {saving ? 'Finalizando...' : 'Finalizar venda'}
        </button>
      </div>

      <ChequeCaptureModal
        aberto={draftDoModalCheque !== null}
        dataMinima={getDateInputInTimeZone()}
        onConfirmar={(dados) => {
          if (!draftDoModalCheque) return;
          updateDraft(draftDoModalCheque.id, {
            chequeBancoEmissor: dados.bancoEmissor,
            chequeAgencia: dados.agencia || '',
            chequeTitular: dados.titular || '',
            chequeEmitente: dados.emitente || '',
            chequeDocumentoEmitente: dados.documentoEmitente || '',
            chequeNumero: dados.numeroCheque,
            dataPrevistaRecebimento: dados.dataCompensacao,
          });
          setChequeModalDraftId(null);
        }}
        onFechar={() => setChequeModalDraftId(null)}
        valorSugerido={draftDoModalCheque ? Number(draftDoModalCheque.valor.replace(',', '.')) || 0 : 0}
        valoresIniciais={draftDoModalCheque ? {
          bancoEmissor: draftDoModalCheque.chequeBancoEmissor,
          agencia: draftDoModalCheque.chequeAgencia,
          titular: draftDoModalCheque.chequeTitular,
          emitente: draftDoModalCheque.chequeEmitente,
          documentoEmitente: draftDoModalCheque.chequeDocumentoEmitente,
          numeroCheque: draftDoModalCheque.chequeNumero,
          dataCompensacao: draftDoModalCheque.dataPrevistaRecebimento,
        } : undefined}
      />
    </div>
  );
};

export default React.memo(PaymentModal);
