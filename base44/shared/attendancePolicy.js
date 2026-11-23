// Pure attendance rules (no I/O). Timestamps are UTC ISO strings; operational dates are Asia/Jerusalem.
import { localToUtcMs, localDateOf, localTimeOf, addDays, isDate, isTime } from './workScheduleReport.js';

export const AUTO_CLOSE_MS = 13 * 3600000;
export const MAX_SESSION_MINUTES = 24 * 60;
export const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const NO_CLOCK_ROLES = ['MECHINA_USER'];
const MIN = 60000;
const bad = (status, error) => ({ status, error });

// Clock: any active internal user (except Mechina) with an ACTIVE linked WorkerProfile. Managers: ADMIN / SUPER_ADMIN.
export function attendanceAccess(role, profile) {
  const isManager = MANAGER_ROLES.includes(role);
  const canClock = !!role && !NO_CLOCK_ROLES.includes(role) && !!profile && profile.is_active !== false;
  return { isManager, canClock, canView: isManager || canClock };
}

export const isRequestId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(v);
export const autoCloseDue = (iso) => new Date(Date.parse(iso) + AUTO_CLOSE_MS).toISOString();
export const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / MIN));
const isExpired = (r, nowMs) => r.status === 'ACTIVE' && Date.parse(r.auto_close_due_at) <= nowMs;

// End used for display/totals: the real end, or for a running session "now" capped at the 13-hour cutoff.
export function effectiveEndMs(r, nowMs) {
  if (r.status === 'ACTIVE') return Math.min(nowMs, Date.parse(r.auto_close_due_at));
  return r.effective_end_at ? Date.parse(r.effective_end_at) : null;
}

export function displayStatus(r, nowMs) {
  if (r.status === 'VOIDED') return 'VOIDED';
  if (isExpired(r, nowMs) || (r.status === 'AUTO_CLOSED' && r.needs_review)) return 'NEEDS_REVIEW';
  if (r.status === 'ACTIVE') return 'ACTIVE';
  return r.is_corrected ? 'CORRECTED' : 'NORMAL';
}

export function presentRecord(r, nowMs) {
  const end = effectiveEndMs(r, nowMs);
  const shown = displayStatus(r, nowMs);
  return {
    id: r.id, worker_id: r.worker_profile_id, worker_name: r.worker_name_snapshot || '', local_date: r.local_date,
    start_at: r.effective_start_at, end_at: r.status === 'ACTIVE' ? (isExpired(r, nowMs) ? r.auto_close_due_at : null) : r.effective_end_at || null,
    auto_close_due_at: r.auto_close_due_at || null, status: r.status, display_status: shown, source: r.source || 'CLOCK',
    worked_minutes: end ? Math.max(0, Math.round((end - Date.parse(r.effective_start_at)) / MIN)) : 0,
    needs_review: shown === 'NEEDS_REVIEW', was_auto_closed: !!r.was_auto_closed, is_corrected: !!r.is_corrected,
    correction_count: r.correction_count || 0, original_clock_in_at: r.clock_in_at || null, original_clock_out_at: r.clock_out_at || null,
    last_corrected_at: r.last_corrected_at || null, last_corrected_by_name: r.last_corrected_by_name || null,
  };
}

// Simple form → UTC: local date + HH:MM start/end (Asia/Jerusalem, DST-aware). End <= start means the next day.
export function parseTimesInput(input = {}, { requireEnd }) {
  const date = String(input.date || ''), start = String(input.start_time || ''), end = String(input.end_time || '').trim();
  if (!isDate(date)) return bad(400, 'יש לבחור תאריך תקין');
  if (!isTime(start)) return bad(400, 'יש להזין שעת התחלה');
  if (requireEnd && !end) return bad(400, 'יש להזין שעת סיום');
  if (end && !isTime(end)) return bad(400, 'שעת הסיום אינה תקינה');
  const note = String(input.note ?? '').trim();
  if (note.length > 300) return bad(400, 'ההערה ארוכה מדי (עד 300 תווים)');
  const toMin = (t) => t.split(':').map(Number).reduce((h, m) => h * 60 + m);
  const startAt = new Date(localToUtcMs(date, start)).toISOString();
  const endAt = end ? new Date(localToUtcMs(toMin(end) <= toMin(start) ? addDays(date, 1) : date, end)).toISOString() : null;
  return { data: { start_at: startAt, end_at: endAt, note } };
}

export function checkInterval(startIso, endIso, nowMs) {
  const s = Date.parse(startIso);
  if (s > nowMs + MIN) return bad(400, 'לא ניתן לרשום שעת התחלה עתידית');
  if (!endIso) return null;
  const e = Date.parse(endIso);
  if (e > nowMs + MIN) return bad(400, 'לא ניתן לרשום שעת סיום עתידית');
  const minutes = (e - s) / MIN;
  if (minutes < 1) return bad(400, 'משך העבודה חייב להיות לפחות דקה');
  if (minutes > MAX_SESSION_MINUTES) return bad(400, 'משך עבודה של יותר מ-24 שעות אינו אפשרי');
  return null;
}

// First non-voided record of the same worker whose interval intersects [startIso, endIso).
export function findOverlap(records, startIso, endIso, excludeId) {
  return records.find((r) => r.id !== excludeId && r.status !== 'VOIDED'
    && startIso < (r.status === 'ACTIVE' ? r.auto_close_due_at : r.effective_end_at) && endIso > r.effective_start_at) || null;
}

export function overlapError(r) {
  const s = Date.parse(r.effective_start_at), e = r.effective_end_at ? Date.parse(r.effective_end_at) : null;
  const [, m, d] = localDateOf(s).split('-');
  return bad(409, `השעות חופפות לרשומה אחרת (${d}/${m} ${localTimeOf(s)}–${e ? localTimeOf(e) : 'בעבודה'})`);
}

export function changeType(rec, next) {
  if (rec.status === 'AUTO_CLOSED') return 'RESOLVE_AUTO_CLOSE';
  const startChanged = next.start_at !== rec.effective_start_at;
  const endChanged = !!next.end_at && next.end_at !== rec.effective_end_at;
  if (startChanged && endChanged) return 'EDIT_TIMES';
  if (startChanged) return 'EDIT_START';
  return endChanged ? 'EDIT_END' : 'CONFIRM';
}