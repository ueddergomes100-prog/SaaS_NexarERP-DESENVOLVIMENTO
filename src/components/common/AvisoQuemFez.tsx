import React from 'react';
import { History } from 'lucide-react';

/**
 * "Cancelado por MARIA em 09/11/2026 14:32" no topo do documento (09/11/2026).
 * Etiqueta de fundo solido de proposito: o topo das telas e' violeta (design
 * novo) e texto vermelho solto ali quase nao se le.
 */
const CORES = {
  perigo: '#dc2626',
  sucesso: '#059669',
  aviso: '#b45309',
} as const;

const AvisoQuemFez: React.FC<{ texto: string; tom?: keyof typeof CORES; titulo?: string }> = ({ texto, tom = 'perigo', titulo }) => {
  if (!texto) return null;
  return (
    <span
      role="status"
      title={titulo}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        marginTop: '6px',
        padding: '4px 12px',
        borderRadius: '999px',
        fontSize: '13px',
        fontWeight: 700,
        lineHeight: 1.4,
        color: '#ffffff',
        backgroundColor: CORES[tom],
        maxWidth: '100%',
      }}
    >
      <History size={14} style={{ flexShrink: 0 }} />
      <span>{texto}</span>
    </span>
  );
};

export default AvisoQuemFez;
