import { jsPDF } from 'jspdf';
import {
  dataPorExtenso,
  formatarDataBr,
  localEData,
  reaisFormatado,
  type CarneDocumento,
  type DuplicataDocumento,
  type ParcelaDocumento,
  type ParteDocumento,
  type PromissoriaDocumento,
  type ReciboDocumento,
} from './documentosCobrancaDomain';

/*
 * DOCUMENTOS DE COBRANCA EM PDF (Configuracoes por filial, fase D -- 2026-10-07).
 *
 * Os dados (valor por extenso, numeracao N/total, partes) vem prontos de
 * documentosCobrancaDomain.ts; aqui so' se desenha, no mesmo padrao do
 * boletoPdf.ts (jsPDF, A4 retrato, milimetros). Cada funcao devolve um Blob
 * para o PdfVisualizador. `vias` repete o documento em sequencia, rotulado
 * "1ª via", "2ª via"... Blocos de altura fixa, dois ou quatro por folha,
 * com linha de corte tracejada entre eles.
 */

const MARGEM = 10;
const LARGURA = 190;
const LIMITE_Y = 287;
const ALTURA_PROMISSORIA = 118;
const ALTURA_DUPLICATA = 125;
const ALTURA_RECIBO = 118;
const ALTURA_CARNE = 62;

const pad = (n: number) => String(n).padStart(2, '0');
const alturaLinha = (tamanhoPt: number) => tamanhoPt * 0.42;
const rotuloVia = (via: number, vias: number) => (vias > 1 ? `${via}ª via` : '');
const descricaoParte = (p: ParteDocumento) => [p.endereco, p.cidadeUf].filter(Boolean).join(' - ');

const escrever = (doc: jsPDF, s: string, x: number, y: number, o: { tamanho?: number; negrito?: boolean; alinhar?: 'left' | 'center' | 'right' } = {}) => {
  doc.setFont('helvetica', o.negrito ? 'bold' : 'normal');
  doc.setFontSize(o.tamanho ?? 9);
  doc.text(s, x, y, { align: o.alinhar ?? 'left' });
};

/** Paragrafo com quebra automatica; devolve o y da proxima linha livre. */
const paragrafo = (doc: jsPDF, s: string, x: number, y: number, largura: number, o: { tamanho?: number; negrito?: boolean; maxLinhas?: number } = {}): number => {
  const tamanho = o.tamanho ?? 9;
  doc.setFont('helvetica', o.negrito ? 'bold' : 'normal');
  doc.setFontSize(tamanho);
  let linhas: string[] = doc.splitTextToSize(s, largura);
  if (o.maxLinhas && linhas.length > o.maxLinhas) {
    linhas = linhas.slice(0, o.maxLinhas);
    linhas[linhas.length - 1] = `${linhas[linhas.length - 1].replace(/\s+\S*$/, '')}…`;
  }
  doc.text(linhas, x, y);
  return y + linhas.length * alturaLinha(tamanho);
};

const caixa = (doc: jsPDF, x: number, y: number, w: number, h: number, rotulo: string, valor: string, o: { negrito?: boolean; tamanho?: number } = {}) => {
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);
  escrever(doc, rotulo, x + 1.5, y + 3.2, { tamanho: 6.5 });
  escrever(doc, valor, x + 1.5, y + h - 2.4, { tamanho: o.tamanho ?? 9.5, negrito: o.negrito ?? true });
};

const linhaCorte = (doc: jsPDF, y: number) => {
  doc.setLineDashPattern([2, 1.5], 0);
  doc.setLineWidth(0.2);
  doc.line(MARGEM, y, MARGEM + LARGURA, y);
  doc.setLineDashPattern([], 0);
};

const linhaAssinatura = (doc: jsPDF, x: number, y: number, w: number, legenda: string) => {
  doc.setLineWidth(0.3);
  doc.line(x, y, x + w, y);
  escrever(doc, legenda, x + w / 2, y + 3.5, { tamanho: 7.5, alinhar: 'center' });
};

