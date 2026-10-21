import React from 'react';
import { Truck, X } from 'lucide-react';
import type { RotaAberta } from '../../utils/rotaPreVendaDomain';

/**
 * "Rota 1 ou Rota 2?" -- aparece ao gravar/enviar a pre-venda quando ha' mais
 * de uma rota em montagem (rotaPreVendaDomain.ts). Serve no computador e no
 * app (so' usa as variaveis de cor, que o app redefine).
 */
interface Props {
  rotas: RotaAberta[];
  /** Pre-venda ja' entra na rota (true) ou so' quando faturar (false): muda o texto. */
  entraAgora: boolean;
  onEscolher: (rota: RotaAberta) => void;
  onSemRota: () => void;
  onCancelar: () => void;
}

const EscolherRotaModal: React.FC<Props> = ({ rotas, entraAgora, onEscolher, onSemRota, onCancelar }) => (
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Escolher a rota de entrega"
    onClick={onCancelar}
    style={{ position: 'fixed', inset: 0, zIndex: 2600, backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '16px' }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ width: '100%', maxWidth: '440px', borderRadius: '18px', padding: '18px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-color)', boxShadow: '0 18px 50px rgba(0,0,0,0.35)', marginBottom: 'max(8vh, 16px)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
        <strong style={{ fontSize: '17px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}><Truck size={20} /> Em qual rota este pedido sai?</strong>
        <button type="button" onClick={onCancelar} aria-label="Voltar" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
      </div>
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-muted)' }}>
        {entraAgora
          ? 'A pré-venda já entra na rota escolhida; o motorista só sai depois que ela for faturada.'
          : 'A rota fica anotada e o pedido entra nela quando for faturado.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rotas.map((rota) => (
          <button
            key={rota.id}
            type="button"
            onClick={() => onEscolher(rota)}
            style={{ width: '100%', minHeight: '52px', borderRadius: '14px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', fontSize: '15px', fontWeight: 700, textAlign: 'left' }}
          >
            <span>{rota.titulo}</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              {rota.quantidadePedidos === 1 ? '1 pedido' : `${rota.quantidadePedidos} pedidos`}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSemRota}
        style={{ marginTop: '12px', width: '100%', height: '44px', borderRadius: '12px', border: 'none', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
      >
        Deixar sem rota (a loja escolhe depois)
      </button>
    </div>
  </div>
);

export default EscolherRotaModal;
