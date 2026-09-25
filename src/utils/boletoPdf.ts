import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { formatarLinhaDigitavel } from './boletoDomain';

/*
 * BOLETO EM PDF (2026-09-25): recibo do pagador + ficha de compensacao, com linha digitavel e codigo de
 * barras ITF (padrao dos boletos). O conteudo e' calculado por boletoCnabDomain.ts/boletoDomain.ts;
 * aqui so' se desenha. O banco e' quem registra o titulo (remessa) -- o PDF e' o que o cliente paga.
 */

export interface DadosPdfBoleto {
  bancoNome: string;
  /** "756-0" no Sicoob. */
  codigoBanco: string;
  beneficiarioNome: string;
  beneficiarioCnpj: string;
  /** "3049 / 0512150" -- agencia e codigo do beneficiario. */
  agenciaCodigoBeneficiario: string;
  pagadorNome: string;
  pagadorDocumento: string;
  pagadorEndereco: string;
  numeroDocumento: string;
  nossoNumero: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  dataEmissao: string;
  valorCentavos: number;
  linhaDigitavel: string;
  codigoBarras: string;
  /** Mensagens (multa, mora, protesto) impressas no campo de instrucoes. */
  instrucoes: string[];
}

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

const barrasItf = (codigo: string): string => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, codigo, { format: 'ITF', displayValue: false, width: 2, height: 60, margin: 0 });
  return canvas.toDataURL('image/png');
};

const caixa = (doc: jsPDF, x: number, y: number, largura: number, altura: number, rotulo: string, valor: string, opcoes: { negrito?: boolean; direita?: boolean } = {}) => {
  doc.setDrawColor(120);
  doc.setLineWidth(0.2);
  doc.rect(x, y, largura, altura);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(90);
  doc.text(rotulo, x + 1.2, y + 3);
  doc.setTextColor(0);
  doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal');
  doc.setFontSize(9);
  if (opcoes.direita) doc.text(valor, x + largura - 1.2, y + altura - 1.8, { align: 'right' });
  else doc.text(valor, x + 1.2, y + altura - 1.8, { maxWidth: largura - 2.4 });
};

/** Uma via do boleto: cabecalho com banco e linha digitavel + campos. `comBarras` so' na ficha de compensacao. */
const desenharVia = (doc: jsPDF, dados: DadosPdfBoleto, topo: number, titulo: string, comBarras: boolean): number => {
  const x = 10;
  const l = 190;
  let y = topo;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text(titulo, x, y - 1.5);

  // Banco | linha digitavel
  doc.setDrawColor(120);
  doc.rect(x, y, l, 10);
  doc.setFontSize(12);
  doc.text(dados.bancoNome, x + 2, y + 6.5);
  doc.line(x + 45, y, x + 45, y + 10);
  doc.setFontSize(13);
  doc.text(dados.codigoBanco, x + 48, y + 6.8);
  doc.line(x + 63, y, x + 63, y + 10);
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(formatarLinhaDigitavel(dados.linhaDigitavel), x + 65, y + 6.5);
  y += 10;

  caixa(doc, x, y, 130, 9, 'Local de pagamento', 'PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO');
  caixa(doc, x + 130, y, 60, 9, 'Vencimento', dataBr(dados.vencimento), { negrito: true, direita: true });
  y += 9;
  caixa(doc, x, y, 130, 9, 'Beneficiário', `${dados.beneficiarioNome}  ·  CNPJ ${dados.beneficiarioCnpj}`);
  caixa(doc, x + 130, y, 60, 9, 'Agência / Código do beneficiário', dados.agenciaCodigoBeneficiario, { direita: true });
  y += 9;
  caixa(doc, x, y, 30, 9, 'Data do documento', dataBr(dados.dataEmissao));
  caixa(doc, x + 30, y, 40, 9, 'Nº do documento', dados.numeroDocumento);
  caixa(doc, x + 70, y, 20, 9, 'Espécie doc.', 'DM');
  caixa(doc, x + 90, y, 15, 9, 'Aceite', 'N');
  caixa(doc, x + 105, y, 25, 9, 'Data processamento', dataBr(dados.dataEmissao));
  caixa(doc, x + 130, y, 60, 9, 'Nosso número', dados.nossoNumero, { direita: true });
  y += 9;
  caixa(doc, x, y, 30, 9, 'Carteira', '1 / 01');
  caixa(doc, x + 30, y, 20, 9, 'Espécie', 'R$');
  caixa(doc, x + 50, y, 80, 9, 'Quantidade / Valor', '');
  caixa(doc, x + 130, y, 60, 9, '(=) Valor do documento', moeda(dados.valorCentavos), { negrito: true, direita: true });
  y += 9;

  // Instrucoes
  doc.rect(x, y, 130, 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(90);
  doc.text('Instruções (texto de responsabilidade do beneficiário)', x + 1.2, y + 3);
  doc.setTextColor(0);
  doc.setFontSize(8.5);
  dados.instrucoes.filter(Boolean).slice(0, 4).forEach((linha, i) => doc.text(linha, x + 1.5, y + 8 + i * 4.5));
  caixa(doc, x + 130, y, 60, 6, '(-) Desconto', '');
  caixa(doc, x + 130, y + 6, 60, 6, '(+) Mora / Multa', '');
  caixa(doc, x + 130, y + 12, 60, 12, '(=) Valor cobrado', '');
  y += 24;

  // Pagador
  doc.rect(x, y, l, 14);
  doc.setFontSize(6.5);
  doc.setTextColor(90);
  doc.text('Pagador', x + 1.2, y + 3);
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`${dados.pagadorNome}  ·  ${dados.pagadorDocumento}`, x + 1.5, y + 7.5, { maxWidth: l - 3 });
  doc.setFont('helvetica', 'normal');
  doc.text(dados.pagadorEndereco, x + 1.5, y + 11.5, { maxWidth: l - 3 });
  y += 14;

  if (comBarras) {
    doc.addImage(barrasItf(dados.codigoBarras), 'PNG', x, y + 3, 103, 14);
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    doc.text('Autenticação mecânica — Ficha de compensação', x + l, y + 20, { align: 'right' });
    y += 22;
  }
  return y;
};

/** PDF do boleto (recibo do pagador em cima, ficha de compensacao com codigo de barras embaixo). */
export const gerarPdfBoleto = (dados: DadosPdfBoleto): Blob => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const fim = desenharVia(doc, dados, 16, 'Recibo do pagador', false);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(10, fim + 6, 200, fim + 6);
  doc.setLineDashPattern([], 0);
  desenharVia(doc, dados, fim + 16, 'Ficha de compensação', true);
  return doc.output('blob');
};
