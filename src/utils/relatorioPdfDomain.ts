/*
 * RELATORIO DO SISTEMA = PDF, COM COLUNAS ESCOLHIDAS POR CHECKBOX.
 *
 * Decisao do dono (2026-09-23): todo relatorio abre primeiro na tela, dentro
 * do sistema (igual minuta/pedido), ja paginado como vai sair no papel. Dali
 * a pessoa so' olha e fecha, imprime, salva o PDF ou -- em botao separado --
 * salva em Excel.
 *
 * Nenhuma coluna e' removida do sistema porque um cliente nao usa: cada
 * relatorio declara TODAS as colunas e o cliente marca o que quer no papel.
 * A escolha fica guardada no computador (localStorage), por relatorio.
 *
 * Este arquivo e' so' a parte pura (formato, total, orientacao, preferencia)
 * -- testavel sem navegador. O desenho do PDF mora em relatorioPdf.ts.
 */
import { fromCents } from './financeDomain';

export type TipoColunaRelatorio = 'texto' | 'moeda' | 'inteiro' | 'data' | 'dataHora';

export type ValorCelulaRelatorio = string | number | Date | null | undefined;

export interface ColunaRelatorio<T = any> {
  id: string;
  titulo: string;
  tipo: TipoColunaRelatorio;
  /** Moeda SEMPRE em centavos (inteiro), como o resto do sistema. */
  valor: (linha: T) => ValorCelulaRelatorio;
  /** Padrao: moeda e inteiro somam, o resto nao. */
  total?: 'soma' | 'nenhum';
  /** Total que nao e' soma (ex: ticket medio = liquido / quantidade). */
  totalCalculado?: (linhas: T[]) => number;
  /** Vem marcada quando o computador ainda nao tem escolha salva. */
  padrao?: boolean;
  /** Largura estimada em mm, so' para decidir retrato x paisagem. */
  largura?: number;
}

export interface GrupoSecaoRelatorio<T = any> {
  chave: (linha: T) => string;
  rotulo: (linha: T) => string;
}

export interface SecaoRelatorio<T = any> {
  id: string;
  titulo: string;
  colunas: ColunaRelatorio<T>[];
  linhas: T[];
  /** Quando existe, a secao pode ser ligada/desligada inteira. */
  opcional?: boolean;
  /** Estado inicial de secao opcional. */
  padrao?: boolean;
  /** Agrupa as linhas (ex: vendas de cada vendedor) com subtotal por grupo. */
  agruparPor?: GrupoSecaoRelatorio<T>;
  rotuloTotal?: string;
  /** Singular/plural do que cada linha e' ("venda"/"vendas"). */
  unidade?: [string, string];
  mensagemVazia?: string;
}

export interface IndicadorRelatorio {
  rotulo: string;
  valor: string;
}

export interface PreferenciaSecao {
  ativa: boolean;
  colunas: string[];
}

export interface PreferenciasRelatorio {
  indicadores: boolean;
  secoes: Record<string, PreferenciaSecao>;
}

export type OrientacaoRelatorio = 'portrait' | 'landscape';

/** A4 menos 12mm de margem de cada lado. */
export const LARGURA_UTIL_RETRATO_MM = 210 - 24;
export const LARGURA_UTIL_PAISAGEM_MM = 297 - 24;

const LARGURA_PADRAO_MM: Record<TipoColunaRelatorio, number> = {
  texto: 34,
  moeda: 24,
  inteiro: 14,
  data: 20,
  dataHora: 30,
};

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = new Intl.NumberFormat('pt-BR');

/** Papel sai em caixa alta (decisao de 2026-08-31, impressaoMaiuscula.css). */
export const caixaAltaRelatorio = (texto: string): string => texto.toLocaleUpperCase('pt-BR');

export const formatarDataRelatorio = (data: Date, comHora = false): string => {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(data);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  const dia = `${parte('day')}/${parte('month')}/${parte('year')}`;
  return comHora ? `${dia} ${parte('hour')}:${parte('minute')}` : dia;
};

export const formatarCelulaRelatorio = (valor: ValorCelulaRelatorio, tipo: TipoColunaRelatorio): string => {
  if (valor === null || valor === undefined || valor === '') return '-';
  switch (tipo) {
    case 'moeda':
      return moeda.format(fromCents(Number(valor) || 0));
    case 'inteiro':
      return inteiro.format(Number(valor) || 0);
    case 'data':
    case 'dataHora': {
      const data = valor instanceof Date ? valor : new Date(valor);
      if (Number.isNaN(data.getTime())) return '-';
      return formatarDataRelatorio(data, tipo === 'dataHora');
    }
    default:
      return caixaAltaRelatorio(String(valor));
  }
};

export const colunaSomada = (coluna: Pick<ColunaRelatorio, 'tipo' | 'total' | 'totalCalculado'>): boolean => (
  Boolean(coluna.totalCalculado) || (coluna.total ? coluna.total === 'soma' : coluna.tipo === 'moeda' || coluna.tipo === 'inteiro')
);

export const somarColuna = <T>(coluna: ColunaRelatorio<T>, linhas: T[]): number => (
  coluna.totalCalculado
    ? coluna.totalCalculado(linhas)
    : linhas.reduce((soma, linha) => soma + (Number(coluna.valor(linha)) || 0), 0)
);

export const contarUnidade = (quantidade: number, unidade: [string, string] = ['registro', 'registros']): string => (
  `${inteiro.format(quantidade)} ${quantidade === 1 ? unidade[0] : unidade[1]}`
);

