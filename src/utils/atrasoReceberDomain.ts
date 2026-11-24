/**
 * CONTAS A RECEBER: ATRASADOS JA' COM JUROS E MULTA (24/11/2026, pedido do dono).
 *
 * Ao abrir a tela, cada titulo vencido mostra os juros (pro rata ao dia, sobre
 * o mes de 30 dias) e a multa com as % de Configuracoes da filial > Parametros
 * de venda > "Juros e multa do crediario em atraso" -- a mesma conta que a
 * janela de baixa ja' sugeria (acrescimoPorAtraso).
 *
 * As % podem ser mudadas SO' NA TELA, para aquela consulta: valem para a lista,
 * para a janela de baixa e para a baixa em lote, mas nao sao gravadas. O que
 * fica salvo e' so' o padrao da configuracao (a tela volta a ele ao reabrir).
 */
import { acrescimoPorAtraso, type AcrescimoPorAtraso, type ParametrosVenda } from './parametrosVendaDomain';

export interface PercentuaisDeAtraso {
  aoMesPercentual: number;
  multaPercentual: number;
}

/** As % que valem agora: as da tela (se mudadas) ou as da configuracao. */
export const parametrosComPercentuaisDaTela = (config: ParametrosVenda, daTela: PercentuaisDeAtraso | null): ParametrosVenda => (
  daTela ? { ...config, juros: { aoMesPercentual: daTela.aoMesPercentual, multaPercentual: daTela.multaPercentual } } : config
);

export const temPercentuais = (p: PercentuaisDeAtraso): boolean => p.aoMesPercentual > 0 || p.multaPercentual > 0;

/** Juros e multa de UM titulo em aberto e vencido; null quando nao ha' o que somar. */
export const acrescimoDoTitulo = (
  parametros: ParametrosVenda,
  titulo: { status?: string; valorCentavos: number; dataVencimento: unknown },
  hoje: string,
): AcrescimoPorAtraso | null => {
  if (titulo.status !== 'Pendente') return null;
  return acrescimoPorAtraso(parametros, titulo.valorCentavos, titulo.dataVencimento, hoje);
};

/** Soma (em centavos) do acrescimo de varios titulos. */
export const somaDosAcrescimos = (acrescimos: ReadonlyArray<AcrescimoPorAtraso | null>): number => (
  acrescimos.reduce((soma, a) => soma + (a ? a.totalCentavos : 0), 0)
);

const numeroDoTexto = (texto: string): number | null => {
  const limpo = String(texto ?? '').trim().replace('%', '').trim();
  if (!limpo) return 0;
  const n = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  return Number.isFinite(n) ? n : null;
};

/** Le as % digitadas na tela. Vazio = 0. Erro em portugues dizendo o que corrigir. */
export const lerPercentuaisDaTela = (jurosTexto: string, multaTexto: string): { percentuais: PercentuaisDeAtraso } | { erro: string } => {
  const juros = numeroDoTexto(jurosTexto);
  const multa = numeroDoTexto(multaTexto);
  if (juros === null || juros < 0 || juros > 100) return { erro: 'Os juros ao mês vão de 0 a 100%. Digite só o número (ex.: 9,90).' };
  if (multa === null || multa < 0 || multa > 100) return { erro: 'A multa vai de 0 a 100%. Digite só o número (ex.: 2).' };
  return { percentuais: { aoMesPercentual: Math.round(juros * 100) / 100, multaPercentual: Math.round(multa * 100) / 100 } };
};

const pct = (n: number): string => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** "juros de 9,9% ao mês e multa de 2%" (so' o que tiver). */
export const textoDosPercentuais = (p: PercentuaisDeAtraso): string => [
  p.aoMesPercentual > 0 ? `juros de ${pct(p.aoMesPercentual)} ao mês` : '',
  p.multaPercentual > 0 ? `multa de ${pct(p.multaPercentual)}` : '',
].filter(Boolean).join(' e ');

/** Texto do campo (vazio quando zero), para preencher a janela de alterar. */
export const campoDoPercentual = (n: number): string => (n > 0 ? String(n).replace('.', ',') : '');

export const mesmosPercentuais = (a: PercentuaisDeAtraso, b: PercentuaisDeAtraso): boolean => (
  a.aoMesPercentual === b.aoMesPercentual && a.multaPercentual === b.multaPercentual
);
