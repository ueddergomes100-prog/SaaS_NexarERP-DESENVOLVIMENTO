import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { formatarReais, type Cotacao, type FornecedorDaCotacao, type PedidoCompra } from './comprasDomain';

/**
 * PDFs de Compras (22/10/2026): a cotacao para um fornecedor (lista de itens
 * sem preco, com o link e o codigo) e o pedido de compra. jsPDF + autoTable
 * direto, como a minuta do app: gera um Blob que serve para ver, baixar,
 * mandar pelo WhatsApp ou anexar.
 */

const PRETO: [number, number, number] = [20, 20, 20];
const dataBr = (iso: string) => (iso ? iso.split('T')[0].split('-').reverse().join('/') : '');
const quantidade = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const cabecalho = (pdf: jsPDF, titulo: string, subtitulo: string, empresa: string) => {
  const largura = pdf.internal.pageSize.getWidth();
  pdf.setTextColor(...PRETO);
  pdf.setFont('helvetica', 'bold').setFontSize(15);
  pdf.text(titulo, largura / 2, 16, { align: 'center' });
  pdf.setFont('helvetica', 'normal').setFontSize(9.5);
  pdf.text(subtitulo, largura / 2, 21.5, { align: 'center' });
  pdf.setFontSize(10).setFont('helvetica', 'bold');
  pdf.text(empresa, 12, 30);
  pdf.setFont('helvetica', 'normal');
};

const rodape = (pdf: jsPDF, texto: string) => {
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(7.5);
  for (let p = 1; p <= pdf.getNumberOfPages(); p += 1) {
    pdf.setPage(p);
    pdf.text(texto, 12, altura - 8);
    pdf.text(`Página ${p} de ${pdf.getNumberOfPages()}`, largura - 12, altura - 8, { align: 'right' });
  }
};

const linhasDeTexto = (pdf: jsPDF, linhas: string[], y: number): number => {
  pdf.setFontSize(9.5);
  linhas.filter(Boolean).forEach((l) => { pdf.text(l, 12, y, { maxWidth: pdf.internal.pageSize.getWidth() - 24 }); y += 5.2; });
  return y;
};

export const gerarPdfCotacao = (args: { empresa: string; cotacao: Cotacao; fornecedor: FornecedorDaCotacao; link: string }): Blob => {
  const { empresa, cotacao, fornecedor, link } = args;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  cabecalho(pdf, `COTAÇÃO DE COMPRA Nº ${String(cotacao.numero).padStart(4, '0')}`, cotacao.titulo, empresa);
  const y = linhasDeTexto(pdf, [
    `Fornecedor: ${fornecedor.nome}`,
    `Responder até: ${dataBr(cotacao.responderAte)}`,
    `Responda pelo link: ${link}`,
    `Código de acesso: ${fornecedor.codigoAcesso}`,
    cotacao.observacao ? `Observação: ${cotacao.observacao}` : '',
  ], 37);
  autoTable(pdf, {
    startY: y + 2,
    margin: { left: 12, right: 12 },
    head: [['Código', 'Produto', 'Qtd.', 'Und.', 'Preço unit.', 'Observação']],
    body: cotacao.itens.map((i) => [i.codigo, i.nome, quantidade(i.quantidade), i.unidade, '', i.observacao]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, textColor: PRETO, cellPadding: 1.8 },
    headStyles: { fontStyle: 'bold', fillColor: [235, 235, 235], textColor: PRETO },
    columnStyles: { 0: { cellWidth: 20 }, 2: { halign: 'right', cellWidth: 18 }, 3: { cellWidth: 14 }, 4: { cellWidth: 26 } },
  });
  rodape(pdf, `Cotação gerada por ${empresa} em ${dataBr(new Date().toISOString())}`);
  return pdf.output('blob');
};

export const gerarPdfPedidoCompra = (args: { empresa: string; pedido: PedidoCompra; dadosEmpresa?: { cnpj?: string; telefone?: string; endereco?: string } }): Blob => {
  const { empresa, pedido, dadosEmpresa = {} } = args;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  cabecalho(pdf, `PEDIDO DE COMPRA Nº ${String(pedido.numero).padStart(4, '0')}`, `Emitido em ${dataBr(pedido.criadoEmIso)}`, empresa);
  const y = linhasDeTexto(pdf, [
    [dadosEmpresa.cnpj ? `CNPJ ${dadosEmpresa.cnpj}` : '', dadosEmpresa.telefone ? `Fone ${dadosEmpresa.telefone}` : '', dadosEmpresa.endereco || ''].filter(Boolean).join('  ·  '),
    `Fornecedor: ${pedido.fornecedorNome}`,
    pedido.prazoEntregaDias !== null ? `Prazo de entrega: ${pedido.prazoEntregaDias} dia(s)` : '',
    pedido.condicaoPagamento ? `Condição de pagamento: ${pedido.condicaoPagamento}` : '',
    pedido.cotacaoNumero ? `Origem: cotação nº ${String(pedido.cotacaoNumero).padStart(4, '0')}` : '',
    pedido.observacao ? `Observação: ${pedido.observacao}` : '',
  ], 37);
  autoTable(pdf, {
    startY: y + 2,
    margin: { left: 12, right: 12 },
    head: [['Código', 'Produto', 'Qtd.', 'Und.', 'Preço unit.', 'Subtotal']],
    body: pedido.itens.map((i) => [i.codigo, i.nome, quantidade(i.quantidade), i.unidade, formatarReais(i.precoUnitarioCentavos), formatarReais(i.subtotalCentavos)]),
    foot: [[{ content: 'TOTAL', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } }, { content: formatarReais(pedido.totalCentavos), styles: { fontStyle: 'bold', halign: 'right' } }]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, textColor: PRETO, cellPadding: 1.8 },
    headStyles: { fontStyle: 'bold', fillColor: [235, 235, 235], textColor: PRETO },
    footStyles: { fillColor: [245, 245, 245], textColor: PRETO },
    columnStyles: { 0: { cellWidth: 20 }, 2: { halign: 'right', cellWidth: 18 }, 3: { cellWidth: 14 }, 4: { halign: 'right', cellWidth: 26 }, 5: { halign: 'right', cellWidth: 28 } },
  });
  rodape(pdf, `Pedido de compra de ${empresa}`);
  return pdf.output('blob');
};

/** Nome do arquivo sem acento nem espaco. */
export const nomeDoArquivoPdf = (prefixo: string, numero: number, complemento = ''): string => (
  `${prefixo}-${String(numero).padStart(4, '0')}${complemento ? `-${complemento}` : ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-') + '.pdf'
);

/** Link do WhatsApp com o texto pronto (numero brasileiro). */
export const linkDoWhatsApp = (telefone: string, texto: string): string => {
  const digitos = String(telefone || '').replace(/\D/g, '');
  const numero = digitos.length >= 10 && !digitos.startsWith('55') ? `55${digitos}` : digitos;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
};
