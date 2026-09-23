/*
 * "Salvar em Excel" -- botao SEPARADO do relatorio (o padrao e' o PDF).
 *
 * Gera .xlsx com numero de verdade na celula (nao texto "600.00"): o CSV
 * antigo gravava o valor com ponto e o Excel em portugues lia como texto,
 * entao =SOMA nao funcionava (video da Taiene, Shopping Rural, 22/09/2026).
 * Sai com as mesmas colunas marcadas no PDF.
 */
import * as XLSX from 'xlsx';
import { fromCents } from './financeDomain';
import {
  colunaSomada,
  colunasEscolhidas,
  formatarDataRelatorio,
  secoesVisiveis,
  somarColuna,
  type ColunaRelatorio,
  type PreferenciasRelatorio,
} from './relatorioPdfDomain';
import type { DocumentoRelatorio } from './relatorioPdf';

const FORMATO_MOEDA = '"R$" #,##0.00';
const FORMATO_INTEIRO = '#,##0';

const valorExcel = (coluna: ColunaRelatorio, linha: any): string | number => {
  const valor = coluna.valor(linha);
  if (valor === null || valor === undefined || valor === '') return '';
  if (coluna.tipo === 'moeda') return fromCents(Number(valor) || 0);
  if (coluna.tipo === 'inteiro') return Number(valor) || 0;
  if (coluna.tipo === 'data' || coluna.tipo === 'dataHora') {
    const data = valor instanceof Date ? valor : new Date(valor);
    return Number.isNaN(data.getTime()) ? '' : formatarDataRelatorio(data, coluna.tipo === 'dataHora');
  }
  return String(valor);
};

const nomeAba = (titulo: string, usados: Set<string>) => {
  const base = titulo.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Relatório';
  let nome = base;
  let n = 2;
  while (usados.has(nome)) nome = `${base.slice(0, 26)} ${n++}`;
  usados.add(nome);
  return nome;
};

export const salvarRelatorioExcel = (
  dados: DocumentoRelatorio,
  preferencias: PreferenciasRelatorio,
  nomeArquivo: string,
) => {
  const livro = XLSX.utils.book_new();
  const usados = new Set<string>();

  secoesVisiveis(dados.secoes, preferencias).forEach((secao) => {
    const colunas = colunasEscolhidas(secao, preferencias);
    const cabecalho = [
      [dados.empresa.nome || ''],
      [`${dados.titulo} — ${secao.titulo}`],
      [dados.periodo || ''],
      [],
    ];
    const linhaTitulos = cabecalho.length;
    const linhas = secao.linhas.map((linha) => colunas.map((coluna) => valorExcel(coluna, linha)));
    const indiceRotulo = colunas.findIndex((coluna) => !colunaSomada(coluna));
    const total = colunas.map((coluna, i) => {
      if (colunaSomada(coluna)) {
        const soma = somarColuna(coluna, secao.linhas);
        return coluna.tipo === 'moeda' ? fromCents(soma) : soma;
      }
      return i === indiceRotulo ? 'TOTAL' : '';
    });

    const planilha = XLSX.utils.aoa_to_sheet([
      ...cabecalho,
      colunas.map((coluna) => coluna.titulo),
      ...linhas,
      total,
    ]);

    const primeiraLinhaDados = linhaTitulos + 1;
    const ultimaLinha = primeiraLinhaDados + linhas.length;
    colunas.forEach((coluna, c) => {
      if (coluna.tipo !== 'moeda' && coluna.tipo !== 'inteiro') return;
      for (let r = primeiraLinhaDados; r <= ultimaLinha; r += 1) {
        const celula = planilha[XLSX.utils.encode_cell({ r, c })];
        if (celula && celula.t === 'n') celula.z = coluna.tipo === 'moeda' ? FORMATO_MOEDA : FORMATO_INTEIRO;
      }
    });
    planilha['!cols'] = colunas.map((coluna) => ({
      wch: Math.max(coluna.titulo.length + 2, coluna.tipo === 'texto' ? 26 : coluna.tipo === 'dataHora' ? 17 : 14),
    }));

    XLSX.utils.book_append_sheet(livro, planilha, nomeAba(secao.titulo, usados));
  });

  if (livro.SheetNames.length === 0) {
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([['Nenhuma coluna marcada para sair no relatório.']]), 'Relatório');
  }
  XLSX.writeFile(livro, `${nomeArquivo}.xlsx`);
};
