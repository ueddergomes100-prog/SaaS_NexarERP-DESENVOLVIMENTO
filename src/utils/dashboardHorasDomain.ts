/**
 * GRAFICO DO DASHBOARD NO "HOJE" (21/11/2026, pedido do dono).
 *
 * No periodo "Hoje" o grafico de receita mostrava um ponto so', em "00h":
 * o dia do pagamento e' gravado so' como data ("2026-11-21", sem hora), entao
 * todo lancamento caia na meia-noite. Semana e Mes agrupam por dia e nao
 * sofriam disso.
 *
 * Agora a hora de cada lancamento vem do primeiro horario gravado no
 * documento que cai NO MESMO DIA do pagamento: a criacao (venda a vista,
 * recebida na hora) e depois a ultima alteracao (titulo a prazo, recebido
 * hoje na baixa). Nenhum no mesmo dia = fica sem hora conhecida.
 *
 * E o eixo do "Hoje" mostra as horas seguidas (das 7h, ou antes se houve
 * venda antes, ate' a hora atual), com zero onde nao houve nada: vira uma
 * linha do dia em vez de pontos soltos.
 */

/** Ano-mes-dia de uma data no fuso dado (usa a mesma conta das outras telas: partes do fuso). */
export type PartesDoDia = { year: number; month: number; day: number };

const mesmoDia = (a: PartesDoDia, b: PartesDoDia): boolean => (
  a.year === b.year && a.month === b.month && a.day === b.day
);

/**
 * O momento do lancamento dentro do dia do pagamento: o primeiro candidato
 * (na ordem dada) que cai no mesmo dia. `partes` converte uma data para o
 * dia no fuso da empresa.
 */
export const momentoNoDiaDoPagamento = (
  diaDoPagamento: Date | null,
  candidatos: ReadonlyArray<Date | null | undefined>,
  partes: (data: Date) => PartesDoDia,
): Date | null => {
  if (!diaDoPagamento) return null;
  const dia = partes(diaDoPagamento);
  for (const candidato of candidatos) {
    if (candidato && !Number.isNaN(candidato.getTime()) && mesmoDia(partes(candidato), dia)) return candidato;
  }
  return null;
};

/** Primeira hora que o eixo do "Hoje" sempre mostra (comeca antes se houve movimento antes). */
export const PRIMEIRA_HORA_DO_DIA = 7;

/**
 * As horas do eixo do "Hoje": da menor entre 7h e a primeira hora com
 * movimento ate' a maior entre a hora atual e a ultima hora com movimento.
 */
export const horasDoEixoDoDia = (horasComMovimento: ReadonlyArray<number>, horaAtual: number): number[] => {
  const validas = horasComMovimento.filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  const agora = Math.min(23, Math.max(0, Math.trunc(horaAtual)));
  // Antes das 7h (madrugada) o eixo comeca na hora atual, nunca fica vazio.
  const inicio = Math.min(PRIMEIRA_HORA_DO_DIA, agora, ...validas);
  const fim = Math.max(agora, ...validas);
  const horas: number[] = [];
  for (let h = Math.max(0, inicio); h <= fim; h += 1) horas.push(h);
  return horas;
};
