/*
 * Desenho do PDF de relatorio (jsPDF + autotable).
 *
 * Por que PDF gerado e nao window.print() de uma pagina HTML: a paginacao
 * fica sob controle nosso. A tela mostra exatamente as folhas que vao para a
 * impressora -- margem A4 fixa, cabecalho de coluna repetido em cada folha,
 * total so' no fim, "Pagina X de Y" -- e nao existe folha em branco no final
 * (o que acontecia com a .a4-page de min-height 297mm + margem do navegador).
 */
import { jsPDF } from 'jspdf';
import { __createTable, autoTable, type CellInput, type UserOptions } from 'jspdf-autotable';
import {
  caixaAltaRelatorio,
  colunaSomada,
  colunasEscolhidas,
  contarUnidade,
  escolherOrientacao,
  formatarCelulaRelatorio,
  formatarDataRelatorio,
  larguraEstimadaColunas,
  linhaTotalSecao,
  secoesVisiveis,
  tamanhoFonteTabela,
  type ColunaRelatorio,
  type IndicadorRelatorio,
  type PreferenciasRelatorio,
  type SecaoRelatorio,
} from './relatorioPdfDomain';

export interface EmpresaRelatorio {
  nome: string;
  cnpj?: string;
  telefone?: string;
  endereco?: string;
}

export interface DocumentoRelatorio {
  titulo: string;
  /** Ex: "Período: 01/09/2026 a 21/09/2026" */
  periodo?: string;
  /** Filtros aplicados na tela, ja' em texto ("Vendedor: Leo"). */
  filtros?: string[];
  empresa: EmpresaRelatorio;
  indicadores?: IndicadorRelatorio[];
  secoes: SecaoRelatorio[];
  geradoPor?: string;
}

type RGB = [number, number, number];

const COR_DESTAQUE: RGB = [76, 29, 149];
const COR_TEXTO: RGB = [17, 24, 39];
const COR_SUAVE: RGB = [107, 114, 128];
const COR_LINHA: RGB = [209, 213, 219];
const COR_CABECALHO_TABELA: RGB = [49, 46, 129];
const COR_ZEBRA: RGB = [248, 248, 251];
const COR_TOTAL: RGB = [237, 233, 254];
const COR_GRUPO: RGB = [243, 240, 255];

const MARGEM = 12;
const TOPO_CONTINUACAO = 22;
const RODAPE = 12;

const up = caixaAltaRelatorio;

const alinhamento = (coluna: ColunaRelatorio): 'left' | 'right' | 'center' => {
  if (coluna.tipo === 'moeda' || coluna.tipo === 'inteiro') return 'right';
  if (coluna.tipo === 'data' || coluna.tipo === 'dataHora') return 'center';
  return 'left';
};

const desenharCabecalhoPrincipal = (doc: jsPDF, dados: DocumentoRelatorio): number => {
  const largura = doc.internal.pageSize.getWidth();
  const direita = largura - MARGEM;
  let y = MARGEM + 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COR_TEXTO);
  const nomeEmpresa = doc.splitTextToSize(up(dados.empresa.nome || 'Empresa'), (largura - 2 * MARGEM) * 0.55);
  doc.text(nomeEmpresa, MARGEM, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR_SUAVE);
  let yEmpresa = y + 5 * nomeEmpresa.length;
  const linhasEmpresa = [
    [dados.empresa.cnpj && `CNPJ ${dados.empresa.cnpj}`, dados.empresa.telefone && `TEL. ${dados.empresa.telefone}`].filter(Boolean).join('   •   '),
    dados.empresa.endereco || '',
  ].filter(Boolean);
  linhasEmpresa.forEach((linha) => {
    const partes = doc.splitTextToSize(up(linha), (largura - 2 * MARGEM) * 0.55);
    doc.text(partes, MARGEM, yEmpresa);
    yEmpresa += 3.6 * partes.length;
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COR_DESTAQUE);
  doc.text(up(dados.titulo), direita, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COR_TEXTO);
  let yTitulo = y + 5.5;
  if (dados.periodo) {
    doc.text(up(dados.periodo), direita, yTitulo, { align: 'right' });
    yTitulo += 4.5;
  }

  y = Math.max(yEmpresa, yTitulo) + 1;
  doc.setDrawColor(...COR_DESTAQUE);
  doc.setLineWidth(0.6);
  doc.line(MARGEM, y, direita, y);
  y += 5;

  const filtros = (dados.filtros || []).filter(Boolean);
  if (filtros.length) {
    doc.setFontSize(7.5);
    doc.setTextColor(...COR_SUAVE);
    const texto = doc.splitTextToSize(up(`Filtros aplicados: ${filtros.join('   •   ')}`), largura - 2 * MARGEM);
    doc.text(texto, MARGEM, y);
    y += 3.6 * texto.length + 2;
  }
  return y;
};

