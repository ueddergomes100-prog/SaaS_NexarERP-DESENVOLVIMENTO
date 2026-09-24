import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import JsBarcode from 'jsbarcode';
import type { NotaParseada } from './nfeXmlDomain';

/*
 * DANFE A PARTIR DO XML (pedido do dono, 2026-09-24).
 *
 * "Eles conseguem imprimir DANFE pela chave de acesso da nota antes de dar
 * entrada." O DANFE e' so' a representacao impressa do XML, entao ele e'
 * desenhado direto do XML da nota -- nao precisa de nenhum servico externo e
 * funciona antes de a nota entrar no estoque.
 *
 * Desenho: A4 retrato, mesmos blocos do DANFE oficial (emitente, chave com
 * codigo de barras, destinatario, fatura, calculo do imposto, transportador,
 * itens, dados adicionais). Itens em tabela que continua nas paginas seguintes.
 */

const MARGEM = 8;
const LARGURA = 210 - MARGEM * 2;

const moeda = (valor: number): string => valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantidade = (valor: number): string => valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const dataBr = (iso: string): string => (iso ? iso.split('-').reverse().join('/') : '');

export const formatarChave = (chave: string): string => chave.replace(/(\d{4})(?=\d)/g, '$1 ').trim();

export const formatarDocumento = (documento: string): string => {
  if (documento.length === 14) return documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (documento.length === 11) return documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return documento;
};

const formatarCep = (cep: string): string => cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');

const MODALIDADE_FRETE: Record<string, string> = {
  '0': '0 - Emitente', '1': '1 - Destinatário', '2': '2 - Terceiros', '3': '3 - Próprio (remetente)', '4': '4 - Próprio (destinatário)', '9': '9 - Sem frete',
};

/** Codigo de barras Code 128 da chave, como imagem. Vazio fora do navegador. */
const barrasDaChave = (chave: string): string | null => {
  if (typeof document === 'undefined' || chave.length !== 44) return null;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, chave, { format: 'CODE128C', displayValue: false, width: 2, height: 60, margin: 0 });
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
};

/** Caixa com rotulo pequeno em cima e valor embaixo, como no DANFE. */
const caixa = (doc: jsPDF, x: number, y: number, largura: number, altura: number, rotulo: string, valor: string, opcoes: { alinhar?: 'left' | 'right' | 'center'; negrito?: boolean; tamanho?: number } = {}) => {
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.rect(x, y, largura, altura);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(60);
  doc.text(rotulo.toUpperCase(), x + 1, y + 2.4);
  doc.setTextColor(0);
  doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal');
  doc.setFontSize(opcoes.tamanho ?? 8);
  const alinhar = opcoes.alinhar ?? 'left';
  const posX = alinhar === 'left' ? x + 1 : alinhar === 'right' ? x + largura - 1 : x + largura / 2;
  const linhas = doc.splitTextToSize(valor || '', largura - 2) as string[];
  doc.text(linhas.slice(0, Math.max(1, Math.floor((altura - 3) / 3.2))), posX, y + 6, { align: alinhar });
};

const titulo = (doc: jsPDF, y: number, texto: string): number => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0);
  doc.text(texto.toUpperCase(), MARGEM, y + 2.5);
  return y + 3.5;
};

