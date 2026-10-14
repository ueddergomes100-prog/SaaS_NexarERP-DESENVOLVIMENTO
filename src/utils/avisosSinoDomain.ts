import { DEFAULT_TIME_ZONE, differenceInCalendarDays, getDateInputInTimeZone, parseDateInput } from './dateTime';

/**
 * AVISOS DO SINO (TopBar) — regras puras, sem Firestore.
 *
 * As datas dos avisos chegam em formatos diferentes: o LembreteForm grava
 * `dataPrevisao` como Date (vira Timestamp), a Agenda grava `data` como texto
 * 'AAAA-MM-DD', e uma empresa restaurada de backup tem o Timestamp como mapa
 * `{_seconds, _nanoseconds}`. O sino fazia `.split('-')` em tudo e quebrava nos
 * lembretes (2026-10-14).
 */

const segundosDoMapa = (valor: Record<string, unknown>): number | null => {
  const segundos = valor.seconds ?? valor._seconds;
  return typeof segundos === 'number' && Number.isFinite(segundos) ? segundos : null;
};

/** Dia 'AAAA-MM-DD' (no fuso da loja) de uma data gravada em qualquer formato do sistema; null se não der para ler. */
export const diaDaData = (valor: unknown, timeZone = DEFAULT_TIME_ZONE): string | null => {
  if (!valor) return null;
  if (typeof valor === 'string') {
    const texto = valor.trim().slice(0, 10);
    return parseDateInput(texto) ? texto : null;
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : getDateInputInTimeZone(valor, timeZone);
  }
  if (typeof valor === 'object') {
    const comToDate = valor as { toDate?: () => Date };
    if (typeof comToDate.toDate === 'function') return diaDaData(comToDate.toDate(), timeZone);
    const segundos = segundosDoMapa(valor as Record<string, unknown>);
    if (segundos !== null) return getDateInputInTimeZone(new Date(segundos * 1000), timeZone);
  }
  return null;
};

/** Quantos dias faltam de `hoje` até a data (negativo = já passou); null se a data não for legível. */
export const diasAteAData = (valor: unknown, hoje: string, timeZone = DEFAULT_TIME_ZONE): number | null => {
  const dia = diaDaData(valor, timeZone);
  return dia ? differenceInCalendarDays(hoje, dia) : null;
};