const desenharIndicadores = (doc: jsPDF, indicadores: IndicadorRelatorio[], yInicial: number): number => {
  if (!indicadores.length) return yInicial;
  const largura = doc.internal.pageSize.getWidth() - 2 * MARGEM;
  const porLinha = doc.internal.pageSize.getWidth() > 250 ? 6 : 4;
  const espaco = 3;
  const larguraCaixa = (largura - espaco * (porLinha - 1)) / porLinha;
  const alturaCaixa = 13;
  let y = yInicial;
  indicadores.forEach((indicador, indice) => {
    const coluna = indice % porLinha;
    if (indice > 0 && coluna === 0) y += alturaCaixa + espaco;
    const x = MARGEM + coluna * (larguraCaixa + espaco);
    doc.setFillColor(250, 250, 252);
    doc.setDrawColor(...COR_LINHA);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, larguraCaixa, alturaCaixa, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COR_SUAVE);
    doc.text(up(indicador.rotulo), x + 3, y + 4.6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...COR_TEXTO);
    doc.text(doc.splitTextToSize(indicador.valor, larguraCaixa - 6)[0], x + 3, y + 10.2);
  });
  return y + alturaCaixa + 6;
};

const desenharTituloSecao = (doc: jsPDF, titulo: string, y: number): number => {
  doc.setFillColor(...COR_DESTAQUE);
  doc.rect(MARGEM, y - 3.4, 1.2, 4.6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COR_TEXTO);
  doc.text(up(titulo), MARGEM + 3.5, y);
  return y + 3;
};

/**
 * Linha de total pronta para a tabela: o rotulo ("TOTAL GERAL — 12 VENDAS")
 * ocupa tambem as colunas de texto vazias ao lado dele, em vez de quebrar em
 * duas linhas dentro de uma coluna estreita como "Pedido".
 */
const celulasTotal = (
  colunas: ColunaRelatorio[],
  linhas: any[],
  rotulo: string,
  estilo: Record<string, unknown> = {},
): CellInput[] => {
  const conteudos = linhaTotalSecao(colunas, linhas, rotulo);
  const indiceRotulo = colunas.findIndex((coluna) => !colunaSomada(coluna));
  const celulas: CellInput[] = [];
  for (let i = 0; i < colunas.length; i += 1) {
    if (i === indiceRotulo) {
      let span = 1;
      while (i + span < colunas.length && !colunaSomada(colunas[i + span])) span += 1;
      celulas.push({ content: conteudos[i], colSpan: span, styles: { ...estilo, halign: 'left' } });
      i += span - 1;
    } else {
      celulas.push({ content: conteudos[i], styles: { ...estilo, halign: alinhamento(colunas[i]) } });
    }
  }
  return celulas;
};

const celulasLinha = (colunas: ColunaRelatorio[], linha: any): CellInput[] => (
  colunas.map((coluna) => formatarCelulaRelatorio(coluna.valor(linha), coluna.tipo))
);

const agrupar = (secao: SecaoRelatorio): { rotulo: string; linhas: any[] }[] => {
  const grupos = new Map<string, { rotulo: string; linhas: any[] }>();
  secao.linhas.forEach((linha) => {
    const chave = secao.agruparPor!.chave(linha);
    const grupo = grupos.get(chave) || { rotulo: secao.agruparPor!.rotulo(linha), linhas: [] };
    grupo.linhas.push(linha);
    grupos.set(chave, grupo);
  });
  return Array.from(grupos.values());
};

