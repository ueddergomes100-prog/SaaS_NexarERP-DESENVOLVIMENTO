import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';
import { formatarLinhaDigitavel } from './boletoDomain';

/*
 * BOLETO EM PDF (2026-09-25, estrutura refeita em 2026-09-28).
 *
 * O conteudo (codigo de barras, linha digitavel, DVs) e' calculado por
 * boletoCnabDomain.ts/boletoDomain.ts; aqui so' se desenha. O layout foi
 * conferido campo a campo, caixa a caixa, contra um boleto REAL da Sol Life
 * impresso pelo Sicoob (2026-09-28) -- inclusive as tres vias (Recibo do
 * Pagador, Recibo do Caixa e Ficha de Compensacao), que e' como o Sicoob
 * imprime, embora o padrao Febraban mais comum traga so' duas.
 */

export interface DadosPdfBoleto {
  bancoNome: string;
  /** "756-0" no Sicoob. */
  codigoBanco: string;
  /** Texto de "Local de pagamento" -- especifico de cada banco (Sicoob: "Pagável Preferenc. nas
   *  Cooperativas da Rede Sicoob", confirmado contra boleto real). */
  localPagamento: string;
  beneficiarioNome: string;
  /** CNPJ ja formatado (00.000.000/0000-00). */
  beneficiarioCnpj: string;
  /** Endereco do beneficiario (rua, numero, bairro, cidade/UF, CEP) ja formatado -- pode faltar
   *  cidade/UF se o cadastro da empresa nao tiver esses campos. */
  beneficiarioEndereco?: string;
  /** "3049/131877-2" -- agencia e codigo do beneficiario, sem espacos, do jeito que o Sicoob imprime. */
  agenciaCodigoBeneficiario: string;
  /** "01" -- so' o codigo da carteira, sem a modalidade junto. */
  carteira: string;
  pagadorNome: string;
  /** CPF/CNPJ ja formatado. */
  pagadorDocumento: string;
  pagadorRua?: string;
  pagadorBairro?: string;
  pagadorCep?: string;
  pagadorCidade?: string;
  pagadorUf?: string;
  numeroDocumento: string;
  /** Ja formatado pra exibicao ("918-4"), nao o valor cru com zeros a esquerda. */
  nossoNumero: string;
  /** AAAA-MM-DD. */
  vencimento: string;
  /** AAAA-MM-DD -- data da venda/nota. Se faltar, usa a data de emissao do boleto. */
  dataDocumento?: string;
  dataEmissao: string;
  valorCentavos: number;
  linhaDigitavel: string;
  codigoBarras: string;
  /** Mensagens (multa, mora, protesto) impressas no campo de instrucoes. */
  instrucoes: string[];
  /** Cabecalho opcional com os dados da propria empresa (nome/endereco/telefone), impresso uma vez
   *  no topo da folha -- como o sistema antigo imprimia. Sem isso, a folha comeca direto no boleto. */
  empresaHeader?: { nome: string; endereco?: string; telefone?: string };
}

const moeda = (centavos: number): string => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
const dataBr = (iso: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '');

const barrasItf = (codigo: string): string => {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, codigo, { format: 'ITF', displayValue: false, width: 2, height: 60, margin: 0 });
  return canvas.toDataURL('image/png');
};

const MARGEM_X = 10;
const LARGURA = 190;
const LARGURA_ESQUERDA = 130;
const LARGURA_DIREITA = 60;

const caixa = (
  doc: jsPDF,
  x: number,
  y: number,
  largura: number,
  altura: number,
  rotulo: string,
  valor: string,
  opcoes: { negrito?: boolean; direita?: boolean; fonteValor?: number } = {},
) => {
  doc.setDrawColor(120);
  doc.setLineWidth(0.2);
  doc.rect(x, y, largura, altura);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text(rotulo, x + 1.2, y + 2.6, { maxWidth: largura - 2.4 });
  doc.setTextColor(0);
  doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal');
  doc.setFontSize(opcoes.fonteValor ?? 7.8);
  const yValor = y + altura - 1.5;
  if (opcoes.direita) doc.text(valor, x + largura - 1.2, yValor, { align: 'right' });
  else doc.text(valor, x + 1.2, yValor, { maxWidth: largura - 2.4 });
};

/** Uma via completa do boleto (recibo do pagador / recibo do caixa / ficha de compensacao) --
 *  mesma grade nas tres, só o cabecalho (rotulo x linha digitavel) e o rodape (codigo de barras) mudam. */
