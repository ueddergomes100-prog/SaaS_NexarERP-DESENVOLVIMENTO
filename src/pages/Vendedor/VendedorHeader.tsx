import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  titulo: string;
  aoVoltar?: () => void;
  acao?: React.ReactNode;
}

const VendedorHeader: React.FC<Props> = ({ titulo, aoVoltar, acao }) => {
  const navigate = useNavigate();
  return (
    <div
      style={{
        padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '14px',
        borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', flexShrink: 0,
      }}
    >
      <button
        type="button"
        onClick={aoVoltar || (() => navigate(-1))}
        aria-label="Voltar"
        style={{
          width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <ChevronLeft size={19} />
      </button>
      <div style={{ flex: 1, fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>{titulo}</div>
      {acao}
    </div>
  );
};

export default VendedorHeader;
