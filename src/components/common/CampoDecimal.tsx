import React, { useEffect, useState } from 'react';
import { valorDigitado } from '../../utils/transporteNotaDomain';

/**
 * Campo de numero com virgula (27/10/2026): o frete da venda era
 * `type="number"` + Math.trunc e so' aceitava inteiro. Aqui o texto digitado
 * fica como a pessoa escreveu ("180," "180,5") e o numero sai pelo `onValor`
 * (2 casas). Se o valor mudar por fora (pedido aberto, orcamento importado),
 * o texto acompanha.
 */
interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  valor: number;
  onValor: (n: number) => void;
  /** Casas mostradas ao sair do campo: 2 para dinheiro (138,50); 0 = so' as que tem. */
  casasMinimas?: number;
}

const CampoDecimal: React.FC<Props> = ({ valor, onValor, casasMinimas = 0, ...resto }) => {
  const formatar = (n: number) => (n > 0 ? n.toLocaleString('pt-BR', { minimumFractionDigits: casasMinimas, maximumFractionDigits: 2 }) : '');
  const [texto, setTexto] = useState(() => formatar(valor));
  useEffect(() => {
    // So' reescreve quando o numero de fora e' outro (nao a cada tecla).
    if (Math.abs(valorDigitado(texto) - (valor || 0)) > 0.0001) setTexto(formatar(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);
  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      value={texto}
      onChange={(e) => {
        const limpo = e.target.value.replace(/[^\d.,]/g, '');
        setTexto(limpo);
        onValor(valorDigitado(limpo));
      }}
      onBlur={(e) => { setTexto(formatar(valorDigitado(texto))); resto.onBlur?.(e); }}
    />
  );
};

export default CampoDecimal;
