import React, { useEffect, useMemo, useState } from 'react';
import { CreditCard, Plus, Trash2, X } from 'lucide-react';
import {
  createEmptyPaymentDraft,
  fromCents,
  isCardPayment,
  pedeBancoDeDestino,
  toCents,
  type PaymentDraft,
  type PaymentMethod,
} from '../../../utils/financeDomain';
import { useTenantCollection, type TenantCollectionItem } from '../../../hooks/useTenantCollection';
import ChequeCaptureModal from '../../../components/finance/ChequeCaptureModal';
import { addDaysToDateInput, formatDateInputPtBr, getDateInputInTimeZone } from '../../../utils/dateTime';
import { contaDoTroco, pagamentosSemOTroco } from '../../../utils/frenteDeCaixaDomain';
import { FORMA_A_PRAZO } from '../../../utils/vendaFechamentoDomain';
import type { PdvFinanceConfig } from '../pdvHelpers';
import { currency } from '../pdvHelpers';
import { faixasDisponiveis, valorSugeridoDoCashback, type CashbackDisponivel } from '../../../utils/cashbackDomain';
import { bancoSugerido, type ConfigBancoPadrao } from '../../../utils/formasPagamentoDomain';

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
  /** Cashback do cliente (20/10/2026): so' com saldo que de' para usar neste cupom e venda pelo servidor. */
  cashbackDisponivel?: CashbackDisponivel | null;
  /** Pre-venda faturada no caixa (23/11/2026): a observacao ja' abre com a da pre-venda. */
  observacaoInicial?: string;
  /** Texto do botao de finalizar (a pre-venda diz "Receber e faturar"). */
  rotuloFinalizar?: string;
  /** "Nota" na Frente de Caixa (25/11/2026): caixa de marcar da filial. */
  aPrazoAtivo?: boolean;
  /**
   * Banco padrao por forma (25/11/2026, Configuracoes da filial): escolheu Pix ou
   * cartao, o banco ja' vem. Da' para trocar na hora. Sem config = como antes.
   */
  configBancoPadrao?: ConfigBancoPadrao;
  /** Pre-venda com a forma escolhida pelo vendedor no app (25/11/2026): o pagamento ja' abre nela. */
  formaInicial?: string;
  onClose: () => void;
  /** Os pagamentos chegam SEM o troco (somam o total); o troco vem a parte, so' para avisar. */
  onFinalize: (drafts: PaymentDraft[], observation: string, trocoCentavos: number) => void;
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
  cashbackDisponivel = null,
  observacaoInicial = '',
  rotuloFinalizar = 'Finalizar venda',
  aPrazoAtivo = false,
  configBancoPadrao,
  formaInicial = '',
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
      const inicial = makePaymentDraft('pdv-payment-1', totalCents, financeConfig.defaultTermDays);
      const forma = formaInicial && (paymentMethods as string[]).concat(aPrazoAtivo ? [FORMA_A_PRAZO] : []).includes(formaInicial)
        ? formaInicial as PaymentMethod
        : inicial.forma;
      setDrafts([{ ...inicial, forma }]);
      setObservation(observacaoInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financeConfig.defaultTermDays, open, totalCents, observacaoInicial, formaInicial]);

  // Banco padrao da forma (25/11/2026) tambem no pagamento que ja' abre numa forma
  // com banco (a escolhida pelo vendedor) e quando os bancos terminam de carregar.
  const idsDosBancosAtivos = bancosAtivos.map((b) => b.id).join(',');
  const formasSemBanco = drafts.filter((d) => !d.bancoId).map((d) => `${d.id}:${d.forma}`).join('|');
  useEffect(() => {
    if (!configBancoPadrao || !idsDosBancosAtivos || !formasSemBanco) return;
    const ativos = idsDosBancosAtivos.split(',');
    setDrafts((atual) => {
      let mudou = false;
      const proximos = atual.map((d) => {
        if (d.bancoId || !pedeBancoDeDestino(d.forma, financeConfig.pagamentoCartaoSimplificadoAtivo)) return d;
        const id = bancoSugerido({ forma: d.forma, config: { ...configBancoPadrao, lembrarDoDia: false }, doDia: null, hoje: getDateInputInTimeZone(), bancosAtivosIds: ativos });
        const banco = id ? bancosAtivos.find((b) => b.id === id) : undefined;
        if (!banco) return d;
        mudou = true;
        return { ...d, bancoId: banco.id, bancoNome: banco.nome };
      });
      return mudou ? proximos : atual;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configBancoPadrao, idsDosBancosAtivos, formasSemBanco, financeConfig.pagamentoCartaoSimplificadoAtivo]);

  const paidCents = useMemo(() => drafts.reduce((sum, draft) => sum + toCents(draft.valor), 0), [drafts]);
  // Troco (25/11/2026): so' o dinheiro pode passar do total; o que passa volta ao cliente.
  const conta = useMemo(() => contaDoTroco(totalCents, drafts.map((d) => ({ forma: d.forma, valorCentavos: toCents(d.valor) }))), [drafts, totalCents]);
  const remainingCents = totalCents - paidCents;
  const canFinalize = totalCents > 0 && conta.faltaCentavos === 0 && conta.excessoSemTrocoCentavos === 0 && !saving;
  const hojeDoCaixa = getDateInputInTimeZone();
  const finalizar = () => {
    const semTroco = pagamentosSemOTroco(
      drafts.map((draft) => ({ forma: draft.forma as string, valorCentavos: toCents(draft.valor), draft })),
      conta.trocoCentavos,
    ).map((p) => ({ ...p.draft, valor: fromCents(p.valorCentavos).toFixed(2) }));
    onFinalize(semTroco, observation, conta.trocoCentavos);
  };

  if (!open) return null;

  // Cashback: entra na lista so' com saldo que de' para usar neste cupom.
  const faixasDoCashback = cashbackDisponivel && cashbackDisponivel.modelo === 'pontos'
    ? faixasDisponiveis(cashbackDisponivel.faixas, cashbackDisponivel.saldoPontos, totalCents)
    : [];
  const ofereceCashback = cashbackDisponivel !== null
    && (cashbackDisponivel.modelo === 'reais' ? cashbackDisponivel.saldoCentavos > 0 : faixasDoCashback.length > 0);
  const formasBase: PaymentMethod[] = aPrazoAtivo ? [...paymentMethods, FORMA_A_PRAZO as PaymentMethod] : paymentMethods;
  const formas: PaymentMethod[] = ofereceCashback ? [...formasBase, 'Cashback'] : formasBase;

  const updateDraft = (id: string, changes: Partial<PaymentDraft>) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...changes };
      if (changes.forma === 'Cartão de Débito') {
        next.parcelas = '1';
      }
      // A prazo: o vencimento sai do prazo em dias (o padrao da filial).
      if (changes.forma && changes.forma !== draft.forma) next.dataVencimento = '';
      // Banco padrao da forma (25/11/2026): trocou a forma, vem o banco dela (se houver e estiver ativo).
      if (changes.forma && changes.forma !== draft.forma && configBancoPadrao && changes.bancoId === undefined) {
        const padraoId = bancoSugerido({
          forma: changes.forma,
          config: { ...configBancoPadrao, lembrarDoDia: false },
          doDia: null,
          hoje: hojeDoCaixa,
          bancosAtivosIds: bancosAtivos.map((b) => b.id),
        });
        const banco = padraoId ? bancosAtivos.find((b) => b.id === padraoId) : undefined;
        next.bancoId = banco ? banco.id : '';
        next.bancoNome = banco ? banco.nome : '';
      }
      // Cashback ja' entra com o saldo (ate' o que falta pagar) ou a maior faixa.
      if (changes.forma === 'Cashback' && draft.forma !== 'Cashback' && cashbackDisponivel) {
        const faltaPagar = Math.max(0, totalCents - (paidCents - toCents(draft.valor)));
        next.valor = fromCents(valorSugeridoDoCashback(cashbackDisponivel, totalCents, faltaPagar)).toFixed(2);
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
          <small className={conta.faltaCentavos > 0 ? 'warn' : conta.excessoSemTrocoCentavos > 0 ? 'danger' : 'ok'}>
            {conta.faltaCentavos > 0
              ? `Faltam ${currency.format(fromCents(conta.faltaCentavos))}`
              : conta.excessoSemTrocoCentavos > 0
                ? `Excedeu ${currency.format(fromCents(conta.excessoSemTrocoCentavos))} — só o dinheiro pode passar do total (vira troco)`
                : 'Pagamento completo'
            }
          </small>
          {conta.trocoCentavos > 0 && conta.excessoSemTrocoCentavos === 0 && (
            <strong className="pdv-payment-troco" aria-live="polite" style={{ display: 'block', marginTop: '6px', fontSize: '22px', color: '#059669' }}>
              Troco: {currency.format(fromCents(conta.trocoCentavos))}
            </strong>
          )}
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
                  {formas.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>Valor</span>
                <input
                  value={draft.valor}
                  inputMode="decimal"
                  readOnly={draft.forma === 'Cashback' && cashbackDisponivel?.modelo === 'pontos'}
                  autoFocus={index === 0}
                  onChange={(event) => updateDraft(draft.id, { valor: event.target.value })}
                />
              </label>

              {pedeBancoDeDestino(draft.forma, financeConfig.pagamentoCartaoSimplificadoAtivo) && (
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

              {draft.forma === 'Cashback' && cashbackDisponivel?.modelo === 'pontos' && (
                <label>
                  <span>Faixa de pontos</span>
                  <select
                    value={String(faixasDoCashback.find((f) => f.valorCentavos === toCents(draft.valor))?.faixa.pontos ?? '')}
                    onChange={(event) => {
                      const escolhida = faixasDoCashback.find((f) => String(f.faixa.pontos) === event.target.value);
                      updateDraft(draft.id, { valor: escolhida ? fromCents(escolhida.valorCentavos).toFixed(2) : '' });
                    }}
                    title={`Saldo do cliente: ${cashbackDisponivel.saldoPontos.toLocaleString('pt-BR')} ponto(s)`}
                  >
                    <option value="">Selecione...</option>
                    {faixasDoCashback.map((f) => (
                      <option key={f.faixa.pontos} value={f.faixa.pontos}>
                        {f.faixa.pontos} pontos = {f.faixa.descontoPercentual}% ({currency.format(fromCents(f.valorCentavos))})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {draft.forma === 'Cashback' && cashbackDisponivel?.modelo === 'reais' && (
                <div className="pdv-payment-placeholder" title="Saldo de cashback do cliente">
                  <span>Saldo {currency.format(fromCents(cashbackDisponivel.saldoCentavos))}</span>
                </div>
              )}

              {draft.forma === FORMA_A_PRAZO && (
                <>
                  <label>
                    <span>Prazo (dias)</span>
                    <input
                      value={draft.prazoDias}
                      inputMode="numeric"
                      aria-label="Prazo em dias do pagamento a prazo"
                      onChange={(event) => updateDraft(draft.id, { prazoDias: event.target.value.replace(/\D/g, ''), dataVencimento: '' })}
                    />
                  </label>
                  <label>
                    <span>Parcelas</span>
                    <input
                      value={draft.parcelasAPrazo || '1'}
                      inputMode="numeric"
                      aria-label="Quantidade de parcelas do pagamento a prazo"
                      onChange={(event) => updateDraft(draft.id, { parcelasAPrazo: event.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                  <div className="pdv-payment-placeholder" title="Vencimento da (primeira) parcela">
                    <span>
                      {Number.parseInt(draft.prazoDias, 10) > 0
                        ? `Vence ${formatDateInputPtBr(addDaysToDateInput(hojeDoCaixa, Number.parseInt(draft.prazoDias, 10)))}`
                        : 'Informe o prazo'}
                    </span>
                  </div>
                </>
              )}

              {draft.forma === 'Cheque' && (
                <div className="pdv-payment-placeholder">
                  <button type="button" className="btn-secondary" onClick={() => setChequeModalDraftId(draft.id)}>
                    {draft.chequeNumero
                      ? `Cheque nº ${draft.chequeNumero}`
                      : (financeConfig.pagamentoCartaoSimplificadoAtivo ? 'Dados do cheque (opcional)' : 'Preencher dados do cheque')}
                  </button>
                </div>
              )}

              {draft.forma !== 'Cheque' && draft.forma !== 'Cashback' && draft.forma !== FORMA_A_PRAZO && (draft.forma !== 'Cartão de Crédito' || financeConfig.pagamentoCartaoSimplificadoAtivo) && (
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

        <button type="button" className="btn-secondary pdv-add-payment" onClick={addPayment} disabled={conta.faltaCentavos <= 0}>
          <Plus size={17} />
          Adicionar forma
        </button>

        <label className="pdv-modal-field">
          <span>Observação</span>
          <textarea
            rows={3}
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            title="Observação interna da venda"
          />
        </label>

        <button
          type="button"
          className="btn-primary pdv-modal-submit"
          onClick={finalizar}
          disabled={!canFinalize}
        >
          <CreditCard size={20} />
          {saving ? 'Finalizando...' : rotuloFinalizar}
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