/** Desenha o DANFE e devolve o PDF. */
export const gerarDanfePdf = (nota: NotaParseada): jsPDF => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const emit = nota.emitente;
  const dest = nota.destinatario;
  let y = MARGEM;

  // --- Cabecalho: emitente | DANFE | chave ---------------------------------
  const alturaCab = 34;
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  doc.rect(MARGEM, y, 80, alturaCab);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  const nomeEmit = doc.splitTextToSize(emit.nome || '', 76) as string[];
  doc.text(nomeEmit.slice(0, 2), MARGEM + 2, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const e = emit.endereco;
  const enderecoEmit = [
    `${e.logradouro}${e.numero ? `, ${e.numero}` : ''}${e.complemento ? ` ${e.complemento}` : ''}`,
    `${e.bairro}${e.cep ? ` - CEP ${formatarCep(e.cep)}` : ''}`,
    `${e.municipio}${e.uf ? ` - ${e.uf}` : ''}${e.telefone ? `  Fone: ${e.telefone}` : ''}`,
  ].filter((linha) => linha.trim());
  doc.text(enderecoEmit, MARGEM + 2, y + 6 + nomeEmit.slice(0, 2).length * 4);

  const xDanfe = MARGEM + 80;
  doc.rect(xDanfe, y, 30, alturaCab);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('DANFE', xDanfe + 15, y + 6, { align: 'center' });
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.text(doc.splitTextToSize('Documento Auxiliar da Nota Fiscal Eletrônica', 27) as string[], xDanfe + 15, y + 10, { align: 'center' });
  doc.setFontSize(7);
  doc.text('0 - ENTRADA', xDanfe + 3, y + 18);
  doc.text('1 - SAÍDA', xDanfe + 3, y + 21.5);
  doc.rect(xDanfe + 21, y + 15, 6, 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(nota.tipoOperacao || '1', xDanfe + 24, y + 20, { align: 'center' });
  doc.setFontSize(8);
  doc.text(`Nº ${nota.numero.padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.')}`, xDanfe + 15, y + 27, { align: 'center' });
  doc.text(`SÉRIE ${nota.serie}`, xDanfe + 15, y + 31, { align: 'center' });

  const xChave = xDanfe + 30;
  const larguraChave = LARGURA - 110;
  doc.rect(xChave, y, larguraChave, alturaCab);
  const barras = barrasDaChave(nota.chave);
  if (barras) doc.addImage(barras, 'PNG', xChave + 2, y + 2, larguraChave - 4, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(60);
  doc.text('CHAVE DE ACESSO', xChave + 1, y + 16);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(formatarChave(nota.chave) || 'Chave não informada no XML', xChave + larguraChave / 2, y + 20, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(doc.splitTextToSize('Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da SEFAZ Autorizadora', larguraChave - 2) as string[], xChave + 1, y + 25);
  y += alturaCab;

  const metade = LARGURA / 2;
  caixa(doc, MARGEM, y, metade + 10, 9, 'Natureza da operação', nota.naturezaOperacao);
  caixa(doc, MARGEM + metade + 10, y, metade - 10, 9, 'Protocolo de autorização de uso', nota.protocolo ? `${nota.protocolo}${nota.dataAutorizacao ? `  ${dataBr(nota.dataAutorizacao.split('T')[0])}` : ''}` : '');
  y += 9;
  const terco = LARGURA / 3;
  caixa(doc, MARGEM, y, terco, 9, 'Inscrição estadual', emit.inscricaoEstadual);
  caixa(doc, MARGEM + terco, y, terco, 9, 'Inscrição estadual do subst. trib.', '');
  caixa(doc, MARGEM + terco * 2, y, terco, 9, 'CNPJ / CPF', formatarDocumento(emit.documento));
  y += 9;

  // --- Destinatario -----------------------------------------------------------
  y = titulo(doc, y + 1, 'Destinatário / Remetente');
  const de = dest.endereco;
  caixa(doc, MARGEM, y, LARGURA - 70, 9, 'Nome / Razão social', dest.nome);
  caixa(doc, MARGEM + LARGURA - 70, y, 40, 9, 'CNPJ / CPF', formatarDocumento(dest.documento));
  caixa(doc, MARGEM + LARGURA - 30, y, 30, 9, 'Data da emissão', dataBr(nota.dataEmissao));
  y += 9;
  caixa(doc, MARGEM, y, LARGURA - 100, 9, 'Endereço', `${de.logradouro}${de.numero ? `, ${de.numero}` : ''}`);
  caixa(doc, MARGEM + LARGURA - 100, y, 40, 9, 'Bairro / Distrito', de.bairro);
  caixa(doc, MARGEM + LARGURA - 60, y, 30, 9, 'CEP', formatarCep(de.cep));
  caixa(doc, MARGEM + LARGURA - 30, y, 30, 9, 'Data da saída', dataBr(nota.dataSaida));
  y += 9;
  caixa(doc, MARGEM, y, LARGURA - 110, 9, 'Município', de.municipio);
  caixa(doc, MARGEM + LARGURA - 110, y, 30, 9, 'Fone', de.telefone);
  caixa(doc, MARGEM + LARGURA - 80, y, 10, 9, 'UF', de.uf);
  caixa(doc, MARGEM + LARGURA - 70, y, 40, 9, 'Inscrição estadual', dest.inscricaoEstadual);
  caixa(doc, MARGEM + LARGURA - 30, y, 30, 9, 'Hora da saída', '');
  y += 9;

  // --- Fatura / duplicatas -----------------------------------------------------
  if (nota.duplicatas.length > 0) {
    y = titulo(doc, y + 1, 'Fatura / Duplicatas');
    const porLinha = 5;
    const larguraDup = LARGURA / porLinha;
    nota.duplicatas.slice(0, 15).forEach((duplicata, indice) => {
      const coluna = indice % porLinha;
      if (coluna === 0 && indice > 0) y += 8;
      caixa(doc, MARGEM + coluna * larguraDup, y, larguraDup, 8, `Nº ${duplicata.numero}`, `${dataBr(duplicata.vencimento)}  R$ ${moeda(duplicata.valor)}`, { tamanho: 7 });
    });
    y += 8;
  }

  // --- Calculo do imposto --------------------------------------------------------
  y = titulo(doc, y + 1, 'Cálculo do imposto');
  const t = nota.totais;
  const quinto = LARGURA / 5;
  const linhaImposto = (rotulos: [string, number][]) => {
    rotulos.forEach(([rotulo, valor], indice) => caixa(doc, MARGEM + indice * quinto, y, quinto, 9, rotulo, moeda(valor), { alinhar: 'right' }));
    y += 9;
  };
  linhaImposto([['Base de cálc. do ICMS', t.baseIcms], ['Valor do ICMS', t.icms], ['Base de cálc. ICMS subst.', t.baseSt], ['Valor do ICMS subst.', t.st], ['Valor total dos produtos', t.produtos]]);
  linhaImposto([['Valor do frete', t.frete], ['Valor do seguro', t.seguro], ['Desconto', t.desconto], ['Outras despesas acessórias', t.outrasDespesas], ['Valor do IPI', t.ipi]]);
  caixa(doc, MARGEM, y, LARGURA, 9, 'Valor total da nota', `R$ ${moeda(t.total)}`, { alinhar: 'right', negrito: true, tamanho: 10 });
  y += 9;

  // --- Transportador -------------------------------------------------------------
  const tr = nota.transporte;
  y = titulo(doc, y + 1, 'Transportador / Volumes transportados');
  caixa(doc, MARGEM, y, LARGURA - 90, 9, 'Nome / Razão social', tr.transportadoraNome);
  caixa(doc, MARGEM + LARGURA - 90, y, 32, 9, 'Frete por conta', MODALIDADE_FRETE[tr.modalidadeFrete] ?? tr.modalidadeFrete, { tamanho: 6.5 });
  caixa(doc, MARGEM + LARGURA - 58, y, 22, 9, 'Placa do veículo', tr.placa);
  caixa(doc, MARGEM + LARGURA - 36, y, 36, 9, 'CNPJ / CPF', formatarDocumento(tr.transportadoraDocumento));
  y += 9;
  caixa(doc, MARGEM, y, LARGURA - 70, 9, 'Endereço', tr.transportadoraEndereco);
  caixa(doc, MARGEM + LARGURA - 70, y, 30, 9, 'Município', tr.transportadoraMunicipio);
  caixa(doc, MARGEM + LARGURA - 40, y, 8, 9, 'UF', tr.transportadoraUf);
  caixa(doc, MARGEM + LARGURA - 32, y, 32, 9, 'Inscrição estadual', tr.transportadoraIe);
  y += 9;
  const volume = tr.volumes[0];
  const sexto = LARGURA / 6;
  const totalVolumes = tr.volumes.reduce((soma, v) => soma + v.quantidade, 0);
  [['Quantidade', totalVolumes ? quantidade(totalVolumes) : ''], ['Espécie', volume?.especie ?? ''], ['Marca', volume?.marca ?? ''], ['Numeração', volume?.numeracao ?? ''], ['Peso bruto', volume ? quantidade(volume.pesoBruto) : ''], ['Peso líquido', volume ? quantidade(volume.pesoLiquido) : '']]
    .forEach(([rotulo, valor], indice) => caixa(doc, MARGEM + indice * sexto, y, sexto, 9, rotulo, valor));
  y += 9;

  // --- Itens ------------------------------------------------------------------------
  y = titulo(doc, y + 1, 'Dados dos produtos / serviços');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGEM, right: MARGEM, bottom: 22 },
    theme: 'grid',
    styles: { fontSize: 6.5, cellPadding: 0.8, lineColor: [0, 0, 0], lineWidth: 0.15, textColor: 0, overflow: 'linebreak' },
    headStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold', fontSize: 6 },
    head: [['Código', 'Descrição do produto / serviço', 'NCM/SH', 'O/CST', 'CFOP', 'UN', 'Quant.', 'V. unit.', 'V. total', 'BC ICMS', 'V. ICMS', 'V. IPI', 'Alíq. ICMS', 'Alíq. IPI']],
    body: nota.itens.map((item) => [
      item.codigo,
      item.descricao + (item.informacaoAdicional ? `\n${item.informacaoAdicional}` : ''),
      item.ncm,
      `${item.icms.origem}${item.icms.situacao}`,
      item.cfop,
      item.unidade,
      quantidade(item.quantidade),
      moeda(item.valorUnitario),
      moeda(item.valorProduto),
      moeda(item.icms.base),
      moeda(item.icms.valor),
      moeda(item.ipi.valor),
      moeda(item.icms.aliquota),
      moeda(item.ipi.aliquota),
    ]),
    columnStyles: {
      0: { cellWidth: 16 }, 1: { cellWidth: 49 }, 2: { cellWidth: 15 }, 3: { cellWidth: 9 }, 4: { cellWidth: 9 }, 5: { cellWidth: 7 },
      6: { halign: 'right', cellWidth: 12 }, 7: { halign: 'right', cellWidth: 13 }, 8: { halign: 'right', cellWidth: 13 },
      9: { halign: 'right', cellWidth: 12 }, 10: { halign: 'right', cellWidth: 11 }, 11: { halign: 'right', cellWidth: 10 },
      12: { halign: 'right', cellWidth: 9 }, 13: { halign: 'right', cellWidth: 9 },
    },
  });

  // --- Dados adicionais ------------------------------------------------------------
  const finalTabela = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let yAdicional = finalTabela + 2;
  if (yAdicional > 297 - MARGEM - 30) {
    doc.addPage();
    yAdicional = MARGEM;
  }
  yAdicional = titulo(doc, yAdicional, 'Dados adicionais');
  caixa(doc, MARGEM, yAdicional, LARGURA, 26, 'Informações complementares', nota.informacoesComplementares, { tamanho: 7 });

  // --- Rodape em todas as folhas ----------------------------------------------------
  const paginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    doc.text(`DANFE gerado a partir do XML da nota — Folha ${pagina}/${paginas}`, 105, 293, { align: 'center' });
  }
  return doc;
};

export const nomeDoArquivoDanfe = (nota: Pick<NotaParseada, 'numero' | 'serie'>): string => (
  `DANFE-${nota.numero || 'sem-numero'}${nota.serie ? `-serie-${nota.serie}` : ''}.pdf`
);
