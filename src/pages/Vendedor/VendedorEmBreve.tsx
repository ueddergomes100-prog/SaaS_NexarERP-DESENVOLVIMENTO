import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass } from 'lucide-react';
import VendedorHeader from './VendedorHeader';

interface Props {
  titulo: string;
  descricao: string;
  Icon?: LucideIcon;
}

/**
 * Tela generica de "modulo em breve" -- reaproveitada por qualquer card da
 * Home que ja tem lugar reservado mas ainda nao foi construido (comeca com
 * Balanco/contagem de estoque). So' recebe titulo/descricao por prop pra
 * nao precisar de um arquivo novo a cada modulo que nascer como esqueleto.
 */
const VendedorEmBreve: React.FC<Props> = ({ titulo, descricao, Icon = Hourglass }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      <VendedorHeader titulo={titulo} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '32px', textAlign: 'center' }}>
        <div
          style={{
            width: '64px', height: '64px', borderRadius: '18px', backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon size={28} color="var(--brand-400)" />
        </div>
        <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Em breve</div>
        <p style={{ fontSize: '14.5px', color: 'var(--text-muted)', maxWidth: '300px', lineHeight: 1.5, margin: 0 }}>
          {descricao}
        </p>
      </div>
    </div>
  );
};

export default VendedorEmBreve;
