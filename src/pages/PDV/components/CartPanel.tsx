import React from 'react';
import { Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import type { PdvCartItem } from '../types';
import { embalagemFracionaria, toBaseQuantity, type OpcaoUnidadeVenda } from '../../../utils/embalagemDomain';
import { cartLineGrossCents, cartLineNetCents, currency, fromCurrencyInput, toCurrencyInput } from '../pdvHelpers';
import { fromCents } from '../../../utils/financeDomain';
import CampoQuantidade from '../../../components/common/CampoQuantidade';

interface CartPanelProps {
  items: PdvCartItem[];
  selectedItemId: string;
  onSelectItem: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
  onDiscountChange: (id: string, discountCents: number) => void;
  onRemoveItem: (id: string) => void;
  /** Opcoes de unidade de cada linha, indexadas pelo id da linha. So vem
   * preenchido quando a chave venderPorEmbalagem esta ligada. */
  unitOptionsByItemId?: Record<string, OpcaoUnidadeVenda[]>;
  /** Linhas de produto que so' vende na embalagem: o seletor nao oferece a unidade solta (24/11/2026). */
  semUnidadeSoltaByItemId?: Record<string, boolean>;
  onUnitChange?: (id: string, embalagemId: string) => void;
  /**
   * Pre-venda puxada para o caixa (23/11/2026): os itens sao os da pre-venda e
   * nao mudam aqui -- quantidade e desconto viram texto e a lixeira some.
   */
  somenteLeitura?: boolean;
}

const CartPanel: React.FC<CartPanelProps> = ({
  items,
  selectedItemId,
  onSelectItem,
  onQuantityChange,
  onDiscountChange,
  onRemoveItem,
  unitOptionsByItemId,
  semUnidadeSoltaByItemId,
  onUnitChange,
  somenteLeitura = false,
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
        // Produto com uma unidade so nao ganha seletor -- seria um select
        // de uma opcao, ocupando espaco no cupom sem servir pra nada.
        const unitOptions = unitOptionsByItemId?.[item.id];
        // A primeira opcao e' sempre a unidade do estoque; produto que so' vende embalado nao a oferece.
        const opcoesDoSeletor = semUnidadeSoltaByItemId?.[item.id] ? (unitOptions ?? []).slice(1) : (unitOptions ?? []);
        const showUnitSelect = !somenteLeitura && Boolean(onUnitChange) && opcoesDoSeletor.length > 1;
        // Meio metro, lata: a venda sai na unidade do estoque -- mostra quanto da' (21/11/2026).
        const naUnidadeDoEstoque = embalagemFracionaria(item) && unitOptions?.[0]
          ? `= ${toBaseQuantity(item.quantidade, item.fatorConversao).toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${unitOptions[0].sigla} na venda`
          : '';

        return (
          <div
            key={item.id}
            className={selected ? 'pdv-cart-row selected' : 'pdv-cart-row'}
            onClick={() => onSelectItem(item.id)}
          >
            <div className="pdv-cart-product">
              <small>{String(index + 1).padStart(3, '0')}</small>
              {/* Foto do item no cupom (pedido do dono, 20/10/2026). */}
              <span className="pdv-cart-foto" aria-hidden="true">
                {item.imagemProduto ? <img src={item.imagemProduto} alt="" loading="lazy" /> : <Package size={18} />}
              </span>
              <div>
                <strong>{item.nome}</strong>
                {showUnitSelect ? (
                  <span className="pdv-cart-unit">
                    {currency.format(fromCents(item.precoUnitarioCentavos))} ·{' '}
                    <select
                      value={item.embalagemId || ''}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onUnitChange?.(item.id, event.target.value)}
                      aria-label={`Unidade de venda de ${item.nome}`}
                    >
                      {opcoesDoSeletor.map((opcao) => (
                        <option key={opcao.embalagemId || 'base'} value={opcao.embalagemId}>{opcao.label}</option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <span>{currency.format(fromCents(item.precoUnitarioCentavos))} · {item.unidadeMedidaSigla || 'UN'}</span>
                )}
                {naUnidadeDoEstoque && <span className="pdv-cart-na-base">{naUnidadeDoEstoque}</span>}
              </div>
            </div>

            {somenteLeitura ? (
              <span className="pdv-cart-fixo pdv-cart-fixo--qtd" title="Quantidade da pré-venda">
                {item.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
              </span>
            ) : (
              <div className="pdv-quantity-control">
                <button type="button" onClick={(event) => { event.stopPropagation(); onQuantityChange(item.id, item.quantidade - 1); }}>
                  <Minus size={14} />
                </button>
                <CampoQuantidade
                  valor={item.quantidade}
                  aria-label={`Quantidade de ${item.nome}`}
                  onClick={(event) => event.stopPropagation()}
                  onQuantidade={(quantidade) => onQuantityChange(item.id, quantidade)}
                />
                <button type="button" onClick={(event) => { event.stopPropagation(); onQuantityChange(item.id, item.quantidade + 1); }}>
                  <Plus size={14} />
                </button>
              </div>
            )}

            {somenteLeitura ? (
              <span className="pdv-cart-fixo" title="Desconto do item na pré-venda">
                {item.descontoCentavos > 0 ? `- ${currency.format(fromCents(item.descontoCentavos))}` : '—'}
              </span>
            ) : (
              <input
                className="pdv-money-input"
                value={toCurrencyInput(item.descontoCentavos)}
                inputMode="decimal"
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onDiscountChange(item.id, Math.min(fromCurrencyInput(event.target.value), lineGrossCents))}
                aria-label={`Desconto do item ${item.nome}`}
              />
            )}

            <strong className="pdv-line-total">{currency.format(fromCents(lineNetCents))}</strong>

            {somenteLeitura ? <span /> : (
              <button
                type="button"
                className="pdv-row-action"
                title="Cancelar item"
                onClick={(event) => { event.stopPropagation(); onRemoveItem(item.id); }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  </section>
);

export default React.memo(CartPanel);
