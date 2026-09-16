import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import '../OS/OsPrint.css';
import './vendedorMobile.css';

interface Props {
  rotuloImprimir: string;
  carregando: boolean;
  erro?: string;
  children?: React.ReactNode;
}

/**
 * Casca das telas de impressao do app do vendedor. Mesma folha do desktop
 * (PedidoPrintDocument / OsPrintDocument), mas sem `usePrintAndClose`: aquele
 * hook fecha a aba do sistema de abas do desktop, que nao existe aqui.
 *
 * No celular, `window.print()` abre a folha nativa do Safari/Chrome, que ja
 * tem "Salvar em Arquivos"/"Salvar como PDF" -- nao precisa gerar PDF.
 *
 * Renderizada FORA da casca de altura fixa do VendedorShell (ver la): aquela
 * casca corta o conteudo em uma tela so', e a folha precisa rolar e
 * paginar.
 */
const VendedorImpressaoLayout: React.FC<Props> = ({ rotuloImprimir, carregando, erro, children }) => {
  const navigate = useNavigate();

  return (
    <div className="vendedor-impressao print-layout-wrapper">
      <div className="print-actions no-print" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} style={{ marginRight: 6 }} />
          Voltar
        </button>
        {!carregando && !erro && (
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            <Printer size={18} style={{ marginRight: 6 }} />
            {rotuloImprimir}
          </button>
        )}
      </div>

      {carregando ? (
        <div className="no-print" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Carregando dados para impressão...</div>
      ) : erro ? (
        <div className="no-print" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>{erro}</div>
      ) : (
        children
      )}
    </div>
  );
};

export default VendedorImpressaoLayout;