/** Encaixa blocos de altura fixa de cima pra baixo, pulando de folha quando nao cabe. */
class Folha {
  readonly doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  private y = MARGEM;
  private vazia = true;

  reservar(altura: number): number {
    if (!this.vazia && this.y + altura > LIMITE_Y) {
      this.doc.addPage();
      this.y = MARGEM;
    } else if (!this.vazia) {
      linhaCorte(this.doc, this.y - 3);
    }
    const topo = this.y;
    this.y += altura + 6;
    this.vazia = false;
    return topo;
  }

  /** Cada tipo de documento comeca em folha propria. */
  novaFolha() {
    if (this.vazia) return;
    this.doc.addPage();
    this.y = MARGEM;
    this.vazia = true;
  }

  blob(): Blob {
    return this.doc.output('blob');
  }
}

const desenharPromissoria = (doc: jsPDF, p: PromissoriaDocumento, y: number, via: string) => {
  const x = MARGEM;
  const w = LARGURA;
  const h = ALTURA_PROMISSORIA;
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);
  escrever(doc, 'NOTA PROMISSÓRIA', x + 5, y + 10, { tamanho: 14, negrito: true });
  escrever(doc, `Nº ${p.numero}`, x + 5, y + 16, { tamanho: 10, negrito: true });
  if (via) escrever(doc, via, x + 32, y + 16, { tamanho: 8 });
  caixa(doc, x + w - 90, y + 5, 42, 13, 'Vencimento', formatarDataBr(p.vencimento), { tamanho: 11 });
  caixa(doc, x + w - 46, y + 5, 41, 13, 'Valor R$', reaisFormatado(p.valorCentavos), { tamanho: 11 });
  doc.setLineWidth(0.3);
  doc.line(x, y + 21, x + w, y + 21);

  let yy = y + 29;
  const beneficiario = `${p.beneficiario.nome}${p.beneficiario.documento ? `, CNPJ ${p.beneficiario.documento}` : ''}`;
  const quando = p.vencimento ? `Em ${dataPorExtenso(p.vencimento)}` : 'À vista';
  yy = paragrafo(doc, `${quando}, pagarei(emos) por esta única via de NOTA PROMISSÓRIA a ${beneficiario}, ou à sua ordem, a quantia de ${p.valorExtenso} (${reaisFormatado(p.valorCentavos)}), em moeda corrente deste país.`, x + 5, yy, w - 10, { tamanho: 10 });
  yy += 2;
  yy = paragrafo(doc, `Pagável em ${p.praca || '______________________'}.  ${p.referencia}.`, x + 5, yy, w - 10, { tamanho: 9 });
  yy += 4;
  escrever(doc, 'EMITENTE', x + 5, yy, { tamanho: 6.5 });
  yy += 4.5;
  escrever(doc, p.emitente.nome || '______________________________', x + 5, yy, { tamanho: 10, negrito: true });
  if (p.emitente.documento) escrever(doc, `CPF/CNPJ ${p.emitente.documento}`, x + w - 5, yy, { tamanho: 9, alinhar: 'right' });
  yy += 5;
  if (descricaoParte(p.emitente)) yy = paragrafo(doc, descricaoParte(p.emitente), x + 5, yy, w - 10, { tamanho: 9, maxLinhas: 2 });
  if (p.mensagem) paragrafo(doc, p.mensagem, x + 5, yy + 2, w - 10, { tamanho: 8, maxLinhas: 3 });

  escrever(doc, localEData(p.praca, p.dataEmissao), x + 5, y + h - 7, { tamanho: 9 });
  linhaAssinatura(doc, x + w - 85, y + h - 9, 80, 'Assinatura do emitente');
};

