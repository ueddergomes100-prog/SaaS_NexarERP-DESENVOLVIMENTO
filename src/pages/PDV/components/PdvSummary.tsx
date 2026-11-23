import React from 'react';
import { BadgeCheck, CreditCard, Eraser, ReceiptText, Undo2, UserRound } from 'lucide-react';
import type { PdvClient, PdvSession, PdvTotals } from '../types';
import { currency } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';

/**
 * Coluna do total da Frente de Caixa (visual "Lavanda", escolhido pelo dono em
 * 20/10/2026). Status do caixa, Sangria e Fechar caixa ficam no topo (PDV.tsx).
 */
interface PdvSummaryProps {
  totals: PdvTotals;
  client: PdvClient | null;
  session: PdvSession | null;
  disabled?: boolean;
  /** Aviso de desconto acima do limite configurado (nivel 2). */
  discountWarning?: string;
  /** Saldo de cashback que o cliente pode usar neste cupom ("R$ 12,35" ou "244 ponto(s)"). */
  cashbackTexto?: string | null;
  /**
   * Pre-venda puxada para o caixa (23/11/2026): cliente, desconto e vendedor
   * sao os da pre-venda e nao mudam aqui. O vendedor fica a' vista porque a
   * comissao e' dele.
   */
  preVenda?: { numeroPedido: string; clienteNome: string; vendedorNome: string } | null;
  /** Mostra o atalho F8 (so' para quem pode faturar pre-venda no caixa). */
  atalhoPreVendas?: boolean;
  onOpenClient: () => void;
  onOpenDiscount: () => void;
  onOpenPayment: () => void;
  onClearSale: () => void;
}

const PdvSummary: React.FC<PdvSummaryProps> = ({
  totals,
  client,
  session,
  disabled,
  discountWarning,
  cashbackTexto,
  preVenda = null,
  atalhoPreVendas = false,
  onOpenClient,
  onOpenDiscount,
  onOpenPayment,
  onClearSale,
}) => (
  <aside className="pdv-summary">
    {preVenda ? (
      <>
        <div className="pdv-client-card pdv-client-card--fixo" title="Cliente da pré-venda. Para trocar, edite a pré-venda no sistema.">
          <span className="pdv-card-head">
            <span className="pdv-card-label"><UserRound size={15} aria-hidden="true" /> Cliente da pré-venda</span>
          </span>
          <strong>{preVenda.clienteNome}</strong>
          {cashbackTexto && <span className="pdv-chip-ok">Cashback disponível {cashbackTexto}</span>}
        </div>
        <div className="pdv-client-card pdv-client-card--fixo" title="Vendedor que gravou a pré-venda. A venda e a comissão continuam sendo dele.">
          <span className="pdv-card-head">
            <span className="pdv-card-label"><BadgeCheck size={15} aria-hidden="true" /> Vendedor da pré-venda</span>
          </span>
          <strong>{preVenda.vendedorNome}</strong>
        </div>
      </>
    ) : (
      <button type="button" className="pdv-client-card" onClick={onOpenClient} title="Escolher ou trocar o cliente (F2)">
        <span className="pdv-card-head">
          <span className="pdv-card-label"><UserRound size={15} aria-hidden="true" /> Cliente (F2)</span>
          <span className="pdv-card-link">Trocar</span>
        </span>
        <strong>{client?.nome || 'CONSUMIDOR FINAL'}</strong>
        {cashbackTexto && <span className="pdv-chip-ok">Cashback disponível {cashbackTexto}</span>}
      </button>
    )}

    <div className="pdv-total-card">
      <div className="pdv-total-line"><span>Subtotal</span><strong>{currency.format(fromCents(totals.subtotalCentavos))}</strong></div>
      <div className="pdv-total-line"><span>Descontos</span><strong className="discount">- {currency.format(fromCents(totals.descontoTotalCentavos))}</strong></div>
      {(totals.acrescimosCentavos ?? 0) > 0 && (
        <div className="pdv-total-line"><span>Frete e encargos</span><strong>+ {currency.format(fromCents(totals.acrescimosCentavos ?? 0))}</strong></div>
      )}
      <div className="pdv-total-line"><span>Itens</span><strong>{totals.itemCount} itens · {totals.volumeCount.toLocaleString('pt-BR')} un.</strong></div>
      <div className="pdv-grand-total">
        <small>Total</small>
        <b>{currency.format(fromCents(totals.totalCentavos))}</b>
      </div>
    </div>

    {discountWarning && <div className="pdv-warning">{discountWarning}</div>}

    <div className="pdv-actions">
      <button
        type="button"
        className="pdv-action"
        onClick={onOpenDiscount}
        disabled={disabled || Boolean(preVenda)}
        title={preVenda ? 'O desconto é o da pré-venda. Para mudar, edite a pré-venda no sistema.' : undefined}
      >
        <ReceiptText size={18} aria-hidden="true" />
        Desconto (F4)
      </button>
      {preVenda ? (
        <button
          type="button"
          className="pdv-action"
          onClick={onClearSale}
          title={`Tira a pré-venda #${preVenda.numeroPedido} do caixa. Ela continua em aberto, do jeito que estava.`}
        >
          <Undo2 size={18} aria-hidden="true" />
          Soltar pré-venda
        </button>
      ) : (
        <button type="button" className="pdv-action pdv-action--danger" onClick={onClearSale} disabled={disabled}>
          <Eraser size={18} aria-hidden="true" />
          Limpar venda
        </button>
      )}
    </div>
    <button type="button" className="pdv-pay-button" onClick={onOpenPayment} disabled={disabled || !session || totals.totalCentavos <= 0}>
      <CreditCard size={22} aria-hidden="true" />
      Pagamento (F6)
    </button>

    <div className="pdv-shortcuts">
      <span><kbd>F2</kbd> Cliente</span>
      <span><kbd>F3</kbd> Produto</span>
      <span><kbd>F4</kbd> Desconto</span>
      <span><kbd>F5</kbd> Quantidade</span>
      <span><kbd>F6</kbd> Pagamento</span>
      <span><kbd>F7</kbd> Finalizar</span>
      {atalhoPreVendas && <span><kbd>F8</kbd> Pré-vendas</span>}
      <span><kbd>Esc</kbd> Fechar janela</span>
      <span><kbd>Enter</kbd> Confirmar</span>
    </div>
  </aside>
);

export default React.memo(PdvSummary);
