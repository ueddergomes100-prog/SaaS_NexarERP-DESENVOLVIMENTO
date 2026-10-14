import React from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  titulo: string;
  /** Linha menor embaixo do titulo (ex.: "Pre-venda #0154 · Boa Safra"). */
  subtitulo?: string;
  aoVoltar?: () => void;
  acao?: React.ReactNode;
}

/** Cabecalho das telas internas do app: degrade violeta (vendedorVisual.css, .app-topo). */
const VendedorHeader: React.FC<Props> = ({ titulo, subtitulo, aoVoltar, acao }) => {
  const navigate = useNavigate();
  return (
    <div className="app-topo">
      <button
        type="button"
        className="app-topo__voltar"
        onClick={aoVoltar || (() => navigate(-1))}
        aria-label="Voltar"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="app-topo__textos">
        <div className="app-topo__titulo">{titulo}</div>
        {subtitulo && <div className="app-topo__sub">{subtitulo}</div>}
      </div>
      {acao && <div className="app-topo__acao">{acao}</div>}
    </div>
  );
};

export default VendedorHeader;
