import React from 'react';
import { DESCRICAO_DA_VERSAO_ATUAL, ROTULO_DA_VERSAO_ATUAL } from '../../utils/versaoDoSistema';

/**
 * Versao do sistema, pequena, no cabecalho de todas as telas (23/11/2026,
 * pedido do dono): "v 23/11 14:32" = quando o sistema desta aba foi publicado.
 * Passando o mouse aparece a data completa e o codigo da alteracao. Serve para
 * saber se a tela aberta ja' e' a da ultima atualizacao.
 *
 * Um componente so' para o sistema, a Frente de Caixa, o app Vendas e as telas
 * de login: a cor vem do lugar onde ele esta' (herda a do cabecalho), entao
 * funciona em fundo claro e escuro sem estilo proprio em cada tela.
 */
interface VersaoDoSistemaProps {
  style?: React.CSSProperties;
  className?: string;
}

const estiloBase: React.CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: 1,
  opacity: 0.65,
  color: 'inherit',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  cursor: 'default',
  userSelect: 'text',
};

const VersaoDoSistema: React.FC<VersaoDoSistemaProps> = ({ style, className }) => {
  if (!ROTULO_DA_VERSAO_ATUAL) return null;
  return (
    <span
      className={className ? `versao-do-sistema ${className}` : 'versao-do-sistema'}
      style={{ ...estiloBase, ...style }}
      title={DESCRICAO_DA_VERSAO_ATUAL}
      aria-label={DESCRICAO_DA_VERSAO_ATUAL}
    >
      {ROTULO_DA_VERSAO_ATUAL}
    </span>
  );
};

export default React.memo(VersaoDoSistema);
