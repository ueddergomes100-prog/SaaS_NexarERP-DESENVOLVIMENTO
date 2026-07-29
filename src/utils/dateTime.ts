export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

export type DashboardPeriod = 'hoje' | 'semana' | 'mes';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getPartsFormatter = (timeZone: string) => {
  const cached = partsFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  partsFormatterCache.set(timeZone, formatter);
  return formatter;
};

export const getZonedParts = (date: Date, timeZone = DEFAULT_TIME_ZONE): ZonedParts => {
  const values: Record<string, number> = {};
  getPartsFormatter(timeZone).formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  });

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const getTimeZoneOffsetMilliseconds = (date: Date, timeZone: string) => {
  const parts = getZonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - date.getTime();
};

export const zonedDateTimeToUtc = (
  parts: ZonedParts,
  timeZone = DEFAULT_TIME_ZONE,
) => {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let result = new Date(utcGuess);

  // A segunda passagem cobre transições históricas de horário de verão.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = new Date(utcGuess - getTimeZoneOffsetMilliseconds(result, timeZone));
  }

  return result;
};

const pad = (value: number) => String(value).padStart(2, '0');

export const getDateInputInTimeZone = (date = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const parts = getZonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const parseDateInput = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
};

export const addDaysToDateInput = (value: string, days: number) => {
  const parts = parseDateInput(value);
  if (!parts || !Number.isInteger(days)) return '';
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const addBusinessDaysToDateInput = (value: string, days: number) => {
  const parts = parseDateInput(value);
  if (!parts || !Number.isInteger(days)) return '';
  if (days === 0) return value;

  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  while (remaining > 0) {
    date = new Date(date.getTime() + step * 24 * 60 * 60 * 1000);
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) remaining -= 1;
  }

  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

export const addMonthsToDateInput = (value: string, months: number) => {
  const parts = parseDateInput(value);
  if (!parts || !Number.isInteger(months)) return '';

  const firstOfTargetMonth = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(
    firstOfTargetMonth.getUTCFullYear(),
    firstOfTargetMonth.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(parts.day, lastDay));

  return `${firstOfTargetMonth.getUTCFullYear()}-${pad(firstOfTargetMonth.getUTCMonth() + 1)}-${pad(firstOfTargetMonth.getUTCDate())}`;
};

export const differenceInCalendarDays = (startValue: string, endValue: string) => {
  const start = parseDateInput(startValue);
  const end = parseDateInput(endValue);
  if (!start || !end) return null;

  const startTime = Date.UTC(start.year, start.month - 1, start.day);
  const endTime = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endTime - startTime) / (24 * 60 * 60 * 1000));
};

export const dateInputToUtcStart = (value: string, timeZone = DEFAULT_TIME_ZONE) => {
  const parts = parseDateInput(value);
  if (!parts) return null;
  return zonedDateTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
};

export const dateInputToUtcEnd = (value: string, timeZone = DEFAULT_TIME_ZONE) => {
  const start = dateInputToUtcStart(value, timeZone);
  if (!start) return null;
  const nextDate = addDaysToDateInput(value, 1);
  const nextStart = dateInputToUtcStart(nextDate, timeZone);
  return nextStart ? new Date(nextStart.getTime() - 1) : null;
};

export const getDashboardPeriodRange = (
  period: DashboardPeriod,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
) => {
  const nowParts = getZonedParts(now, timeZone);
  const today = `${nowParts.year}-${pad(nowParts.month)}-${pad(nowParts.day)}`;
  let startInput = today;

  if (period === 'semana') {
    const utcCalendarDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
    const mondayOffset = (utcCalendarDate.getUTCDay() + 6) % 7;
    startInput = addDaysToDateInput(today, -mondayOffset);
  } else if (period === 'mes') {
    startInput = `${nowParts.year}-${pad(nowParts.month)}-01`;
  }

  const start = dateInputToUtcStart(startInput, timeZone);
  if (!start) throw new Error('Não foi possível calcular o período selecionado.');

  return {
    period,
    start,
    end: now,
    startDate: startInput,
    endDate: today,
    timeZone,
  };
};

export const isWithinDateRange = (date: Date | null, start: Date, end: Date) => (
  Boolean(date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime())
);

export const formatDateInputPtBr = (value?: string) => {
  if (!value) return '-';
  const parts = parseDateInput(value);
  return parts ? `${pad(parts.day)}/${pad(parts.month)}/${parts.year}` : '-';
};
