import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';
import { chamarServidor } from './apiServidor';
import type { BoletoDigitado, PrazosCobranca, ContatoDaCobranca } from '../utils/mensalidadeDomain';

/**
 * Mensalidades das empresas clientes (24/11/2026). Toda gravacao passa pelo
 * servidor (/api/mensalidades, so' admin da plataforma); o navegador so' sobe
 * o PDF do boleto para o Storage (cobranca/{empresa}/...) e manda o link.
 */

export interface RespostaEnvio {
  emailPara: string | null;
  whatsapp: { telefone: string; texto: string } | null;
}

const post = <T = unknown>(caminho: string, corpo: Record<string, unknown>) => chamarServidor<T>('POST', `mensalidades/${caminho}`, corpo);

export const salvarConfigGeralDaCobranca = (prazos: PrazosCobranca, contato: ContatoDaCobranca) => post('config', { prazos, contato });

export const salvarPlanoDaEmpresa = (dados: { tenantId: string; ativa: boolean; diaVencimento: number | null; prazos: PrazosCobranca | null }) => post('empresa', dados);

export const liberarEmpresaAte = (tenantId: string, ate: string | null, motivo: string) => post('liberar', { tenantId, ate, motivo });

export const gerarMensalidade = (tenantId: string, competencia: string) => post<{ id: string }>('gerar', { tenantId, competencia });

export const anexarBoleto = (id: string, boleto: BoletoDigitado) => post('boleto', { id, boleto });

export const marcarMensalidadePaga = (id: string, pagoEm: string) => post('pagar', { id, pagoEm });

export const desfazerPagamento = (id: string, motivo: string) => post('desfazer-pagamento', { id, motivo });

export const cancelarMensalidade = (id: string, motivo: string) => post('cancelar', { id, motivo });

export const enviarCobranca = (id: string, porEmail: boolean, porWhatsapp: boolean) => post<RespostaEnvio>('enviar', { id, porEmail, porWhatsapp });

/** Sobe o PDF do boleto e devolve o link (com token) e o caminho. */
export const subirPdfDoBoleto = async (tenantId: string, mensalidadeId: string, arquivo: File): Promise<{ pdfUrl: string; pdfCaminho: string }> => {
  if (arquivo.type !== 'application/pdf') throw new Error('Escolha o arquivo PDF do boleto (baixado do PicPay).');
  if (arquivo.size >= 10 * 1024 * 1024) throw new Error('O PDF passa de 10 MB. Baixe de novo do PicPay ou cole só a linha digitável.');
  const pdfCaminho = `cobranca/${tenantId}/${mensalidadeId}-${Date.now()}.pdf`;
  const destino = storageRef(storage, pdfCaminho);
  await uploadBytes(destino, arquivo, {
    contentType: 'application/pdf',
    contentDisposition: `inline; filename="boleto-${mensalidadeId}.pdf"`,
    cacheControl: 'private, max-age=31536000',
  });
  return { pdfUrl: await getDownloadURL(destino), pdfCaminho };
};
