import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { buscarClienteDoDocumento } from '../../services/clienteDoDocumentoService';
import { gerarPdfDaFolha, nomeDeArquivoPdf } from '../Vendedor/folhaParaPdf';
import { enviarMinutaPorWhatsApp, telefoneParaWhatsApp } from '../Vendedor/vendedorMinutaPdf';
import { linhasDoPdfDoOrcamento, totaisDoPdfDoOrcamento } from '../../utils/orcamentoModeloDomain';
import { mensagemDoOrcamentoParaCliente, nomeDaEmpresaNoDocumento, numeroDoOrcamentoParaTexto } from '../../utils/orcamentoEnvioDomain';
import { NexusSwal, showError, showSuccess } from '../../utils/alerts';
import OrcamentoPrintModelo from './OrcamentoPrintModelo';

/**
 * ORCAMENTO -> PDF -> WHATSAPP DO CLIENTE (23/11/2026, pedido do dono).
 *
 * Antes o botao so' abria o WhatsApp com um texto "da Hennder ERP", sem o
 * orcamento. Agora monta a mesma folha da impressao (OrcamentoPrintModelo)
 * fora da tela, vira PDF (folhaParaPdf, o mesmo do app Vendas) e:
 * - no computador: baixa o PDF e abre a conversa do cliente com o texto em
 *   nome da empresa -- o link do WhatsApp nao aceita anexo, entao o usuario
 *   arrasta o arquivo baixado para a conversa;
 * - no celular/tablet: abre o menu de compartilhar com o PDF (WhatsApp ja'
 *   com o arquivo); se o aparelho recusar, cai no download + conversa.
 */

export type ResultadoEnvioOrcamento = 'compartilhado' | 'baixado' | 'cancelado';

const ESPERA_MAXIMA_IMAGEM_MS = 5000;

const esperarImagens = async (elemento: HTMLElement): Promise<void> => {
  const imagens = Array.from(elemento.querySelectorAll('img'));
  await Promise.all(imagens.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((resolver) => {
    img.addEventListener('load', () => resolver(), { once: true });
    img.addEventListener('error', () => resolver(), { once: true });
    window.setTimeout(resolver, ESPERA_MAXIMA_IMAGEM_MS);
  }))));
};

const baixarPdf = (pdf: Blob, nomeArquivo: string) => {
  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Deixa o gerador de PDF baixado antes do clique (23/11/2026): na primeira
 * vez, o navegador ainda buscava as bibliotecas do PDF depois do clique.
 */
export const prepararEnvioDeOrcamento = (): void => {
  void import('html2canvas').catch(() => undefined);
  void import('jspdf').catch(() => undefined);
};

/**
 * Logo para o PDF (23/11/2026): empresas gravam o logo como imagem enorme
 * (Jomarly: 3000x2000, 800 KB embutidos no cadastro) e o gerador processava
 * tudo isso a cada envio. Reduz uma vez por sessao para o tamanho que a folha
 * usa; se nao conseguir, segue com o original.
 */
const logosReduzidos = new Map<string, Promise<string>>();
const LARGURA_MAXIMA_LOGO = 600;
const ALTURA_MAXIMA_LOGO = 300;

const reduzirLogo = (src: string): Promise<string> => {
  if (!src) return Promise.resolve('');
  const chave = `${src.length}:${src.slice(0, 64)}:${src.slice(-64)}`;
  const pronto = logosReduzidos.get(chave);
  if (pronto) return pronto;
  const promessa = new Promise<string>((resolver) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    const desistir = window.setTimeout(() => resolver(src), 3000);
    img.onload = () => {
      window.clearTimeout(desistir);
      try {
        const escala = Math.min(1, LARGURA_MAXIMA_LOGO / img.naturalWidth, ALTURA_MAXIMA_LOGO / img.naturalHeight);
        if (escala >= 1) { resolver(src); return; }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolver(src); return; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolver(canvas.toDataURL('image/png'));
      } catch {
        resolver(src);
      }
    };
    img.onerror = () => { window.clearTimeout(desistir); resolver(src); };
    img.src = src;
  });
  logosReduzidos.set(chave, promessa);
  return promessa;
};

/**
 * Folha montada num QUADRO ISOLADO (iframe) so' com ela e os estilos
 * (23/11/2026). Antes ela ia no corpo da pagina, e o gerador copiava a pagina
 * INTEIRA do sistema (todas as abas abertas) antes de fotografar a folha --
 * com varias abas, a copia levava segundos.
 */