const desenharDuplicata = (doc: jsPDF, d: DuplicataDocumento, y: number, via: string) => {
  const x = MARGEM;
  const w = LARGURA;
  const h = ALTURA_DUPLICATA;
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);
  escrever(doc, 'DUPLICATA DE VENDA MERCANTIL', x + 5, y + 9, { tamanho: 12, negrito: true });
  if (via) escrever(doc, via, x + w - 5, y + 9, { tamanho: 8, alinhar: 'right' });

  let yy = y + 16;
  escrever(doc, 'SACADOR (vendedor)', x + 5, yy, { tamanho: 6.5 });
  yy += 4;
  escrever(doc, d.sacador.nome, x + 5, yy, { tamanho: 10, negrito: true });
  yy += 4.5;
  if (d.sacador.documento) {
    escrever(doc, `CNPJ ${d.sacador.documento}`, x + 5, yy, { tamanho: 8.5 });
    yy += 4;
  }
  if (descricaoParte(d.sacador)) paragrafo(doc, descricaoParte(d.sacador), x + 5, yy, 108, { tamanho: 8.5, maxLinhas: 2 });

  caixa(doc, x + 120, y + 14, 23, 11, 'Emissão', formatarDataBr(d.dataEmissao), { tamanho: 8.5, negrito: false });
  caixa(doc, x + 143, y + 14, 20, 11, 'Fatura nº', d.fatura, { tamanho: 8.5, negrito: false });
  caixa(doc, x + 163, y + 14, 27, 11, 'Valor da fatura R$', reaisFormatado(d.valorFaturaCentavos), { tamanho: 8.5, negrito: false });
  caixa(doc, x + 120, y + 25, 23, 11, 'Duplicata nº', d.numero, { tamanho: 8.5 });
  caixa(doc, x + 143, y + 25, 20, 11, 'Vencimento', formatarDataBr(d.vencimento), { tamanho: 8.5 });
  caixa(doc, x + 163, y + 25, 27, 11, 'Valor R$', reaisFormatado(d.valorCentavos), { tamanho: 9.5 });
  doc.setLineWidth(0.3);
  doc.line(x, y + 40, x + w, y + 40);

  yy = y + 45;
  escrever(doc, 'SACADO (comprador)', x + 5, yy, { tamanho: 6.5 });
  yy += 4;
  escrever(doc, d.sacado.nome, x + 5, yy, { tamanho: 10, negrito: true });
  escrever(doc, `CNPJ ${d.sacado.documento}`, x + w - 5, yy, { tamanho: 9, alinhar: 'right' });
  yy += 4.5;
  if (descricaoParte(d.sacado)) yy = paragrafo(doc, descricaoParte(d.sacado), x + 5, yy, w - 10, { tamanho: 8.5, maxLinhas: 2 });
  yy += 2;
  escrever(doc, `Praça de pagamento: ${d.praca || '______________________'}`, x + 5, yy, { tamanho: 8.5 });
  yy += 6;
  yy = paragrafo(doc, `Valor por extenso: ${d.valorExtenso}.`, x + 5, yy, w - 10, { tamanho: 9, negrito: true });
  yy += 3;
  paragrafo(doc, `Reconheço(emos) a exatidão desta DUPLICATA DE VENDA MERCANTIL, na importância acima, que pagarei(emos) a ${d.sacador.nome}, ou à sua ordem, na praça e no vencimento indicados.`, x + 5, yy, w - 10, { tamanho: 8.5, maxLinhas: 3 });

  escrever(doc, 'Data do aceite: ____/____/________', x + 5, y + h - 7, { tamanho: 9 });
  linhaAssinatura(doc, x + w - 85, y + h - 9, 80, 'Assinatura do sacado');
};

