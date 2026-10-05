import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { quantidadePendente, resumirCondicional, type ItemCondicional } from '../../utils/condicionalDomain';

/**
 * TERMO DE CONDICIONAL em PDF (2026-10-05): o cliente assina na saida,
 * declarando que levou as pecas e o prazo para devolver ou pagar. Mesmo
 * desenho da minuta do app Vendas (vendedorMinutaPdf.ts), com preco -- o
 * cliente precisa saber quanto vai pagar pelo que ficar.
 */

export interface DadosTermoCondicional {
  numeroCondicional: string;
  nomeEmpresa: string;
  clienteNome: string;
  clienteTelefone?: string;
  dataSaida: string;
  prazoDevolucao: string;
  observacao?: string;
  itens: ItemCondicional[];
  usuarioNome: string;
  geradoEm: Date;
}

const PRETO: [number, number, number] = [30, 30, 30];

const dataBr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
const moeda = (valor: number) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantidade = (valor: number) => valor.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export const nomeArquivoTermoCondicional = (numero: string, clienteNome: string): string => {
  const limpo = clienteNome.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `Condicional ${numero} - ${limpo || 'Cliente'}.pdf`;
};

export const gerarTermoCondicionalPdf = (dados: DadosTermoCondicional): Blob => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();
  const margem = 12;
  const util = largura - margem * 2;
  pdf.setTextColor(...PRETO);
  pdf.setDrawColor(...PRETO);

  pdf.setFont('helvetica', 'bold').setFontSize(15);
  pdf.text('TERMO DE CONDICIONAL', largura / 2, 16, { align: 'center' });
  pdf.setFont('helvetica', 'normal').setFontSize(9);
  pdf.text(`Nº ${dados.numeroCondicional}`, largura / 2, 21.5, { align: 'center' });

  const linhas: Array<[string, string]> = [
    [`Loja: ${dados.nomeEmpresa}`, `Saída: ${dataBr(dados.dataSaida)}`],
    [`Cliente: ${dados.clienteNome}`, `Devolver até: ${dataBr(dados.prazoDevolucao)}`],
    [`Telefone: ${dados.clienteTelefone || ''}`, `Atendente: ${dados.usuarioNome}`],
    [`Obs.: ${String(dados.observacao || '').trim()}`, ''],
  ];
  const alturaLinha = 6;
  const topoQuadro = 26;
  pdf.setLineWidth(0.4).rect(margem, topoQuadro, util, alturaLinha * linhas.length + 3);
  linhas.forEach(([esquerda, direita], i) => {
    const y = topoQuadro + 6 + i * alturaLinha - 0.5;
    if (esquerda) pdf.text(esquerda, margem + 2, y, { maxWidth: util * 0.62 });
    if (direita) pdf.text(direita, margem + util - 2, y, { align: 'right', maxWidth: util * 0.36 });
  });

  const algumaDevolucao = dados.itens.some((i) => i.quantidadeDevolvida > 0);
  const cabecalho = algumaDevolucao
    ? ['Levou', 'Devolveu', 'Com o cliente', 'Und.', 'Código', 'Descrição', 'Preço un.']
    : ['Qtd.', 'Und.', 'Código', 'Descrição', 'Preço un.', 'Total'];
  autoTable(pdf, {
    startY: topoQuadro + alturaLinha * linhas.length + 8,
    margin: { left: margem, right: margem, bottom: 50 },
    head: [cabecalho],
    body: dados.itens.map((i) => (algumaDevolucao
      ? [quantidade(i.quantidade), quantidade(i.quantidadeDevolvida), quantidade(quantidadePendente(i)), i.unidadeMedidaSigla, i.codigo, i.nome, moeda(i.precoUnitario)]
      : [quantidade(i.quantidade), i.unidadeMedidaSigla, i.codigo, i.nome, moeda(i.precoUnitario), moeda(i.precoUnitario * i.quantidade)])),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, textColor: PRETO, cellPadding: 1.6, lineColor: [150, 150, 150], lineWidth: { bottom: 0.15 } },
    headStyles: { fontStyle: 'bold', lineColor: PRETO, lineWidth: { top: 0.4, bottom: 0.4 } },
  });

  const resumo = resumirCondicional(dados.itens);
  let y = ((pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 100) + 8;
  if (y > altura - 70) {
    pdf.addPage();
    y = 20;
  }
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  pdf.text(`Peças: ${quantidade(resumo.pecasLevadas)}${algumaDevolucao ? `   Devolvidas: ${quantidade(resumo.pecasDevolvidas)}   Com o cliente: ${quantidade(resumo.pecasComCliente)}` : ''}`, margem, y);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`${algumaDevolucao ? 'Valor com o cliente' : 'Valor total'}: ${moeda(algumaDevolucao ? resumo.valorComCliente : resumo.valorLevado)}`, margem + util, y, { align: 'right' });

  pdf.setFont('helvetica', 'normal').setFontSize(9.5);
  const declaracao = `Declaro que recebi as mercadorias acima em condicional, em perfeito estado, e me comprometo a devolvê-las nas mesmas condições até ${dataBr(dados.prazoDevolucao)} ou a pagar pelas que ficarem comigo, pelos preços indicados.`;
  pdf.text(pdf.splitTextToSize(declaracao, util), margem, y + 10);

  const yAssinatura = y + 38;
  const meio = margem + util / 2;
  pdf.setLineWidth(0.3);
  pdf.line(margem, yAssinatura, meio - 6, yAssinatura);
  pdf.line(meio + 6, yAssinatura, margem + util, yAssinatura);
  pdf.setFontSize(8.5);
  pdf.text('Assinatura da Loja', margem, yAssinatura + 4.5);
  pdf.text(`Assinatura do Cliente — ${dados.clienteNome}`, meio + 6, yAssinatura + 4.5, { maxWidth: util / 2 - 6 });

  pdf.setFontSize(7.5);
  const paginas = pdf.getNumberOfPages();
  for (let p = 1; p <= paginas; p += 1) {
    pdf.setPage(p);
    pdf.text(`Condicional nº ${dados.numeroCondicional}`, margem, altura - 8);
    pdf.text(`Gerado em ${dados.geradoEm.toLocaleString('pt-BR')}`, largura - margem, altura - 8, { align: 'right' });
  }

  return pdf.output('blob');
};
