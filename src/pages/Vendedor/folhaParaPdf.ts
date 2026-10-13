/*
 * FOLHA DA TELA -> PDF PARA ENVIAR OU SALVAR (app Vendas, 2026-10-13).
 *
 * No app instalado (tela inicial do celular ou Play Store) o window.print()
 * nao abre nada -- o dono nao conseguia mandar a OS/pedido pelo WhatsApp nem
 * salvar. Aqui a folha que esta' na tela (OsPrintDocument, PedidoPrintModelo,
 * qualquer modelo) vira PDF do jeito que aparece -- foto da folha em A4 -- e
 * vai para o menu de compartilhar do celular (WhatsApp, Salvar em Arquivos,
 * e-mail...). Onde o navegador nao compartilha arquivo, baixa o PDF.
 *
 * html2canvas e jsPDF sao carregados so' quando usados (o app fica leve).
 * Imagens da folha (logo, assinatura) vem do Firebase Storage, que responde
 * com CORS liberado -- por isso `useCORS`.
 */

const A4_LARGURA_MM = 210;
const A4_ALTURA_MM = 297;

/** Classe do embrulho que reduz a folha para caber na tela (VendedorImpressaoLayout). */
const CLASSE_FOLHA_ESCALADA = 'vendedor-folha-escalada__folha';

export const nomeDeArquivoPdf = (...partes: Array<string | number | null | undefined>): string => {
  const base = partes
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'documento'}.pdf`;
};

/** Quantas fatias de A4 uma imagem de largura x altura (px) ocupa. */
export const paginasNecessarias = (larguraPx: number, alturaPx: number): number => {
  if (!(larguraPx > 0) || !(alturaPx > 0)) return 1;
  const alturaPaginaPx = larguraPx * (A4_ALTURA_MM / A4_LARGURA_MM);
  // 2% de folga: a folha A4 da tela costuma ter a altura exata de uma pagina.
  return Math.max(1, Math.ceil(alturaPx / (alturaPaginaPx * 1.02)));
};

/** Gera o PDF (A4 retrato) da folha que esta' dentro de `elemento`. */
export const gerarPdfDaFolha = async (elemento: HTMLElement): Promise<Blob> => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  // A folha esta' reduzida na tela (transform: scale). offsetWidth/offsetHeight
  // sao o tamanho REAL dela (transform nao mexe no layout); sem passar isso o
  // html2canvas usaria o tamanho reduzido e cortaria a folha.
  const canvas = await html2canvas(elemento, {
    width: elemento.offsetWidth,
    height: elemento.offsetHeight,
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    // Na copia que vira imagem, a folha volta ao tamanho real (sem a reducao da tela).
    onclone: (doc) => {
      doc.querySelectorAll<HTMLElement>(`.${CLASSE_FOLHA_ESCALADA}`).forEach((el) => {
        el.style.transform = 'none';
      });
      doc.querySelectorAll<HTMLElement>('.vendedor-folha-escalada').forEach((el) => {
        el.style.height = 'auto';
        el.style.overflow = 'visible';
      });
    },
  });

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const paginas = paginasNecessarias(canvas.width, canvas.height);
  const alturaFatiaPx = Math.ceil(canvas.height / paginas);

  for (let i = 0; i < paginas; i++) {
    const fatia = document.createElement('canvas');
    fatia.width = canvas.width;
    fatia.height = Math.min(alturaFatiaPx, canvas.height - i * alturaFatiaPx);
    const ctx = fatia.getContext('2d');
    if (!ctx) throw new Error('Este aparelho não conseguiu montar o PDF. Tente de novo.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, fatia.width, fatia.height);
    ctx.drawImage(canvas, 0, i * alturaFatiaPx, fatia.width, fatia.height, 0, 0, fatia.width, fatia.height);
    const alturaMm = Math.min(A4_ALTURA_MM, (fatia.height * A4_LARGURA_MM) / fatia.width);
    if (i > 0) pdf.addPage();
    pdf.addImage(fatia.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_LARGURA_MM, alturaMm);
  }

  return pdf.output('blob');
};

export type ResultadoCompartilhar = 'compartilhado' | 'cancelado' | 'baixado' | 'precisa_toque';

/**
 * Abre o menu de compartilhar do celular com o PDF. Sem suporte (computador),
 * baixa o arquivo. `precisa_toque`: o navegador recusou porque o toque do
 * botao "venceu" enquanto o PDF era montado -- a tela pede um segundo toque.
 */
export const compartilharOuBaixarPdf = async (pdf: Blob, nomeArquivo: string, texto: string): Promise<ResultadoCompartilhar> => {
  const arquivo = new File([pdf], nomeArquivo, { type: 'application/pdf' });
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: nomeArquivo.replace(/\.pdf$/i, ''), text: texto });
      return 'compartilhado';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelado';
      if (error instanceof DOMException && error.name === 'NotAllowedError') return 'precisa_toque';
      // Outro erro do sistema: cai no download, logo abaixo.
    }
  }
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'baixado';
};