const gerarPdfDoOrcamento = async (data: any, clientData: any, configData: any): Promise<Blob> => {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.tabIndex = -1;
  quadro.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1300px;border:0;pointer-events:none;';
  document.body.appendChild(quadro);
  let raiz: ReturnType<typeof createRoot> | null = null;
  try {
    const doc = quadro.contentDocument;
    if (!doc) throw new Error('Não foi possível montar a folha do orçamento. Tente de novo.');
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#ffffff"></body></html>');
    doc.close();
    // Mesmos estilos e tema da pagina (cores e fontes da folha).
    Array.from(document.documentElement.attributes).forEach((a) => { if (a.name !== 'style') doc.documentElement.setAttribute(a.name, a.value); });
    const estilos = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
    estilos.forEach((n) => doc.head.appendChild(n.cloneNode(true)));
    await Promise.all(Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map((l) => new Promise<void>((resolver) => {
      l.addEventListener('load', () => resolver(), { once: true });
      l.addEventListener('error', () => resolver(), { once: true });
      window.setTimeout(resolver, 3000);
    })));

    const logo = await reduzirLogo(String(configData?.logo || ''));
    const configDaFolha = configData ? { ...configData, ...(logo ? { logo } : {}) } : configData;

    const alvo = doc.createElement('div');
    doc.body.appendChild(alvo);
    raiz = createRoot(alvo);
    flushSync(() => raiz?.render(<OrcamentoPrintModelo data={data} clientData={clientData} configData={configDaFolha} />));
    const folha = alvo.querySelector<HTMLElement>('.a4-page, .mf-page, .pv-page');
    if (!folha) throw new Error('Não foi possível montar a folha do orçamento. Tente de novo.');
    await esperarImagens(folha);
    try { await doc.fonts?.ready; } catch { /* sem fontes: segue */ }
    return await gerarPdfDaFolha(folha);
  } finally {
    raiz?.unmount();
    quadro.remove();
  }
};

const noComputador = (): boolean => !(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);

const prepararEnvio = async (orcamentoId: string, tenantId: string) => {
  const [snap, configSnap] = await Promise.all([
    getDoc(doc(db, 'orcamentos', orcamentoId)),
    getDoc(doc(db, 'configuracoes', tenantId)),
  ]);
  if (!snap.exists() || snap.data().tenantId !== tenantId) {
    throw new Error('Orçamento não encontrado. Atualize a lista e tente de novo.');
  }
  const data = { id: snap.id, ...snap.data() } as any;
  const clientData = await buscarClienteDoDocumento(tenantId, data);
  const configData = configSnap.exists() ? configSnap.data() : null;

  const total = totaisDoPdfDoOrcamento(linhasDoPdfDoOrcamento(data), data).total;
  const mensagem = mensagemDoOrcamentoParaCliente({ numero: data.numeroOrcamento, empresa: nomeDaEmpresaNoDocumento(configData), total });
  const telefone = data.clienteTelefone || clientData?.whatsapp || clientData?.celular || clientData?.telefone || '';
  const nomeArquivo = nomeDeArquivoPdf('Orcamento', numeroDoOrcamentoParaTexto(data.numeroOrcamento), data.clienteNome);

  const pdf = await gerarPdfDoOrcamento(data, clientData, configData);
  return { pdf, nomeArquivo, telefone, mensagem };
};

/**
 * Botao "Enviar ao cliente" da lista e da tela do orcamento. Cuida da tela
 * toda: aguarde, erro em portugues e o aviso de anexar o PDF.
 */
export const enviarOrcamentoPorWhatsApp = async (orcamentoId: string, tenantId: string): Promise<ResultadoEnvioOrcamento> => {
  void NexusSwal.fire({
    title: 'Gerando o PDF do orçamento…',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    didOpen: () => NexusSwal.showLoading(),
  });
  let envio: Awaited<ReturnType<typeof prepararEnvio>>;
  try {
    envio = await prepararEnvio(orcamentoId, tenantId);
  } catch (erro) {
    NexusSwal.close();
    showError('Não foi possível gerar o PDF do orçamento', erro instanceof Error && /[à-ú]/i.test(erro.message)
      ? erro.message
      : 'Verifique a internet e tente de novo. Se continuar, use Imprimir e salve como PDF.');
    return 'cancelado';
  }
  NexusSwal.close();
  const { pdf, nomeArquivo, telefone, mensagem } = envio;

  if (!noComputador()) {
    return await enviarMinutaPorWhatsApp(pdf, nomeArquivo, telefone, mensagem, true) as ResultadoEnvioOrcamento;
  }

  baixarPdf(pdf, nomeArquivo);
  const url = `https://wa.me/${telefoneParaWhatsApp(telefone)}?text=${encodeURIComponent(mensagem)}`;
  const aberta = window.open(url, '_blank');
  if (aberta) {
    showSuccess('PDF baixado. Anexe o arquivo na conversa do WhatsApp que abriu.');
    return 'baixado';
  }
  // Navegador bloqueou a janela (o PDF demorou e o clique "venceu"): um clique novo abre.
  await NexusSwal.fire({
    icon: 'success',
    title: 'PDF do orçamento baixado',
    text: `Abra a conversa do cliente e anexe o arquivo ${nomeArquivo}.`,
    confirmButtonText: 'Abrir WhatsApp',
    showCancelButton: true,
    cancelButtonText: 'Fechar',
    preConfirm: () => { window.open(url, '_blank'); },
  });
  return 'baixado';
};
