import React from 'react';
import { Save, Send } from 'lucide-react';

/*
 * Rodape das telas que montam rascunho no app Vendas (pedido, orcamento,
 * troca). Desde 13/10/2026 sao duas saidas:
 *  - "Pronto para enviar": o cliente fechou; o app manda sozinho para a loja
 *    quando tiver sinal (EnvioAutomaticoDeRascunhos);
 *  - "Salvar rascunho": ainda pode mudar; fica no celular ate' o vendedor
 *    marcar pronto ou tocar "Enviar dados".
 */

interface Props {
  aoSalvar: (pronto: boolean) => void;
  ocupado?: boolean;
  rotuloOcupado?: string;
}

const VendedorRodapeRascunho: React.FC<Props> = ({ aoSalvar, ocupado = false, rotuloOcupado = 'Salvando...' }) => (
  <div style={{ padding: '14px 20px calc(20px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <button
      type="button"
      onClick={() => aoSalvar(true)}
      disabled={ocupado}
      style={{
        width: '100%', height: '52px', borderRadius: '14px', border: 'none', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: '#fff', cursor: ocupado ? 'default' : 'pointer',
        opacity: ocupado ? 0.7 : 1, background: 'linear-gradient(135deg, var(--brand-500) 0%, var(--brand-700) 100%)',
      }}
    >
      <Send size={18} />
      {ocupado ? rotuloOcupado : 'Pronto para enviar'}
    </button>
    <button
      type="button"
      onClick={() => aoSalvar(false)}
      disabled={ocupado}
      style={{
        width: '100%', height: '46px', borderRadius: 'var(--app-raio-linha)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '8px', fontSize: '15px', fontWeight: 600, cursor: ocupado ? 'default' : 'pointer', opacity: ocupado ? 0.7 : 1,
        border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-elevated)', boxShadow: 'var(--app-sombra)', color: 'var(--text-primary)',
      }}
    >
      <Save size={17} />
      Salvar rascunho
    </button>
  </div>
);

/** Campos do rascunho conforme a saida escolhida (nunca grava `undefined`). */
export const camposDePronto = (pronto: boolean, agora: string): { pronto?: true; prontoEm?: string } => (
  pronto ? { pronto: true, prontoEm: agora } : {}
);

export const mensagemDeRascunhoSalvo = (pronto: boolean, documento: string): string => {
  if (!pronto) return `Rascunho salvo! Quando o ${documento} estiver fechado, toque em "Pronto" no rascunho ou em "Enviar dados".`;
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? `Pronto para enviar. Sem sinal agora: o ${documento} vai sozinho para a loja quando a internet voltar.`
    : `Pronto para enviar. O ${documento} vai para a loja em instantes.`;
};

export default VendedorRodapeRascunho;
