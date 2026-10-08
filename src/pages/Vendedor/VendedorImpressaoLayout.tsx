import React, { useEffect, useRef, useState } from 'react';
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

const VIEWPORT_DO_APP = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
const VIEWPORT_DA_FOLHA = 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover';

/**
 * Casca das telas de impressao do app do vendedor. Mesma folha do desktop
 * (PedidoPrintDocument / OsPrintDocument), mas sem `usePrintAndClose`: aquele
 * hook fecha a aba do sistema de abas do desktop, que nao existe aqui.
 *
 * No celular, `window.print()` abre a folha nativa do Safari/Chrome, que ja
 * tem "Salvar em Arquivos"/"Salvar como PDF" -- nao precisa gerar PDF.
 *
 * FOLHA NA LARGURA DA TELA (2026-10-08): a folha tem 210mm (~794px) e o
 * celular ~375px. Antes a folha A4 virava fluida e os modelos de largura
 * fixa (talao de maquinas pesadas, Personalizado 01) saiam cortados a
 * direita. Agora a folha e' medida e reduzida com `transform: scale` para
 * caber na largura disponivel -- o que aparece na tela e' exatamente o PDF,
 * so' menor, como num leitor de PDF. Para ler os detalhes, a tela libera o
 * zoom de pinca (o resto do app trava o zoom, por isso o viewport e' trocado
 * so' enquanto esta tela existe). Na impressao o scale nao se aplica.
 *
 * Renderizada FORA da casca de altura fixa do VendedorShell (ver la): aquela
 * casca corta o conteudo em uma tela so', e a folha precisa rolar e
 * paginar.
 */
const VendedorImpressaoLayout: React.FC<Props> = ({ rotuloImprimir, carregando, erro, children }) => {
  const navigate = useNavigate();
  const areaRef = useRef<HTMLDivElement>(null);
  const folhaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  const [altura, setAltura] = useState<number | undefined>(undefined);

  // Zoom de pinca liberado so' nesta tela.
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const anterior = meta.getAttribute('content') || VIEWPORT_DO_APP;
    meta.setAttribute('content', VIEWPORT_DA_FOLHA);
    return () => { meta.setAttribute('content', anterior); };
  }, []);

  // Mede a folha e a area disponivel; refaz quando a tela gira ou a folha muda de tamanho.
  useEffect(() => {
    const area = areaRef.current;
    const folhaWrapper = folhaRef.current;
    if (!area || !folhaWrapper || carregando || erro) return;
    const medir = () => {
      const folha = folhaWrapper.firstElementChild as HTMLElement | null;
      if (!folha) return;
      const estilo = window.getComputedStyle(area);
      const disponivel = area.clientWidth - parseFloat(estilo.paddingLeft || '0') - parseFloat(estilo.paddingRight || '0');
      const larguraFolha = folha.offsetWidth;
      const k = larguraFolha > 0 && disponivel > 0 ? Math.min(1, disponivel / larguraFolha) : 1;
      setEscala(k);
      setAltura(folha.offsetHeight * k);
    };
    medir();
    const observador = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    observador?.observe(area);
    if (folhaWrapper.firstElementChild) observador?.observe(folhaWrapper.firstElementChild);
    window.addEventListener('resize', medir);
    return () => { observador?.disconnect(); window.removeEventListener('resize', medir); };
  }, [carregando, erro, children]);

  return (
    <div ref={areaRef} className="vendedor-impressao print-layout-wrapper">
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
        <div className="vendedor-folha-escalada" style={{ height: altura }}>
          <div ref={folhaRef} className="vendedor-folha-escalada__folha" style={{ transform: `scale(${escala})` }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendedorImpressaoLayout;
