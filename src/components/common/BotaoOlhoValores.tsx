import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useValoresOcultos } from '../../hooks/useValoresOcultos';
import { tituloDoOlho } from '../../utils/valoresOcultosDomain';

/**
 * O "olhinho" (21/11/2026): esconde ou mostra os totais e resultados de todas
 * as telas de uma vez. Fica ao lado dos cartoes de resumo de cada tela.
 * Regra em valoresOcultosDomain.ts.
 */
const BotaoOlhoValores: React.FC<{
  className?: string;
  tamanho?: number;
  style?: React.CSSProperties;
}> = ({ className, tamanho = 18, style }) => {
  const { ocultos, alternar } = useValoresOcultos();
  const titulo = tituloDoOlho(ocultos);
  return (
    <button
      type="button"
      // icon-btn: no cabecalho roxo ganha o "vidro" dos outros botoes (visualDesktop.css).
      className={className ?? 'icon-btn botao-olho-valores'}
      onClick={alternar}
      title={titulo}
      aria-label={titulo}
      aria-pressed={ocultos}
      style={style}
    >
      {ocultos ? <EyeOff size={tamanho} /> : <Eye size={tamanho} />}
    </button>
  );
};

export default BotaoOlhoValores;
