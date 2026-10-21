import React from 'react';
import { ClipboardList } from 'lucide-react';
import ContagemBalanco from '../../components/balanco/ContagemBalanco';

/** Contar balanco no computador (21/10/2026): a mesma tela do app. */
const BalancoContar: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <div>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ClipboardList size={28} color="var(--accent-purple)" /> Contar balanço
      </h1>
      <p style={{ color: 'var(--text-muted)' }}>Conte só os itens da sua lista. Bipe o código de barras ou digite o nome.</p>
    </div>
    <ContagemBalanco />
  </div>
);

export default BalancoContar;
