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
import OrcamentoPrintDocument from './OrcamentoPrintDocument';

/**
 * ORCAMENTO -> PDF -> WHATSAPP DO CLIENTE (23/11/2026, pedido do dono).
 *
 * Antes o botao so' abria o WhatsApp com um texto "da Hennder ERP", sem o
 * orcamento. Agora monta a mesma folha da impressao (OrcamentoPrintDocument)
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

/** Folha montada fora da tela, so' o tempo de virar PDF. */
const gerarPdfDoOrcamento = async (data: any, clientData: any, configData: any): Promise<Blob> => {
  const recipiente = document.createElement('div');
  recipiente.setAttribute('aria-hidden', 'true');
  recipiente.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#ffffff;pointer-events:none;';
  document.body.appendChild(recipiente);
  const raiz = createRoot(recipiente);
  try {
    flushSync(() => raiz.render(<OrcamentoPrintDocument data={data} clientData={clientData} configData={configData} />));
    const folha = recipiente.querySelector<HTMLElement>('.a4-page');
    if (!folha) throw new Error('Não foi possível montar a folha do orçamento. Tente de novo.');
    await esperarImagens(folha);
    return await gerarPdfDaFolha(folha);
  } finally {
    raiz.unmount();
    recipiente.remove();
  }
};

const noComputador = (): boolean => !(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);

const prepararEnvio = async (orcamentoId: string, tenantId: string) => {
  const snap = await getDoc(doc(db, 'orcamentos', orcamentoId));
  if (!snap.exists() || snap.data().tenantId !== tenantId) {
    throw new Error('Orçamento não encontrado. Atualize a lista e tente de novo.');
  }
  const data = { id: snap.id, ...snap.data() } as any;
  const [clientData, configSnap] = await Promise.all([
    buscarClienteDoDocumento(tenantId, data),
    getDoc(doc(db, 'configuracoes', tenantId)),
  ]);
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
