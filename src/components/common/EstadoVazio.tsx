import React from 'react';
import { Inbox } from 'lucide-react';
import Animacao from './Animacao';

interface EstadoVazioProps {
  titulo: string;
  /** Uma frase dizendo o que fazer para a lista deixar de estar vazia. */
  texto?: string;
  acao?: { rotulo: string; onClick: () => void; icone?: React.ReactNode };
  /** Versao menor, para dentro de tabela/cartao. */
  compacto?: boolean;
}

/**
 * "Nada aqui" padrao do sistema (2026-10-06): caixa animada + titulo + o que
 * fazer. Substitui o texto solto "Nenhum registro" das listas. A animacao e'
 * discreta e em laco; quem prefere menos movimento ve o icone de caixa.
 */
const EstadoVazio: React.FC<EstadoVazioProps> = ({ titulo, texto, acao, compacto = false }) => (
  <div
    role="status"
    style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
      gap: compacto ? '6px' : '10px', padding: compacto ? '20px 16px' : '36px 16px', color: 'var(--text-muted)',
    }}
  >
    <Animacao
      animacao="vazio"
      loop
      tamanho={compacto ? 88 : 140}
      style={{ marginBottom: compacto ? 0 : '4px' }}
      fallback={<Inbox size={compacto ? 32 : 48} style={{ opacity: 0.5 }} />}
    />
    <div style={{ fontSize: compacto ? '14px' : '16px', fontWeight: 600, color: 'var(--text-primary)' }}>{titulo}</div>
    {texto && <div style={{ fontSize: compacto ? '12px' : '13px', maxWidth: '460px' }}>{texto}</div>}
    {acao && (
      <button type="button" className="btn-secondary" onClick={acao.onClick} style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        {acao.icone}{acao.rotulo}
      </button>
    )}
  </div>
);

export default EstadoVazio;