const desenharParcelaCarne = (doc: jsPDF, c: CarneDocumento, p: ParcelaDocumento, y: number, via: string) => {
  const x = MARGEM;
  const w = LARGURA;
  const h = ALTURA_CARNE;
  const wCanhoto = 58;
  doc.setLineWidth(0.4);
  doc.rect(x, y, w, h);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(x + wCanhoto, y, x + wCanhoto, y + h);
  doc.setLineDashPattern([], 0);

  const numero = `Parcela ${pad(p.numero)}/${pad(p.total)}`;
  // Canhoto: fica com a empresa quando a parcela e' paga no balcao.
  escrever(doc, 'CANHOTO', x + 3, y + 5, { tamanho: 6.5 });
  escrever(doc, numero, x + 3, y + 10.5, { tamanho: 10, negrito: true });
  escrever(doc, `Vencimento: ${formatarDataBr(p.vencimento)}`, x + 3, y + 17, { tamanho: 8.5 });
  escrever(doc, `Valor: ${reaisFormatado(p.valorCentavos)}`, x + 3, y + 22.5, { tamanho: 9.5, negrito: true });
  paragrafo(doc, `Cliente: ${c.cliente.nome}`, x + 3, y + 29, wCanhoto - 6, { tamanho: 8, maxLinhas: 2 });
  escrever(doc, `Pedido nº ${c.venda.numeroPedido}`, x + 3, y + 38.5, { tamanho: 8 });
  escrever(doc, 'Recebido em ____/____/________', x + 3, y + 47, { tamanho: 8 });
  linhaAssinatura(doc, x + 3, y + h - 7, wCanhoto - 6, 'Visto');

  // Corpo: fica com o cliente.
  const cx = x + wCanhoto + 4;
  const cw = w - wCanhoto - 8;
  escrever(doc, c.empresa.nome, cx, y + 6.5, { tamanho: 10.5, negrito: true });
  escrever(doc, numero, cx + cw, y + 6.5, { tamanho: 10.5, negrito: true, alinhar: 'right' });
  if (via) escrever(doc, via, cx + cw, y + 10.5, { tamanho: 7, alinhar: 'right' });
  const linhaEmpresa = [c.empresa.documento ? `CNPJ ${c.empresa.documento}` : '', descricaoParte(c.empresa), c.empresa.telefone].filter(Boolean).join(' - ');
  if (linhaEmpresa) paragrafo(doc, linhaEmpresa, cx, y + 10.5, cw - 18, { tamanho: 7, maxLinhas: 2 });
  caixa(doc, cx, y + 19, 36, 11, 'Vencimento', formatarDataBr(p.vencimento), { tamanho: 10 });
  caixa(doc, cx + 38, y + 19, 36, 11, 'Valor R$', reaisFormatado(p.valorCentavos), { tamanho: 10 });
  caixa(doc, cx + 76, y + 19, cw - 76, 11, 'Referente', `Pedido de venda nº ${c.venda.numeroPedido}`, { tamanho: 8.5, negrito: false });
  let yy = y + 36;
  escrever(doc, `Cliente: ${c.cliente.nome}${c.cliente.documento ? `  -  CPF/CNPJ ${c.cliente.documento}` : ''}`, cx, yy, { tamanho: 8.5, negrito: true });
  yy += 4.5;
  if (descricaoParte(c.cliente)) yy = paragrafo(doc, descricaoParte(c.cliente), cx, yy, cw, { tamanho: 8, maxLinhas: 1 });
  if (c.mensagem) paragrafo(doc, c.mensagem, cx, yy + 1, cw, { tamanho: 7.5, maxLinhas: 2 });
  escrever(doc, 'Recebemos em ____/____/________', cx, y + h - 5, { tamanho: 8 });
  linhaAssinatura(doc, cx + cw - 70, y + h - 7, 70, 'Assinatura / carimbo');
};

