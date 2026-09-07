import { isValidDateString } from './groupStayPeriods.js';
export const todayIL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
export const nextDay = value => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export const overlaps = (a, b, c, d) => a < d && c < b;
export const activeAllocation = r => ['DRAFT', 'CONFIRMED'].includes(r.status);
export function nights(start, end) {
  if (!isValidDateString(start) || !isValidDateString(end) || start >= end) return [];
  const out = []; for (let d = start; d < end; d = nextDay(d)) out.push(d); return out;
}
export function segments(dates) {
  const result = [];
  for (const date of [...new Set(dates)].sort()) {
    const last = result[result.length - 1];
    if (last?.departure_date === date) last.departure_date = nextDay(date);
    else result.push({ arrival_date: date, departure_date: nextDay(date) });
  }
  return result;
}
export async function readAll(entity, query = {}) {
  const result = []; let skip = 0;
  for (;;) { const rows = await entity.filter(query, 'id', 500, skip); result.push(...rows); if (rows.length < 500) return result; skip += rows.length; }
}
export const pick = (row, fields) => Object.fromEntries(fields.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
export const periodShape = rows => [...rows].map(p => pick(p, ['id','start_date','end_date','arrival_time','departure_time','status','notes'])).sort((a,b) => String(a.id).localeCompare(String(b.id)));
export async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
}
export async function internalAccess(base44, user, write = false) {
  if (!user) return false;
  const rows = await base44.asServiceRole.entities.InternalUser.filter({ email: user.email }, '-created_date', 1);
  const internal = rows[0];
  return !!internal?.active && (write ? user.role === 'admin' && ['ADMIN','SUPER_ADMIN'].includes(internal.role) : internal.role !== 'MECHINA_USER');
}