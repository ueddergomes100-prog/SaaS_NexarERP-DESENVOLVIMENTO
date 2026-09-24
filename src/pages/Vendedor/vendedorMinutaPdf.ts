import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { MinutaCliente } from '../Expedicao/MinutaPrintDocument';
import {
  codigoENomeMinuta,
  enderecoMinuta,
  formatarCepMinuta,
  formatarDocumentoMinuta,
  formatarEmissaoMinuta,
  formatarGeradoEmMinuta,
  formatarQuantidadeMinuta,
  formatarTelefoneMinuta,
  formatarTotalPecasMinuta,
  rotuloDocumentoMinuta,
} from '../../utils/minutaDomain';
import type { RascunhoVenda } from './vendedorRascunhosStore';

/**
 * Minuta do RASCUNHO em PDF, pra o vendedor mandar pelo WhatsApp do cliente
 * conferir o que pediu ANTES de enviar o pedido a loja.
 *
 * Mesmo desenho da minuta impressa na retaguarda (MinutaPrintDocument.tsx) e,
 * como ela, SEM valor monetario. Diferencas: o rascunho ainda nao tem numero
 * de pedido (sai "RASCUNHO") e so' guarda codigo/nome/quantidade/unidade dos
 * itens -- codigo de barras, marca e local ficam de fora.
 *
 * jsPDF direto (sem html2canvas): roda leve no celular e nao depende de a
 * pagina estar visivel.
 */

export interface DadosMinutaRascunho {
  rascunho: RascunhoVenda;
  /** Cadastro do cliente (endereco, contatos, CPF/CNPJ). Sem ele o cabecalho sai so' com o nome. */
  cliente?: MinutaCliente | null;
  nomeEmpresa: string;
  vendedorNome: string;
  geradoEm: Date;
}

const PRETO: [number, number, number] = [30, 30, 30];