const cabecalhoColunas = (colunas: ColunaRelatorio[]): CellInput[] => (
  colunas.map((coluna) => ({ content: up(coluna.titulo), styles: { halign: alinhamento(coluna) } }))
);

const ESTILO_SUBTOTAL = { fontStyle: 'bold', fillColor: [250, 250, 252] as RGB };

const desenharRodapes = (doc: jsPDF, dados: DocumentoRelatorio, geradoEm: Date) => {
  const total = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= total; pagina += 1) {
    doc.setPage(pagina);
    const largura = doc.internal.pageSize.getWidth();
    const altura = doc.internal.pageSize.getHeight();
    const direita = largura - MARGEM;

    if (pagina > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...COR_TEXTO);
      doc.text(up(dados.empresa.nome || ''), MARGEM, MARGEM + 3);
      doc.setTextColor(...COR_DESTAQUE);
      doc.text(up(dados.titulo), direita, MARGEM + 3, { align: 'right' });
      if (dados.periodo) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...COR_SUAVE);
        doc.text(up(dados.periodo), direita, MARGEM + 6.5, { align: 'right' });
      }
      doc.setDrawColor(...COR_LINHA);
      doc.setLineWidth(0.3);
      doc.line(MARGEM, MARGEM + 8, direita, MARGEM + 8);
    }

    const yLinha = altura - RODAPE + 2;
    doc.setDrawColor(...COR_LINHA);
    doc.setLineWidth(0.3);
    doc.line(MARGEM, yLinha, direita, yLinha);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COR_SUAVE);
    const gerado = `Hennder ERP  •  Gerado em ${formatarDataRelatorio(geradoEm, true)}${dados.geradoPor ? ` por ${dados.geradoPor}` : ''}`;
    doc.text(up(gerado), MARGEM, yLinha + 4);
    doc.text(`PÁGINA ${pagina} DE ${total}`, direita, yLinha + 4, { align: 'right' });
  }
};

