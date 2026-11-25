import React, { useEffect, useState } from 'react';
import { lerQuantidadeDigitada } from '../../utils/saleQuantity';

/**
 * Campo de quantidade que deixa apagar e digitar (25/11/2026, videos da
 * Jomarly). O texto fica no campo enquanto a pessoa digita; o item so' muda
 * quando o numero esta' completo e acima de zero (`lerQuantidadeDigitada`).
 * Ao sair do campo com ele vazio ou zerado, volta a quantidade do item.
 *
 * Quem usa continua validando a unidade (inteiro/casas) em `onQuantidade`,
 * com a mesma mensagem de sempre; se recusar, o campo volta ao valor do item
 * ao sair dele.
 */
interface CampoQuantidadeProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  valor: number;
  onQuantidade: (quantidade: number) => void;
}

const textoDaQuantidade = (valor: number): string => (
  Number.isFinite(valor) ? String(valor).replace('.', ',') : ''
);

const CampoQuantidade: React.FC<CampoQuantidadeProps> = ({ valor, onQuantidade, onBlur, onFocus, ...resto }) => {
  const [texto, setTexto] = useState(() => textoDaQuantidade(valor));
  const [editando, setEditando] = useState(false);

  // Fora da digitacao o campo mostra sempre a quantidade do item (botoes +/-,
  // troca de unidade, recusa da tela).
  useEffect(() => {
    if (!editando) setTexto(textoDaQuantidade(valor));
  }, [valor, editando]);

  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={texto}
      onFocus={(event) => {
        setEditando(true);
        event.target.select();
        onFocus?.(event);
      }}
      onChange={(event) => {
        setTexto(event.target.value);
        const quantidade = lerQuantidadeDigitada(event.target.value);
        if (quantidade !== null && quantidade !== valor) onQuantidade(quantidade);
      }}
      onBlur={(event) => {
        setEditando(false);
        setTexto(textoDaQuantidade(valor));
        onBlur?.(event);
      }}
    />
  );
};

export default CampoQuantidade;