const desenharRecibo = (doc: jsPDF, r: ReciboDocumento, y: number, via: string) => {
  const x = MARGEM;
  const w = LARGURA;
  const h = ALTURA_RECIBO;
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, h);
  escrever(doc, 'RECIBO', x + 5, y + 11, { tamanho: 16, negrito: true });
  escrever(doc, `Nº ${r.numero}`, x + 5, y + 17, { tamanho: 9 });
  if (via) escrever(doc, via, x + 32, y + 17, { tamanho: 8 });
  caixa(doc, x + w - 56, y + 5, 51, 13, 'Valor R$', reaisFormatado(r.valorCentavos), { tamanho: 12 });
  doc.setLineWidth(0.3);
  doc.line(x, y + 21, x + w, y + 21);

  let yy = y + 30;
  const pagador = `${r.pagador.nome}${r.pagador.documento ? `, CPF/CNPJ ${r.pagador.documento}` : ''}`;
  const acrescimo = r.acrescimoCentavos > 0 ? `, já incluídos ${reaisFormatado(r.acrescimoCentavos)} de juros e multa por atraso` : '';
  const forma = r.formaPagamento ? `, em ${r.formaPagamento}` : '';
  yy = paragrafo(doc, `Recebi(emos) de ${pagador} a importância de ${r.valorExtenso} (${reaisFormatado(r.valorCentavos)}), referente a ${r.referente}${acrescimo}${forma}.`, x + 5, yy, w - 10, { tamanho: 10 });
  yy += 2;
  yy = paragrafo(doc, 'Para maior clareza, firmo(amos) o presente recibo, dando quitação do valor acima.', x + 5, yy, w - 10, { tamanho: 9 });
  if (descricaoParte(r.pagador)) yy = paragrafo(doc, `Endereço do pagador: ${descricaoParte(r.pagador)}`, x + 5, yy + 2, w - 10, { tamanho: 8, maxLinhas: 2 });
  if (r.mensagem) paragrafo(doc, r.mensagem, x + 5, yy + 2, w - 10, { tamanho: 8, maxLinhas: 3 });

  const praca = r.emitente.cidadeUf.split(' - CEP')[0];
  escrever(doc, localEData(praca, r.data), x + 5, y + h - 7, { tamanho: 9 });
  linhaAssinatura(doc, x + w - 95, y + h - 14, 90, r.emitente.nome || 'Assinatura');
  const rodapeEmitente = [r.emitente.documento ? `CNPJ ${r.emitente.documento}` : '', r.emitente.telefone].filter(Boolean).join(' - ');
  if (rodapeEmitente) escrever(doc, rodapeEmitente, x + w - 50, y + h - 6.5, { tamanho: 7, alinhar: 'center' });
};

/** Recibo de pagamento (Contas a Receber), `vias` copias empilhadas, duas por folha. */
export const gerarPdfRecibo = (recibo: ReciboDocumento, vias = 1): Blob => {
  const folha = new Folha();
  const total = Math.max(1, vias);
  for (let via = 1; via <= total; via++) desenharRecibo(folha.doc, recibo, folha.reservar(ALTURA_RECIBO), rotuloVia(via, total));
  return folha.blob();
};

export interface DocumentosDaVendaPdf {
  promissorias?: PromissoriaDocumento[];
  carne?: CarneDocumento;
  duplicatas?: DuplicataDocumento[];
  vias?: Partial<Record<'promissoria' | 'carne' | 'duplicata', number>>;
}

/** Um PDF so' com tudo que a venda a prazo pediu: promissorias, depois o carne, depois as duplicatas, cada tipo em folha propria. */
export const gerarPdfDocumentosDaVenda = (d: DocumentosDaVendaPdf): Blob => {
  const folha = new Folha();
  const vias = (chave: 'promissoria' | 'carne' | 'duplicata') => Math.max(1, Number(d.vias?.[chave]) || 1);
  if (d.promissorias && d.promissorias.length > 0) {
    folha.novaFolha();
    const n = vias('promissoria');
    for (const p of d.promissorias) {
      for (let via = 1; via <= n; via++) desenharPromissoria(folha.doc, p, folha.reservar(ALTURA_PROMISSORIA), rotuloVia(via, n));
    }
  }
  if (d.carne && d.carne.parcelas.length > 0) {
    folha.novaFolha();
    const n = vias('carne');
    for (let via = 1; via <= n; via++) {
      for (const p of d.carne.parcelas) desenharParcelaCarne(folha.doc, d.carne, p, folha.reservar(ALTURA_CARNE), rotuloVia(via, n));
    }
  }
  if (d.duplicatas && d.duplicatas.length > 0) {
    folha.novaFolha();
    const n = vias('duplicata');
    for (const dup of d.duplicatas) {
      for (let via = 1; via <= n; via++) desenharDuplicata(folha.doc, dup, folha.reservar(ALTURA_DUPLICATA), rotuloVia(via, n));
    }
  }
  return folha.blob();
};
