import React from 'react';
import { Filter } from 'lucide-react';

/**
 * PAINEL DE FILTROS DAS LISTAS (2026-09-19).
 *
 * Existiam varios botoes "Filtros" que nao faziam nada. Este par (botao +
 * painel) e' o que eles passam a usar: o botao abre/fecha o painel e mostra
 * quantos filtros estao ligados; o painel traz os campos de cada tela e o
 * "Limpar filtros". Cada tela decide QUAIS campos (situacao, periodo...) --
 * a regra de filtrar fica em src/utils/filtroListaDomain.ts.
 */

interface BotaoFiltrosProps {
  aberto: boolean;
  onToggle: () => void;
  /** Quantos filtros fogem do padrao -- vira o numerinho no botao. */
  quantidadeAtiva: number;
}

export const BotaoFiltros: React.FC<BotaoFiltrosProps> = ({ aberto, onToggle, quantidadeAtiva }) => (
  <button
    type="button"
    className="btn-secondary filter-btn"
    onClick={onToggle}
    aria-expanded={aberto}
    title={aberto ? 'Esconder os filtros' : 'Mostrar os filtros'}
    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
  >
    <Filter size={18} />
    Filtros
    {quantidadeAtiva > 0 && (
      <span
        style={{
          minWidth: '20px', height: '20px', padding: '0 6px', borderRadius: '10px',
          background: 'var(--accent-purple, #8b5cf6)', color: '#fff', fontSize: '12px', fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {quantidadeAtiva}
      </span>
    )}
  </button>
);

interface PainelFiltrosProps {
  aberto: boolean;
  quantidadeAtiva: number;
  onLimpar: () => void;
  children: React.ReactNode;
}

export const PainelFiltros: React.FC<PainelFiltrosProps> = ({ aberto, quantidadeAtiva, onLimpar, children }) => {
  if (!aberto) return null;
  return (
    <div
      role="group"
      aria-label="Filtros da lista"
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end',
        padding: '14px 16px', margin: '0 0 16px',
        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
      }}
    >
      {children}
      <button
        type="button"
        className="btn-secondary"
        onClick={onLimpar}
        disabled={quantidadeAtiva === 0}
        title="Volta todos os filtros ao padrão"
      >
        Limpar filtros
      </button>
    </div>
  );
};

interface CampoFiltroProps {
  rotulo: string;
  children: React.ReactNode;
}

export const CampoFiltro: React.FC<CampoFiltroProps> = ({ rotulo, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
    {rotulo}
    {children}
  </label>
);

export const estiloCampoFiltro: React.CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  font: 'inherit',
  fontSize: '14px',
  minWidth: '150px',
};

interface CampoPeriodoProps {
  rotulo?: string;
  de: string;
  ate: string;
  onChangeDe: (valor: string) => void;
  onChangeAte: (valor: string) => void;
}

/** Dois campos de data (de / até). Vazio = sem limite. */
export const CampoPeriodo: React.FC<CampoPeriodoProps> = ({ rotulo = 'Período', de, ate, onChangeDe, onChangeAte }) => (
  <>
    <CampoFiltro rotulo={`${rotulo} — de`}>
      <input type="date" value={de} max={ate || undefined} onChange={(e) => onChangeDe(e.target.value)} style={estiloCampoFiltro} />
    </CampoFiltro>
    <CampoFiltro rotulo="até">
      <input type="date" value={ate} min={de || undefined} onChange={(e) => onChangeAte(e.target.value)} style={estiloCampoFiltro} />
    </CampoFiltro>
  </>
);