export const gerarRelatorioPdf = (
  dados: DocumentoRelatorio,
  preferencias: PreferenciasRelatorio,
  geradoEm = new Date(),
): jsPDF => {
  const secoes = secoesVisiveis(dados.secoes, preferencias);
  const colunasPorSecao = secoes.map((secao) => colunasEscolhidas(secao, preferencias));
  const orientacao = escolherOrientacao(colunasPorSecao);
  const fonte = tamanhoFonteTabela(colunasPorSecao);

  const doc = new jsPDF({ orientation: orientacao, unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: dados.titulo, creator: 'Hennder ERP' });
  const alturaPagina = doc.internal.pageSize.getHeight();

  let y = desenharCabecalhoPrincipal(doc, dados);
  if (preferencias.indicadores && dados.indicadores?.length) {
    y = desenharIndicadores(doc, dados.indicadores, y);
  }

  const larguraUtil = doc.internal.pageSize.getWidth() - 2 * MARGEM;
  const limiteInferior = alturaPagina - RODAPE - 4;

  const opcoesTabela = (colunas: ColunaRelatorio[], larguras?: number[]): UserOptions => {
    // Coluna de texto ganha largura minima (ex: "CARTAO DE CREDITO" numa linha
    // so') quando o conjunto marcado cabe na folha; se nao cabe, a tabela
    // divide o espaco sozinha e nada sai cortado na lateral.
    const cabe = larguraEstimadaColunas(colunas) <= larguraUtil;
    return {
      margin: { left: MARGEM, right: MARGEM, top: TOPO_CONTINUACAO, bottom: RODAPE + 4 },
      theme: 'grid',
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
      styles: {
        font: 'helvetica',
        fontSize: fonte,
        cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 },
        lineColor: COR_LINHA,
        lineWidth: 0.15,
        textColor: COR_TEXTO,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: { fillColor: COR_CABECALHO_TABELA, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: fonte - 0.5 },
      footStyles: { fillColor: COR_TOTAL, textColor: COR_TEXTO, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COR_ZEBRA },
      columnStyles: Object.fromEntries(colunas.map((coluna, i) => {
        if (larguras) return [i, { halign: alinhamento(coluna), cellWidth: larguras[i] }];
        return [i, {
          halign: alinhamento(coluna),
          // Valor em reais nunca quebra no meio ("R$ 15.982," / "87").
          ...(colunaSomada(coluna) || coluna.tipo === 'data' || coluna.tipo === 'dataHora' ? { cellWidth: 'wrap' as const } : {}),
          ...(cabe && coluna.tipo === 'texto' && coluna.largura ? { minCellWidth: coluna.largura } : {}),
        }];
      })),
    };
  };

  const fimDaTabela = (anterior: number) => ((doc as any).lastAutoTable?.finalY ?? anterior);

  secoes.forEach((secao, indice) => {
    const colunas = colunasPorSecao[indice];
    // Titulo de secao nunca fica sozinho no pe' da folha -- nem com um bloco
    // agrupado que comecaria ali com uma linha so'.
    if (y > limiteInferior - (secao.agruparPor ? 48 : 30)) {
      doc.addPage();
      y = TOPO_CONTINUACAO + 4;
    }
    y = desenharTituloSecao(doc, secao.titulo, y + 2);

    const rotuloTotal = `${secao.rotuloTotal || 'Total geral'}  —  ${contarUnidade(secao.linhas.length, secao.unidade)}`;
    const totalGeral = celulasTotal(colunas, secao.linhas, rotuloTotal);

    if (secao.linhas.length === 0 || !secao.agruparPor) {
      autoTable(doc, {
        ...opcoesTabela(colunas),
        startY: y,
        head: [cabecalhoColunas(colunas)],
        body: secao.linhas.length === 0
          ? [[{ content: up(secao.mensagemVazia || 'Nenhum registro no período.'), colSpan: colunas.length, styles: { halign: 'center', textColor: COR_SUAVE, fontStyle: 'italic' } }]]
          : secao.linhas.map((linha) => celulasLinha(colunas, linha)),
        foot: secao.linhas.length === 0 ? undefined : [totalGeral],
      });
      y = fimDaTabela(y) + 8;
      return;
    }

    // AGRUPADA (ex: vendas de cada vendedor): cada grupo e' um bloco com o
    // nome do grupo e o cabecalho das colunas -- repetidos se o bloco
    // continuar na folha seguinte --, as linhas e o subtotal. Bloco novo nao
    // comeca no pe' da folha. As larguras sao medidas uma vez com TODAS as
    // linhas, para as colunas ficarem alinhadas de um bloco para o outro.
    const grupos = agrupar(secao);
    const medida = __createTable(doc, {
      ...opcoesTabela(colunas),
      startY: y,
      head: [cabecalhoColunas(colunas)],
      body: secao.linhas.map((linha) => celulasLinha(colunas, linha)),
      foot: [totalGeral],
    });
    const larguras = medida.columns.map((coluna) => coluna.width);

    grupos.forEach((grupo, indiceGrupo) => {
      if (indiceGrupo > 0 && y > limiteInferior - 38) {
        doc.addPage();
        y = TOPO_CONTINUACAO;
      }
      const ultimo = indiceGrupo === grupos.length - 1;
      autoTable(doc, {
        ...opcoesTabela(colunas, larguras),
        startY: y,
        head: [
          [{
            content: up(`${grupo.rotulo}  (${contarUnidade(grupo.linhas.length, secao.unidade)})`),
            colSpan: colunas.length,
            styles: { fillColor: COR_GRUPO, textColor: COR_DESTAQUE, fontStyle: 'bold', halign: 'left', fontSize: fonte + 0.5 },
          }],
          cabecalhoColunas(colunas),
        ],
        body: grupo.linhas.map((linha) => celulasLinha(colunas, linha)),
        foot: [
          celulasTotal(colunas, grupo.linhas, `Subtotal ${grupo.rotulo}`, ESTILO_SUBTOTAL),
          ...(ultimo ? [totalGeral] : []),
        ],
      });
      y = fimDaTabela(y) + (ultimo ? 8 : 4);
    });
  });

  if (secoes.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...COR_SUAVE);
    doc.text(up('Nenhuma coluna marcada para sair no relatório.'), MARGEM, y + 6);
  }

  desenharRodapes(doc, dados, geradoEm);
  return doc;
};