/**
 * Linha de total de uma secao, ja' formatada, na ordem das colunas escolhidas.
 * O rotulo ("TOTAL GERAL - 12 VENDAS") vai na primeira coluna que NAO soma --
 * nunca em cima de um valor. Se todas somam, o rotulo nao entra (a linha em
 * negrito no fim ja' diz o que e').
 */
export const linhaTotalSecao = <T>(
  colunas: ColunaRelatorio<T>[],
  linhas: T[],
  rotulo: string,
): string[] => {
  const indiceRotulo = colunas.findIndex((coluna) => !colunaSomada(coluna));
  return colunas.map((coluna, indice) => {
    if (colunaSomada(coluna)) return formatarCelulaRelatorio(somarColuna(coluna, linhas), coluna.tipo);
    return indice === indiceRotulo ? caixaAltaRelatorio(rotulo) : '';
  });
};

export const larguraEstimadaColunas = (colunas: Pick<ColunaRelatorio, 'tipo' | 'largura'>[]): number => (
  colunas.reduce((soma, coluna) => soma + (coluna.largura ?? LARGURA_PADRAO_MM[coluna.tipo]), 0)
);

/** Retrato quando cabe; paisagem quando as colunas marcadas nao cabem em pe'. */
export const escolherOrientacao = (secoesColunas: Pick<ColunaRelatorio, 'tipo' | 'largura'>[][]): OrientacaoRelatorio => (
  secoesColunas.some((colunas) => larguraEstimadaColunas(colunas) > LARGURA_UTIL_RETRATO_MM) ? 'landscape' : 'portrait'
);

/** Fonte da tabela: encolhe um pouco so' quando nem a paisagem comporta folgado. */
export const tamanhoFonteTabela = (secoesColunas: Pick<ColunaRelatorio, 'tipo' | 'largura'>[][]): number => {
  const maior = Math.max(0, ...secoesColunas.map(larguraEstimadaColunas));
  if (maior > LARGURA_UTIL_PAISAGEM_MM * 1.15) return 6.5;
  if (maior > LARGURA_UTIL_PAISAGEM_MM) return 7.5;
  return 8.5;
};

export const preferenciasPadrao = (secoes: Pick<SecaoRelatorio, 'id' | 'colunas' | 'opcional' | 'padrao'>[]): PreferenciasRelatorio => ({
  indicadores: true,
  secoes: Object.fromEntries(secoes.map((secao) => [secao.id, {
    ativa: secao.opcional ? secao.padrao !== false : true,
    colunas: secao.colunas.filter((coluna) => coluna.padrao !== false).map((coluna) => coluna.id),
  }])),
});

/**
 * Junta o que estava salvo no computador com o relatorio de hoje: coluna que
 * deixou de existir some, secao nova entra no padrao. Assim uma atualizacao
 * do relatorio nunca quebra a escolha antiga de ninguem.
 */
export const normalizarPreferencias = (
  salvas: unknown,
  secoes: Pick<SecaoRelatorio, 'id' | 'colunas' | 'opcional' | 'padrao'>[],
): PreferenciasRelatorio => {
  const padrao = preferenciasPadrao(secoes);
  if (!salvas || typeof salvas !== 'object') return padrao;
  const bruto = salvas as Partial<PreferenciasRelatorio>;
  const secoesSalvas = (bruto.secoes && typeof bruto.secoes === 'object') ? bruto.secoes : {};
  return {
    indicadores: typeof bruto.indicadores === 'boolean' ? bruto.indicadores : padrao.indicadores,
    secoes: Object.fromEntries(secoes.map((secao) => {
      const salva = (secoesSalvas as Record<string, Partial<PreferenciaSecao>>)[secao.id];
      if (!salva || !Array.isArray(salva.colunas)) return [secao.id, padrao.secoes[secao.id]];
      const existentes = new Set(secao.colunas.map((coluna) => coluna.id));
      return [secao.id, {
        ativa: secao.opcional ? salva.ativa !== false : true,
        // Mantem a ORDEM do relatorio, nao a ordem em que a pessoa clicou.
        colunas: secao.colunas.map((coluna) => coluna.id).filter((id) => existentes.has(id) && salva.colunas!.includes(id)),
      }];
    })),
  };
};

export const colunasEscolhidas = <T>(secao: SecaoRelatorio<T>, preferencias: PreferenciasRelatorio): ColunaRelatorio<T>[] => {
  const escolhidas = preferencias.secoes[secao.id]?.colunas || [];
  return secao.colunas.filter((coluna) => escolhidas.includes(coluna.id));
};

export const secoesVisiveis = <T>(secoes: SecaoRelatorio<T>[], preferencias: PreferenciasRelatorio): SecaoRelatorio<T>[] => (
  secoes.filter((secao) => (preferencias.secoes[secao.id]?.ativa ?? true) && colunasEscolhidas(secao, preferencias).length > 0)
);

const semAcento = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "Vendas por Vendedor" + 2026-09-01..2026-09-21 -> vendas-por-vendedor-01-09-2026-a-21-09-2026 */
export const nomeArquivoRelatorio = (titulo: string, inicio?: string, fim?: string): string => {
  const base = semAcento(titulo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const data = (valor?: string) => (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor.split('-').reverse().join('-') : '');
  const periodo = [data(inicio), data(fim)].filter(Boolean);
  if (periodo.length === 2 && periodo[0] === periodo[1]) return `${base}-${periodo[0]}`;
  return periodo.length ? `${base}-${periodo.join('-a-')}` : base;
};
