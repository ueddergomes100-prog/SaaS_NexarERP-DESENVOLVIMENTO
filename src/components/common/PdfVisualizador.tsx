import React, { useEffect, useMemo, useRef } from 'react';
import { FileDown, Printer, X } from 'lucide-react';

/*
 * Mostra um PDF DENTRO do sistema, com Imprimir e Salvar (decisao do dono,
 * 2026-09-23: nada de pular direto para o leitor de PDF do computador).
 * Serve a qualquer documento que ja' venha como Blob; o relatorio tem o
 * visualizador proprio (com colunas por caixa de marcar).
 */

interface PdfVisualizadorProps {
  titulo: string;
  nomeArquivo: string;
  pdf: Blob;
  onFechar: () => void;
}

const PdfVisualizador: React.FC<PdfVisualizadorProps> = ({ titulo, nomeArquivo, pdf, onFechar }) => {
  const quadro = useRef<HTMLIFrameElement>(null);
  const endereco = useMemo(() => URL.createObjectURL(pdf), [pdf]);

  useEffect(() => () => URL.revokeObjectURL(endereco), [endereco]);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const imprimir = () => {
    const janela = quadro.current?.contentWindow;
    if (!janela) return;
    janela.focus();
    janela.print();
  };

  const salvar = () => {
    const link = document.createElement('a');
    link.href = endereco;
    link.download = nomeArquivo;
    link.click();
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} style={{ position: 'fixed', inset: 0, zIndex: 2000, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', padding: '16px', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <strong style={{ color: '#fff', fontSize: '16px' }}>{titulo}</strong>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-primary" onClick={imprimir} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Printer size={16} /> Imprimir</button>
          <button type="button" className="btn-secondary" onClick={salvar} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><FileDown size={16} /> Salvar PDF</button>
          <button type="button" className="btn-secondary" onClick={onFechar} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><X size={16} /> Fechar</button>
        </div>
      </div>
      <iframe ref={quadro} src={endereco} title={titulo} style={{ flex: 1, width: '100%', border: 'none', borderRadius: '8px', backgroundColor: '#fff' }} />
    </div>
  );
};

export default PdfVisualizador;
