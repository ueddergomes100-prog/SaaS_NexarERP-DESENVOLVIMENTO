import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Printer, Share2 } from 'lucide-react';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import { compartilharOuBaixarPdf, gerarPdfDaFolha } from './folhaParaPdf';
import '../OS/OsPrint.css';
import './vendedorMobile.css';

interface Props {
  rotuloImprimir: string;
  carregando: boolean;
  erro?: string;
  /** Nome do PDF ao enviar/salvar (ex.: "OS-12-JOAO-SILVA.pdf"). */
  nomeArquivo: string;
  /** Texto que acompanha o arquivo no WhatsApp/e-mail. */
  textoCompartilhar?: string;
  children?: React.ReactNode;
}

const VIEWPORT_DO_APP = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
const VIEWPORT_DA_FOLHA = 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover';

/**
 * Casca das telas de impressao do app do vendedor. Mesma folha do desktop
 * (PedidoPrintDocument / OsPrintDocument), mas sem `usePrintAndClose`: aquele
 * hook fecha a aba do sistema de abas do desktop, que nao existe aqui.
 *
 * ENVIAR OU SALVAR PDF (2026-10-13): no app instalado (tela inicial ou Play
 * Store) o window.print() nao abre nada no celular. O botao principal agora
 * gera o PDF da folha como ela aparece (folhaParaPdf.ts) e abre o menu de
 * compartilhar do celular -- WhatsApp, Salvar em Arquivos, e-mail. O PDF e'
 * montado em segundo plano assim que a folha aparece, para o toque abrir o
 * menu na hora (o celular so' deixa compartilhar logo depois de um toque).
 * A impressora continua no botao com o icone, para quem usa no navegador.
 *
 * FOLHA NA LARGURA DA TELA (2026-10-08): a folha tem 210mm (~794px) e o
 * celular ~375px; ela e' medida e reduzida com `transform: scale` para caber
 * na largura disponivel, com zoom de pinca liberado so' nesta tela.
 *
 * Renderizada FORA da casca de altura fixa do VendedorShell (ver la): aquela
 * casca corta o conteudo em uma tela so', e a folha precisa rolar e
 * paginar.
 */
const VendedorImpressaoLayout: React.FC<Props> = ({ rotuloImprimir, carregando, erro, nomeArquivo, textoCompartilhar = '', children }) => {
  const navigate = useNavigate();
  const areaRef = useRef<HTMLDivElement>(null);
  const folhaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);
  const [altura, setAltura] = useState<number | undefined>(undefined);
  const [gerando, setGerando] = useState(false);
  const pdfPronto = useRef<Blob | null>(null);
  const geracao = useRef<Promise<Blob> | null>(null);

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

  // PDF em segundo plano, logo que a folha aparece (logo e assinatura ja' carregados).
  useEffect(() => {
    pdfPronto.current = null;
    geracao.current = null;
    if (carregando || erro) return;
    const timer = window.setTimeout(() => {
      const folha = folhaRef.current;
      if (!folha) return;
      geracao.current = gerarPdfDaFolha(folha);
      geracao.current
        .then((pdf) => { pdfPronto.current = pdf; })
        .catch((e) => { console.error('Erro ao montar o PDF da folha:', e); geracao.current = null; });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [carregando, erro, children]);

  const enviarPdf = async () => {
    const folha = folhaRef.current;
    if (!folha) return;
    try {
      let pdf = pdfPronto.current;
      if (!pdf) {
        setGerando(true);
        pdf = await (geracao.current ?? gerarPdfDaFolha(folha));
        pdfPronto.current = pdf;
      }
      const resultado = await compartilharOuBaixarPdf(pdf, nomeArquivo, textoCompartilhar);
      if (resultado === 'baixado') showSuccess('PDF salvo nos downloads do aparelho.');
      if (resultado === 'precisa_toque') {
        const pdfFinal = pdf;
        await NexusSwal.fire({
          title: 'PDF pronto',
          text: 'Toque em Enviar para escolher o WhatsApp ou salvar no aparelho.',
          icon: 'success',
          showCancelButton: true,
          confirmButtonText: 'Enviar',
          cancelButtonText: 'Fechar',
          // Dentro do toque no botao: o celular so' abre o menu de compartilhar assim.
          preConfirm: () => compartilharOuBaixarPdf(pdfFinal, nomeArquivo, textoCompartilhar),
        });
      }
    } catch (e) {
      console.error('Erro ao gerar/enviar o PDF:', e);
      showError('Não foi possível gerar o PDF', 'Confira a internet e tente de novo. Se continuar, use o botão da impressora.');
    } finally {
      setGerando(false);
    }
  };

  return (
    <div ref={areaRef} className="vendedor-impressao print-layout-wrapper">
      <div className="print-actions no-print" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} style={{ marginRight: 6 }} />
          Voltar
        </button>
        {!carregando && !erro && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.print()}
              title={rotuloImprimir}
              aria-label={rotuloImprimir}
              style={{ padding: '0 12px', display: 'inline-flex', alignItems: 'center' }}
            >
              <Printer size={18} />
            </button>
            <button type="button" className="btn-primary" onClick={() => void enviarPdf()} disabled={gerando} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {gerando ? <Loader2 size={18} className="spin-icon" /> : <Share2 size={18} />}
              {gerando ? 'Preparando PDF...' : 'Enviar ou salvar PDF'}
            </button>
          </div>
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
