// Israel-local calendar helpers for preventive maintenance (pure, no I/O).
// Dates are YYYY-MM-DD strings in Asia/Jerusalem. Weeks run Sunday-Saturday.
export const PM_TZ = 'Asia/Jerusalem';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

export function israelDate(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat('en-CA', { timeZone: PM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function isValidDate(v) {
  if (!DATE_RE.test(String(v || ''))) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dayOfWeek = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function weekPeriod(date) {
  const start = addDays(date, -dayOfWeek(date));
  return { start, end: addDays(start, 6) };
}

export function monthPeriod(date) {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(last)}` };
}

export const periodOf = (type, date) => (type === 'WEEKLY' ? weekPeriod(date) : monthPeriod(date));

// Periods from the one containing fromDate through the one containing toDate; only the last `max` are kept.
export function periodsBetween(type, fromDate, toDate, max = 12) {
  const out = [];
  const last = periodOf(type, toDate).start;
  let p = periodOf(type, fromDate);
  while (p.start <= last) {
    out.push(p);
    p = periodOf(type, addDays(p.end, 1));
  }
  return out.slice(-max);
}

export const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);