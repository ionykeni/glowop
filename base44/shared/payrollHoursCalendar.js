import { addDays, localDateOf, localToUtcMs, weekStartOf } from './workScheduleReport.js';

export const MINUTE = 60_000;
export const iso = (ms) => new Date(ms).toISOString();
export const validDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && Number.isFinite(Date.parse(s)) && iso(Date.parse(s)).slice(0, 10) === s;
export const instant = (value) => typeof value === 'string' && validDate(value.slice(0, 10))
  && /T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;

export function payrollRange(month) {
  if (typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) return null;
  const first = `${month}-01`;
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const next = iso(d.getTime()).slice(0, 10);
  const from = weekStartOf(first), through = addDays(weekStartOf(addDays(next, -1)), 6);
  return { first, next, from, through, lower: localToUtcMs(from), upper: localToUtcMs(addDays(through, 1)) };
}

export function* localDayPieces(start, end) {
  while (start < end) {
    const date = localDateOf(start);
    const stop = Math.min(end, localToUtcMs(addDays(date, 1)));
    yield { date, start, end: stop };
    start = stop;
  }
}

export const inMonth = (date, range) => date >= range.first && date < range.next;
export const inContext = (date, range) => date >= range.from && date <= range.through;
export const span = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));