/** Nome do arquivo sem caractere que o celular recusa: "Minuta - Joao da Silva.pdf". */
export const nomeArquivoMinutaRascunho = (clienteNome: string): string => {
  const limpo = clienteNome.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Minuta - ${limpo || 'Cliente'}.pdf`;
};

export const gerarMinutaRascunhoPdf = ({ rascunho, cliente, nomeEmpresa, vendedorNome, geradoEm }: DadosMinutaRascunho): Blob => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  const margem = 12;
  const util = largura - margem * 2;
  pdf.setTextColor(...PRETO);
  pdf.setDrawColor(...PRETO);

  const texto = (valor: string, x: number, y: number, opcoes?: { align?: 'left' | 'right' | 'center'; maxWidth?: number }) => {
    pdf.text(valor, x, y, opcoes);
  };

  // Titulo
  pdf.setFont('helvetica', 'bold').setFontSize(15);
  texto('MINUTA DE ENTREGA', largura / 2, 16, { align: 'center' });
  pdf.setFont('helvetica', 'normal').setFontSize(9);
  texto('RASCUNHO - pedido ainda não enviado à loja, sujeito a conferência', largura / 2, 21.5, { align: 'center' });

  // Quadro do cabecalho: cada linha tem um texto a esquerda e outro a direita.
  const dadosCliente = cliente || {};
  const fone = formatarTelefoneMinuta(dadosCliente.telefone || rascunho.cliente.telefone);
  const celular = formatarTelefoneMinuta(dadosCliente.celular);
  const linhas: Array<[string, string]> = [
    [`Filial: ${nomeEmpresa}`, 'Pedido: RASCUNHO'],
    [`Cliente: ${codigoENomeMinuta(dadosCliente.codigo, rascunho.cliente.nome)}`, `Emissão: ${formatarEmissaoMinuta(new Date(rascunho.criadoEm))}`],
    [`Endereço: ${enderecoMinuta(dadosCliente)}`, `Fone: ${fone}   Cel.: ${celular}`],
    [
      `UF: ${dadosCliente.estado || ''}   CEP: ${formatarCepMinuta(dadosCliente.cep)}   Ref.: ${dadosCliente.referencia || ''}`,
      `Bairro: ${dadosCliente.bairro || ''}   Cidade: ${dadosCliente.cidade || ''}`,
    ],
    [`Obs.: ${String(rascunho.observacao || '').trim()}`, ''],
    ['', `Vendedor: ${vendedorNome}`],
  ];
  const alturaLinha = 6;
  const topoQuadro = 26;
  pdf.setLineWidth(0.4).rect(margem, topoQuadro, util, alturaLinha * linhas.length + 3);
  pdf.setFontSize(9);
  linhas.forEach(([esquerda, direita], i) => {
    const y = topoQuadro + 6 + i * alturaLinha - 0.5;
    if (esquerda) texto(esquerda, margem + 2, y, { maxWidth: util * 0.62 });
    if (direita) texto(direita, margem + util - 2, y, { align: 'right', maxWidth: util * 0.36 });
  });

  // Itens
  const itens = rascunho.itens.map((item) => ({
    quantidade: item.quantidade,
    unidade: item.unidadeMedidaSigla || 'UN',
    codigo: item.codigo || '',
    nome: item.nome,
  }));
  autoTable(pdf, {
    startY: topoQuadro + alturaLinha * linhas.length + 8,
    margin: { left: margem, right: margem, bottom: 50 },
    head: [['Quantid.', 'Und.', 'Matric.', 'Descrição']],
    body: itens.length > 0
      ? itens.map((i) => [formatarQuantidadeMinuta(i.quantidade), i.unidade, i.codigo, i.nome])
      : [[{ content: 'Nenhum item adicionado.', colSpan: 4, styles: { halign: 'center' as const } }]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, textColor: PRETO, cellPadding: 1.6, lineColor: [150, 150, 150], lineWidth: { bottom: 0.15 } },
    headStyles: { fontStyle: 'bold', lineColor: PRETO, lineWidth: { top: 0.4, bottom: 0.4 } },
    columnStyles: { 0: { halign: 'right', cellWidth: 26 }, 1: { cellWidth: 14 }, 2: { halign: 'right', cellWidth: 22 } },
  });

  // Total, entrega e assinaturas. Se nao couber, vai pra folha seguinte.
  let y = ((pdf as any).lastAutoTable?.finalY ?? 100) + 8;
  if (y > altura - 62) {
    pdf.addPage();
    y = 20;
  }
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  texto('Total de Peça(s):', margem, y);
  pdf.setFont('helvetica', 'bold');
  texto(formatarTotalPecasMinuta(itens), margem + 34, y);

  pdf.setFont('helvetica', 'normal');
  texto('Data de Entrega  ____/____/____', margem, y + 14);
  texto('Horário  _____ : _____', margem + 80, y + 14);

  const yAssinatura = y + 34;
  const meio = margem + util / 2;
  pdf.setLineWidth(0.3);
  pdf.line(margem, yAssinatura, meio - 6, yAssinatura);
  pdf.line(meio + 6, yAssinatura, margem + util, yAssinatura);
  pdf.setFontSize(8.5);
  texto('Assinatura do Entregador', margem, yAssinatura + 4.5);
  const documento = formatarDocumentoMinuta(dadosCliente.documento);
  texto(
    `Assinatura do Cliente${documento ? `   ${rotuloDocumentoMinuta(dadosCliente.documento)}: ${documento}` : ''}`,
    meio + 6,
    yAssinatura + 4.5,
  );

  // Rodape em todas as folhas.
  pdf.setFontSize(7.5);
  const paginas = pdf.getNumberOfPages();
  for (let p = 1; p <= paginas; p += 1) {
    pdf.setPage(p);
    texto(`Estação: ${nomeEmpresa.replace(/\s+/g, '').toUpperCase()}`, margem, altura - 8);
    texto(`Usuário: ${vendedorNome.toUpperCase()}`, largura / 2, altura - 8, { align: 'center' });
    texto(`Gerado em ${formatarGeradoEmMinuta(geradoEm)}`, largura - margem, altura - 8, { align: 'right' });
  }

  return pdf.output('blob');
};

/** Telefone pro wa.me: so' digitos, com o 55 na frente quando vier sem o codigo do pais. */
export const telefoneParaWhatsApp = (telefone: unknown): string => {
  const digitos = String(telefone ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
};

export type ResultadoEnvioMinuta = 'compartilhado' | 'baixado' | 'cancelado';

/**
 * Entrega o PDF ao WhatsApp. No celular abre o menu de compartilhar do
 * sistema (o vendedor escolhe o WhatsApp e o contato -- o wa.me nao aceita
 * anexo, entao nao da' pra cair direto na conversa com o arquivo). Onde o
 * navegador nao compartilha arquivo (computador), baixa o PDF e abre a
 * conversa do cliente pra anexar.
 */
export const enviarMinutaPorWhatsApp = async (pdf: Blob, nomeArquivo: string, telefone: unknown, mensagem: string): Promise<ResultadoEnvioMinuta> => {
  const arquivo = new File([pdf], nomeArquivo, { type: 'application/pdf' });
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], text: mensagem });
      return 'compartilhado';
    } catch (error) {
      // O vendedor fechou o menu de compartilhar: nao e' erro.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelado';
      throw error;
    }
  }

  const url = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  const numero = telefoneParaWhatsApp(telefone);
  window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`, '_blank');
  return 'baixado';
};
