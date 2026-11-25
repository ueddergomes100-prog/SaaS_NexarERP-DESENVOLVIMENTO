import React, { useState } from 'react';
import { lerNumeroDigitado } from '../../../utils/notaManualItensDomain';
import type { TipoCustoExtra } from '../../../utils/custoExtraEntradaDomain';
import { moeda } from './estilos';

/*
 * FAIXA "CUSTO EXTRA PARA TODOS OS ITENS" (25/11/2026, Embala Minas).
 *
 * Custo que nao veio no XML (carreto pago a parte, descarga, taxa) entra no
 * custo dos produtos sem mexer no total da nota nem no financeiro. Em %: o
 * mesmo percentual em cada item. Em R$: o valor e' rateado pelo custo de cada
 * item. Depois de aplicar, cada item pode ser ajustado no proprio cartao.
 * Regra em src/utils/custoExtraEntradaDomain.ts.
 */

interface Props {
  /** Soma do custo extra ja' aplicado nos itens. */
  total: number;
  /** Devolve true quando aplicou (o campo limpa). */
  onAplicar: (tipo: TipoCustoExtra, valor: number) => boolean;
  onTirar: () => void;
}

const CustoExtraParaTodos: React.FC<Props> = ({ total, onAplicar, onTirar }) => {
  const [tipo, setTipo] = useState<TipoCustoExtra>('valor');
  const [texto, setTexto] = useState('');
  const aplicar = () => {
    if (onAplicar(tipo, lerNumeroDigitado(texto))) setTexto('');
  };
  return (
    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', backgroundColor: 'var(--bg-tertiary)' }}>
      <label htmlFor="custo-extra-todos" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)' }}>Custo extra para todos os itens</label>
      <select
        aria-label="Custo extra em reais ou em percentual"
        value={tipo}
        onChange={(e) => setTipo(e.target.value as TipoCustoExtra)}
        className="form-select"
        style={{ padding: '6px 10px', fontSize: '13px', width: 'auto' }}
      >
        <option value="valor">R$ (rateado)</option>
        <option value="percentual">%</option>
      </select>
      <input
        id="custo-extra-todos"
        type="text"
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } }}
        title={tipo === 'valor' ? 'Valor total, em reais, rateado pelo custo de cada item' : 'Percentual sobre o custo de cada item'}
        style={{ padding: '6px 10px', fontSize: '13px', width: '110px', textAlign: 'right', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
      />
      <button type="button" className="btn-primary" style={{ fontSize: '12.5px', padding: '6px 12px' }} onClick={aplicar}>
        Aplicar em todos
      </button>
      {total > 0 && (
        <button type="button" className="btn-secondary" style={{ fontSize: '12.5px', padding: '6px 12px' }} onClick={onTirar}>
          Tirar de todos
        </button>
      )}
      <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
        {total > 0
          ? `${moeda(total)} somados ao custo dos produtos. Não muda o total da nota nem as parcelas; dá para ajustar item a item.`
          : 'Frete pago à parte, descarga, taxa: entra só no custo dos produtos, não no total da nota.'}
      </span>
    </div>
  );
};

export default CustoExtraParaTodos;
