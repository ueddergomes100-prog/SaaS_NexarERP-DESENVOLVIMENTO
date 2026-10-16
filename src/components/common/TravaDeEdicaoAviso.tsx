import React, { useState } from 'react';
import { Loader2, Lock, RotateCw, Unlock } from 'lucide-react';
import { NexusSwal, showError } from '../../utils/alerts';
import { descreverTrava, type TravaDeEdicao } from '../../utils/travaEdicaoDomain';

/** Linha da lista: "Em edição por MARIA no celular desde 14:32" com o cadeado. */
export const MarcaEmEdicao: React.FC<{ trava?: TravaDeEdicao | null }> = ({ trava }) => (trava ? (
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '220px' }}>
    <Lock size={12} style={{ flex: 'none' }} /> {descreverTrava(trava)}
  </div>
) : null);

/**
 * No lugar da tela, quando outra pessoa esta editando o documento (trava de
 * edicao, 15/10/2026). Dono/gerente podem liberar e abrir na hora.
 */
interface TravaDeEdicaoAvisoProps {
  mensagem?: string;
  onVoltar: () => void;
  onTentarDeNovo: () => void;
  /** So' para dono, administrador ou gerente. */
  onLiberar?: () => Promise<void>;
  /** "a conferência", "o pedido". */
  rotulo: string;
}

const TravaDeEdicaoAviso: React.FC<TravaDeEdicaoAvisoProps> = ({ mensagem, onVoltar, onTentarDeNovo, onLiberar, rotulo }) => {
  const [liberando, setLiberando] = useState(false);

  const liberar = async () => {
    if (!onLiberar) return;
    const confirmacao = await NexusSwal.fire({
      title: `Liberar ${rotulo}?`,
      html: 'A outra pessoa perde a vez na hora e não consegue mais salvar por lá. O que ela já gravou continua salvo.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Liberar e abrir aqui',
      cancelButtonText: 'Cancelar',
    });
    if (!confirmacao.isConfirmed) return;
    setLiberando(true);
    try {
      await onLiberar();
    } catch (erro) {
      showError('Não foi possível liberar', erro instanceof Error ? erro.message : undefined);
    } finally {
      setLiberando(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 16px' }}>
      <div className="card" style={{ maxWidth: '520px', width: '100%', padding: '28px 24px', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', textAlign: 'center' }}>
        <span style={{ width: '56px', height: '56px', borderRadius: '18px', backgroundColor: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lock size={26} />
        </span>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Em edição por outra pessoa</h2>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{mensagem || 'Espere a outra pessoa terminar para abrir.'}</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '6px' }}>
          <button type="button" className="btn-secondary" onClick={onVoltar}>Voltar</button>
          <button type="button" className="btn-secondary" onClick={onTentarDeNovo} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <RotateCw size={16} /> Tentar de novo
          </button>
          {onLiberar && (
            <button type="button" className="btn-primary" onClick={() => { void liberar(); }} disabled={liberando} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              {liberando ? <Loader2 size={16} className="spin-icon" /> : <Unlock size={16} />} Liberar e abrir
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TravaDeEdicaoAviso;
