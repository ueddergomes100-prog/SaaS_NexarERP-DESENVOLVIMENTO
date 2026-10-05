"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateInputPtBr = exports.isWithinDateRange = exports.getDashboardPeriodRange = exports.dateInputToUtcEnd = exports.dateInputToUtcStart = exports.differenceInCalendarDays = exports.addMonthsToDateInput = exports.addBusinessDaysToDateInput = exports.addDaysToDateInput = exports.parseDateInput = exports.getDateInputInTimeZone = exports.zonedDateTimeToUtc = exports.getZonedParts = exports.DEFAULT_TIME_ZONE = void 0;
exports.DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const partsFormatterCache = new Map();
const getPartsFormatter = (timeZone) => {
    const cached = partsFormatterCache.get(timeZone);
    if (cached)
        return cached;
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
const getZonedParts = (date, timeZone = exports.DEFAULT_TIME_ZONE) => {
    const values = {};
    getPartsFormatter(timeZone).formatToParts(date).forEach((part) => {
        if (part.type !== 'literal')
            values[part.type] = Number(part.value);
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
exports.getZonedParts = getZonedParts;
const getTimeZoneOffsetMilliseconds = (date, timeZone) => {
    const parts = (0, exports.getZonedParts)(date, timeZone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return representedAsUtc - date.getTime();
};
const zonedDateTimeToUtc = (parts, timeZone = exports.DEFAULT_TIME_ZONE) => {
    const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let result = new Date(utcGuess);
    // A segunda passagem cobre transições históricas de horário de verão.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        result = new Date(utcGuess - getTimeZoneOffsetMilliseconds(result, timeZone));
    }
    return result;
};
exports.zonedDateTimeToUtc = zonedDateTimeToUtc;
const pad = (value) => String(value).padStart(2, '0');
const getDateInputInTimeZone = (date = new Date(), timeZone = exports.DEFAULT_TIME_ZONE) => {
    const parts = (0, exports.getZonedParts)(date, timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};
exports.getDateInputInTimeZone = getDateInputInTimeZone;
const parseDateInput = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        return null;
    }
    return { year, month, day };
};
exports.parseDateInput = parseDateInput;
const addDaysToDateInput = (value, days) => {
    const parts = (0, exports.parseDateInput)(value);
    if (!parts || !Number.isInteger(days))
        return '';
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
exports.addDaysToDateInput = addDaysToDateInput;
const addBusinessDaysToDateInput = (value, days) => {
    const parts = (0, exports.parseDateInput)(value);
    if (!parts || !Number.isInteger(days))
        return '';
    if (days === 0)
        return value;
    const step = days > 0 ? 1 : -1;
    let remaining = Math.abs(days);
    let date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    while (remaining > 0) {
        date = new Date(date.getTime() + step * 24 * 60 * 60 * 1000);
        const dayOfWeek = date.getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6)
            remaining -= 1;
    }
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
exports.addBusinessDaysToDateInput = addBusinessDaysToDateInput;
const addMonthsToDateInput = (value, months) => {
    const parts = (0, exports.parseDateInput)(value);
    if (!parts || !Number.isInteger(months))
        return '';
    const firstOfTargetMonth = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
    const lastDay = new Date(Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    firstOfTargetMonth.setUTCDate(Math.min(parts.day, lastDay));
    return `${firstOfTargetMonth.getUTCFullYear()}-${pad(firstOfTargetMonth.getUTCMonth() + 1)}-${pad(firstOfTargetMonth.getUTCDate())}`;
};
exports.addMonthsToDateInput = addMonthsToDateInput;
const differenceInCalendarDays = (startValue, endValue) => {
    const start = (0, exports.parseDateInput)(startValue);
    const end = (0, exports.parseDateInput)(endValue);
    if (!start || !end)
        return null;
    const startTime = Date.UTC(start.year, start.month - 1, start.day);
    const endTime = Date.UTC(end.year, end.month - 1, end.day);
    return Math.round((endTime - startTime) / (24 * 60 * 60 * 1000));
};
exports.differenceInCalendarDays = differenceInCalendarDays;
const dateInputToUtcStart = (value, timeZone = exports.DEFAULT_TIME_ZONE) => {
    const parts = (0, exports.parseDateInput)(value);
    if (!parts)
        return null;
    return (0, exports.zonedDateTimeToUtc)({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
};
exports.dateInputToUtcStart = dateInputToUtcStart;
const dateInputToUtcEnd = (value, timeZone = exports.DEFAULT_TIME_ZONE) => {
    const start = (0, exports.dateInputToUtcStart)(value, timeZone);
    if (!start)
        return null;
    const nextDate = (0, exports.addDaysToDateInput)(value, 1);
    const nextStart = (0, exports.dateInputToUtcStart)(nextDate, timeZone);
    return nextStart ? new Date(nextStart.getTime() - 1) : null;
};
exports.dateInputToUtcEnd = dateInputToUtcEnd;
const getDashboardPeriodRange = (period, now = new Date(), timeZone = exports.DEFAULT_TIME_ZONE) => {
    const nowParts = (0, exports.getZonedParts)(now, timeZone);
    const today = `${nowParts.year}-${pad(nowParts.month)}-${pad(nowParts.day)}`;
    let startInput = today;
    if (period === 'semana') {
        const utcCalendarDate = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
        const mondayOffset = (utcCalendarDate.getUTCDay() + 6) % 7;
        startInput = (0, exports.addDaysToDateInput)(today, -mondayOffset);
    }
    else if (period === 'mes') {
        startInput = `${nowParts.year}-${pad(nowParts.month)}-01`;
    }
    const start = (0, exports.dateInputToUtcStart)(startInput, timeZone);
    if (!start)
        throw new Error('Não foi possível calcular o período selecionado.');
    return {
        period,
        start,
        end: now,
        startDate: startInput,
        endDate: today,
        timeZone,
    };
};
exports.getDashboardPeriodRange = getDashboardPeriodRange;
const isWithinDateRange = (date, start, end) => (Boolean(date && date.getTime() >= start.getTime() && date.getTime() <= end.getTime()));
exports.isWithinDateRange = isWithinDateRange;
const formatDateInputPtBr = (value) => {
    if (!value)
        return '-';
    const parts = (0, exports.parseDateInput)(value);
    return parts ? `${pad(parts.day)}/${pad(parts.month)}/${parts.year}` : '-';
};
exports.formatDateInputPtBr = formatDateInputPtBr;
