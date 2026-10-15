/**
 * Contas do calendario de data do sistema (o desenho e' o seletorDeDataUi.ts).
 *
 * Data sempre no formato do <input type="date">: 'AAAA-MM-DD'. Mes aqui e'
 * de 1 a 12 (como se le), nunca o 0..11 do Date.
 */

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

/** Semana comecando no domingo, como o calendario brasileiro. */
export const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export interface DiaDaGrade {
  iso: string;
  dia: number;
  /** false = dia do mes anterior/seguinte que completa a grade. */
  doMes: boolean;
}

export interface MesAno {
  ano: number;
  mes: number;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

export function paraIso(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, '0')}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** 'AAAA-MM-DD' valido vira { ano, mes, dia }; qualquer outra coisa, null. */
export function lerIso(valor: string | null | undefined): { ano: number; mes: number; dia: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || '').trim());
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes)) return null;
  return { ano, mes, dia };
}

export function hojeIso(agora: Date = new Date()): string {
  return paraIso(agora.getFullYear(), agora.getMonth() + 1, agora.getDate());
}

export function somarMeses({ ano, mes }: MesAno, delta: number): MesAno {
  const total = ano * 12 + (mes - 1) + delta;
  return { ano: Math.floor(total / 12), mes: (((total % 12) + 12) % 12) + 1 };
}

/**
 * As 6 semanas (42 dias) que o calendario mostra para o mes: comeca no
 * domingo da semana do dia 1 e completa com os dias dos meses vizinhos.
 */
export function gradeDoMes({ ano, mes }: MesAno): DiaDaGrade[] {
  const diaDaSemanaDo1 = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const grade: DiaDaGrade[] = [];
  for (let i = 0; i < 42; i += 1) {
    const data = new Date(Date.UTC(ano, mes - 1, 1 - diaDaSemanaDo1 + i));
    const anoDoDia = data.getUTCFullYear();
    const mesDoDia = data.getUTCMonth() + 1;
    grade.push({
      iso: paraIso(anoDoDia, mesDoDia, data.getUTCDate()),
      dia: data.getUTCDate(),
      doMes: anoDoDia === ano && mesDoDia === mes,
    });
  }
  return grade;
}

/** Respeita o min/max do campo (vazio = sem limite). */
export function foraDosLimites(iso: string, min?: string | null, max?: string | null): boolean {
  if (lerIso(min) && iso < String(min)) return true;
  if (lerIso(max) && iso > String(max)) return true;
  return false;
}

/** Mes inteiro fora do min/max: o botao do mes fica desligado. */
export function mesForaDosLimites({ ano, mes }: MesAno, min?: string | null, max?: string | null): boolean {
  return foraDosLimites(paraIso(ano, mes, diasNoMes(ano, mes)), min, null)
    || foraDosLimites(paraIso(ano, mes, 1), null, max);
}

/** Ano inteiro fora do min/max. */
export function anoForaDosLimites(ano: number, min?: string | null, max?: string | null): boolean {
  return foraDosLimites(paraIso(ano, 12, 31), min, null) || foraDosLimites(paraIso(ano, 1, 1), null, max);
}

/** Pagina de 12 anos da tela de anos: a decada com um ano antes e um depois. */
export function anosDaPagina(ano: number): number[] {
  const inicio = ano - (ano % 10) - 1;
  return Array.from({ length: 12 }, (_, i) => inicio + i);
}

export function rotuloDoMes({ ano, mes }: MesAno): string {
  return `${MESES[mes - 1]} de ${ano}`;
}

export function rotuloDoDia(iso: string): string {
  const d = lerIso(iso);
  return d ? `${d.dia} de ${MESES[d.mes - 1]} de ${d.ano}` : iso;
}