const desenharVia = (
  doc: jsPDF,
  dados: DadosPdfBoleto,
  topo: number,
  opcoes: { rotuloVia: string; comLinhaDigitavel: boolean },
): number => {
  const x = MARGEM_X;
  const l = LARGURA;
  let y = topo;

  // Banco | codigo | rotulo da via (recibo) OU linha digitavel (ficha de compensacao)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(dados.bancoNome, x, y + 5.2);
  doc.setDrawColor(0);
  doc.setLineWidth(0.7);
  doc.line(x + 28, y + 0.8, x + 28, y + 6.8);
  doc.line(x + 30, y + 0.8, x + 30, y + 6.8);
  doc.setFontSize(11);
  doc.text(dados.codigoBanco, x + 33, y + 5.4);
  doc.line(x + 53, y + 0.8, x + 53, y + 6.8);
  doc.line(x + 55, y + 0.8, x + 55, y + 6.8);
  if (opcoes.comLinhaDigitavel) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.text(formatarLinhaDigitavel(dados.linhaDigitavel), x + l, y + 5.2, { align: 'right' });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(opcoes.rotuloVia, x + l, y + 5.2, { align: 'right' });
  }
  doc.setDrawColor(120);
  doc.setLineWidth(0.2);
  doc.line(x, y + 7.2, x + l, y + 7.2);
  y += 7.2;

  caixa(doc, x, y, LARGURA_ESQUERDA, 6.2, 'Local de pagamento', dados.localPagamento, { negrito: true, fonteValor: 7.2 });
  caixa(doc, x + LARGURA_ESQUERDA, y, LARGURA_DIREITA, 6.2, 'Vencimento', dataBr(dados.vencimento), { negrito: true, direita: true });
  y += 6.2;

  // Beneficiario: pode quebrar em duas linhas (nome + CNPJ + endereco, tudo numa string so').
  const beneficiarioAltura = 9;
  doc.setDrawColor(120);
  doc.setLineWidth(0.2);
  doc.rect(x, y, LARGURA_ESQUERDA, beneficiarioAltura);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text('Beneficiário', x + 1.2, y + 2.6);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  const linhaBeneficiario = [
    dados.beneficiarioNome,
    `CNPJ: ${dados.beneficiarioCnpj}`,
    dados.beneficiarioEndereco,
  ].filter(Boolean).join(', ');
  const linhasBeneficiario: string[] = doc.splitTextToSize(linhaBeneficiario, LARGURA_ESQUERDA - 2.4);
  doc.text(linhasBeneficiario.slice(0, 2), x + 1.2, y + 5.2);
  caixa(doc, x + LARGURA_ESQUERDA, y, LARGURA_DIREITA, beneficiarioAltura, 'Agência / Código do beneficiário', dados.agenciaCodigoBeneficiario, { direita: true });
  y += beneficiarioAltura;

  caixa(doc, x, y, 32, 6.2, 'Data do documento', dataBr(dados.dataDocumento || dados.dataEmissao));
  caixa(doc, x + 32, y, 42, 6.2, 'Nº do documento', dados.numeroDocumento);
  caixa(doc, x + 74, y, 20, 6.2, 'Espécie doc.', 'DM');
  caixa(doc, x + 94, y, 14, 6.2, 'Aceite', 'N');
  caixa(doc, x + 108, y, 22, 6.2, 'Data processamento', dataBr(dados.dataEmissao));
  caixa(doc, x + LARGURA_ESQUERDA, y, LARGURA_DIREITA, 6.2, 'Nosso número', dados.nossoNumero, { direita: true, negrito: true });
  y += 6.2;

  caixa(doc, x, y, 34, 6.2, 'Uso do banco', '');
  caixa(doc, x + 34, y, 22, 6.2, 'Carteira', dados.carteira);
  caixa(doc, x + 56, y, 24, 6.2, 'Espécie moeda', 'R$');
  caixa(doc, x + 80, y, 26, 6.2, 'Quantidade', '');
  caixa(doc, x + 106, y, 24, 6.2, 'Valor', 'X', { fonteValor: 7 });
  caixa(doc, x + LARGURA_ESQUERDA, y, LARGURA_DIREITA, 6.2, '(=) Valor do documento', moeda(dados.valorCentavos), { negrito: true, direita: true });
  y += 6.2;

  // Instrucoes (esquerda, alta) + coluna de 5 caixas de valor (direita) -- todas em branco ate' o
  // pagamento, exatamente como o Sicoob imprime no boleto ainda nao pago.
  const alturaInstrucoes = 17.5;
  doc.rect(x, y, LARGURA_ESQUERDA, alturaInstrucoes);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text('Instruções (texto de responsabilidade do beneficiário)', x + 1.2, y + 2.6);
  doc.setTextColor(0);
  doc.setFontSize(7.2);
  doc.setFont('helvetica', 'normal');
  dados.instrucoes.filter(Boolean).slice(0, 4).forEach((linha, i) => doc.text(linha, x + 1.5, y + 6 + i * 3.6));
  const rotulosValores = ['(-) Desconto / Abatimento', '(-) Outras deduções', '(+) Mora / Multa', '(+) Outros acréscimos', '(=) Valor cobrado'];
  const alturaCaixaValor = alturaInstrucoes / rotulosValores.length;
  rotulosValores.forEach((rotulo, i) => caixa(doc, x + LARGURA_ESQUERDA, y + i * alturaCaixaValor, LARGURA_DIREITA, alturaCaixaValor, rotulo, ''));
  y += alturaInstrucoes;

  // Pagador: nome, documento, endereco em grade (rua/numero ... bairro; CEP ... cidade ... UF),
  // Sacador/Avalista (sempre em branco) e "Código de baixa" no canto.
  const alturaPagador = 18;
  doc.rect(x, y, l, alturaPagador);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text('Pagador:', x + 1.2, y + 3);
  doc.text('Código de baixa', x + l - 1.2, y + 2.6, { align: 'right' });
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(dados.pagadorNome, x + 13, y + 3.2, { maxWidth: l - 15 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(90);
  doc.text('CNPJ/CPF:', x + 1.2, y + 6.6);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(dados.pagadorDocumento, x + 15, y + 6.7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  if (dados.pagadorRua) doc.text(dados.pagadorRua, x + 1.5, y + 10, { maxWidth: 110 });
  if (dados.pagadorBairro) doc.text(dados.pagadorBairro, x + 118, y + 10, { maxWidth: 65 });
  const cepCidade = [dados.pagadorCep ? `CEP: ${dados.pagadorCep}` : '', dados.pagadorCidade].filter(Boolean).join('   ');
  if (cepCidade) doc.text(cepCidade, x + 1.5, y + 13.4, { maxWidth: 140 });
  if (dados.pagadorUf) doc.text(dados.pagadorUf, x + l - 3, y + 13.4, { align: 'right' });
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text('Sacador/Avalista:', x + 1.2, y + 16.8);
  y += alturaPagador;

  // Autenticacao mecanica (linha curta + legenda), rodape de toda via.
  doc.setDrawColor(120);
  doc.line(x + l - 40, y + 3.4, x + l, y + 3.4);
  doc.setFontSize(6);
  doc.setTextColor(90);
  doc.text('Autenticação mecânica', x + l, y + 2.4, { align: 'right' });
  y += 4.5;

  return y;
};

const linhaDeCorte = (doc: jsPDF, y: number) => {
  doc.setDrawColor(120);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(MARGEM_X, y, MARGEM_X + LARGURA, y);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(120);
  doc.text('Corte na linha pontilhada', MARGEM_X + LARGURA, y + 3, { align: 'right' });
};

/** Cabecalho opcional com os dados da propria empresa, impresso uma vez no topo da folha. */
const desenharCabecalhoEmpresa = (doc: jsPDF, empresa: NonNullable<DadosPdfBoleto['empresaHeader']>, y: number): number => {
  let linha = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text(empresa.nome, MARGEM_X, linha);
  linha += 4.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(60);
  if (empresa.endereco) { doc.text(empresa.endereco, MARGEM_X, linha); linha += 3.8; }
  if (empresa.telefone) { doc.text(`Fone: ${empresa.telefone}`, MARGEM_X, linha); linha += 3.8; }
  return linha + 2;
};

/** PDF do boleto Sicoob: Recibo do Pagador, Recibo do Caixa e Ficha de Compensação (com código de
 *  barras) -- as tres vias que o Sicoob imprime pra cobranca registrada. */
const desenharBoleto = (doc: jsPDF, dados: DadosPdfBoleto) => {
  let y = 14;
  if (dados.empresaHeader?.nome) y = desenharCabecalhoEmpresa(doc, dados.empresaHeader, y);

  y = desenharVia(doc, dados, y, { rotuloVia: 'Recibo do Pagador', comLinhaDigitavel: false });
  linhaDeCorte(doc, y + 2);
  y += 8;

  y = desenharVia(doc, dados, y, { rotuloVia: 'Recibo do Caixa', comLinhaDigitavel: false });
  linhaDeCorte(doc, y + 2);
  y += 8;

  y = desenharVia(doc, dados, y, { rotuloVia: '', comLinhaDigitavel: true });

  doc.addImage(barrasItf(dados.codigoBarras), 'PNG', MARGEM_X, y + 2, 100, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text('Ficha de Compensação', MARGEM_X + LARGURA, y + 11, { align: 'right' });
};

export const gerarPdfBoleto = (dados: DadosPdfBoleto): Blob => gerarPdfBoletos([dados]);

/** Varios boletos num PDF so', um por pagina -- 2a via em lote (2026-09-30). */
export const gerarPdfBoletos = (lista: DadosPdfBoleto[]): Blob => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  lista.forEach((dados, indice) => {
    if (indice > 0) doc.addPage();
    desenharBoleto(doc, dados);
  });
  return doc.output('blob');
};
