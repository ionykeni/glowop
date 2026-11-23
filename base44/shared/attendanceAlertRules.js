import { AUTO_CLOSE_MS, attendanceAccess } from './attendancePolicy.js';
import { addDays, isDate, isTime, localDateOf, localTimeOf, localToUtcMs } from './workScheduleReport.js';
import { normalizeEmail, pickActiveInternalUser } from './workforcePolicy.js';

export const HOUR = 3600000;
export const GRACE = 2 * HOUR;
const FIFTEEN = 15 * 60000;
export const MANAGEMENT = ['shahaf@glow-glamping.com', 'hospitality@glow-glamping.com'];
const iso = (ms) => new Date(ms).toISOString();
const due = (ms, now) => ms <= now && ms >= now - GRACE;
const group = (map, key, item) => map.set(key, [...(map.get(key) || []), item]);

export function recipientResolver(users, internals) {
  const accounts = new Map();
  const byId = new Map(internals.map((u) => [u.id, u]));
  for (const u of users) if (u.id && normalizeEmail(u.email)) group(accounts, normalizeEmail(u.email), u);
  const byEmail = (email) => {
    const matches = accounts.get(normalizeEmail(email));
    return matches?.length === 1 ? matches[0].id : null;
  };
  return { byEmail, worker(profile) {
    if (profile?.is_active !== true) return null;
    const linked = profile.internal_user_id ? byId.get(profile.internal_user_id) : null;
    const email = normalizeEmail(linked?.email || profile.internal_user_email);
    if (!email || (profile.internal_user_id && (!linked || linked.active !== true ||
      (profile.internal_user_email && normalizeEmail(profile.internal_user_email) !== email)))) return null;
    const { user } = pickActiveInternalUser(internals, email);
    if (user?.active !== true || (linked && linked.role !== user.role)) return null;
    const id = byEmail(email);
    return id && attendanceAccess(user.role, profile).canClock ? id : null;
  } };
}

function attendanceInterval(r, now) {
  if (!['ACTIVE', 'CLOSED', 'AUTO_CLOSED'].includes(r.status)) return null;
  const a = Date.parse(r.effective_start_at);
  const cap = Math.min(a + AUTO_CLOSE_MS, Date.parse(r.auto_close_due_at) || Infinity);
  const b = r.status === 'ACTIVE' ? Math.min(now, cap) : Math.min(now, Date.parse(r.effective_end_at));
  return Number.isFinite(a) && b > a ? { a, b, cap, r } : null;
}

// Enforce real elapsed time, union overlapping records, and never emit a crossing backdated by an approval.
export function nineHourCrossing(records, date, now) {
  const lo = localToUtcMs(date), hi = localToUtcMs(addDays(date, 1));
  const intervals = records.filter((x) => !(x.r.status === 'AUTO_CLOSED' && x.r.needs_review !== false))
    .map((x) => ({ ...x, a: Math.max(x.a, lo), b: Math.min(x.b, hi) }))
    .filter((x) => x.b > x.a).sort((a, b) => a.a - b.a || b.b - a.b);
  let remaining = 9 * HOUR, lastEnd = lo, newestChange = 0;
  for (const x of intervals) {
    const start = Math.max(lastEnd, x.a);
    if (x.b <= start) continue;
    newestChange = Math.max(newestChange, Date.parse(x.r.last_corrected_at || (x.r.source === 'MANUAL' ? x.r.created_date : '')) || 0);
    if (x.b - start >= remaining) {
      const crossing = start + remaining;
      return due(crossing, now) && crossing >= newestChange ? crossing : null;
    }
    remaining -= x.b - start;
    lastEnd = x.b;
  }
  return null;
}

// Reject nonexistent spring-forward wall times; in the repeated fall hour use first start, last end.
function wall(date, time, last = false) {
  const ms = localToUtcMs(date, time);
  const normalized = time.padStart(5, '0');
  const matches = [ms - HOUR, ms, ms + HOUR].filter((t) => localDateOf(t) === date && localTimeOf(t) === normalized);
  return matches.length ? matches[last ? matches.length - 1 : 0] : NaN;
}

export function reminderWindow(s) {
  if (!isDate(s.date) || !isTime(s.start_time) || !isTime(s.end_time)) return null;
  const overnight = s.end_time.padStart(5, '0') <= s.start_time.padStart(5, '0');
  const start = wall(s.date, s.start_time), end = wall(overnight ? addDays(s.date, 1) : s.date, s.end_time, true);
  return end > start ? { start, end } : null;
}

const COPY = {
  MISSED_CLOCK_IN: ['תזכורת להתחלת משמרת', 'המשמרת שלך התחילה לפני 15 דקות. אם התחלת לעבוד, לא לשכוח להפעיל את שעון הנוכחות.'],
  ACTIVE_AFTER_SHIFT_END: ['תזכורת לסיום משמרת', 'לפי סידור העבודה המשמרת שלך הסתיימה. אם סיימת לעבוד, לא לשכוח לסגור את שעון הנוכחות.'],
  NIGHT_ON_CALL_21: ['תזכורת לכונן לילה', 'התראה לכונן לילה: יש לבדוק את שעון הנוכחות ולסיים אותו אם סיימת לעבוד.'],
};

export function buildAttendanceAlerts({ now, attendance, shifts, schedules, profiles, users, internals, warn = () => {} }) {
  const ids = recipientResolver(users, internals);
  const managers = MANAGEMENT.map((email) => {
    const id = ids.byEmail(email);
    if (!id) warn(email);
    return id;
  }).filter(Boolean);
  const byWorker = new Map(), timed = new Map(), events = [];
  const today = localDateOf(now), dates = new Set([localDateOf(now - GRACE), today]);
  const published = new Set(schedules.filter((s) => s.status === 'PUBLISHED').map((s) => s.id));
  const workers = new Map(profiles.map((w) => [w.id, w]));
  const emit = (type, identity, recipient, ms, fields) => events.push({
    event_key: [type, ...identity, recipient].join('|'), event_type: type, recipient_user_id: recipient, due_at: iso(ms), ...fields,
  });
  for (const r of attendance) {
    const iv = attendanceInterval(r, now);
    if (r.worker_profile_id && iv) group(byWorker, r.worker_profile_id, iv);
  }
  for (const [workerId, records] of byWorker) for (const date of dates) {
    const crossing = nineHourCrossing(records, date, now);
    if (crossing === null) continue;
    const name = workers.get(workerId)?.full_name || records[0].r.worker_name_snapshot || 'עובד/ת';
    const stillActive = records.some(({ r, cap }) => r.status === 'ACTIVE' && now < cap);
    const status = stillActive ? 'בעבודה' : 'לא בעבודה';
    for (const manager of managers) emit('NINE_HOURS', [workerId, date], manager, crossing, {
      title: 'חריגה מ-9 שעות עבודה', subject_name: name, body: `⚠️ חריגה מ-9 שעות עבודה: ${name} הגיע/ה ל-9 שעות עבודה ${date === today ? 'היום' : 'אתמול'}. סטטוס נוכחות: ${status}.`,
      link: '/attendance', folder: 'inbox', local_date: date, worker_id: workerId,
    });
  }
  for (const s of shifts) {
    if (s.status !== 'PLANNED' || !published.has(s.work_schedule_id) || !s.worker_id || !isDate(s.date)) continue;
    const recipient = ids.worker(workers.get(s.worker_id));
    if (!recipient) continue;
    if (s.row_type === 'NIGHT_ON_CALL') {
      const ms = localToUtcMs(s.date, '21:00');
      if (due(ms, now)) emitShift(s, recipient, 'NIGHT_ON_CALL_21', ms);
    } else {
      const window = reminderWindow(s);
      if (window) group(timed, s.worker_id, { s, recipient, ...window });
    }
  }
  for (const [workerId, windows] of timed) {
    const records = byWorker.get(workerId) || [];
    windows.sort((a, b) => a.start - b.start);
    for (const [index, { s, recipient, start, end }] of windows.entries()) {
      // Do not count a prior shift's closed session as early arrival for the next one.
      const early = Math.max(start - GRACE, ...windows.slice(0, index).map((x) => Math.min(start, x.end)));
      const startSatisfied = records.some(({ a, b }) => a < end && b > early);
      if (due(start + FIFTEEN, now) && now < end && !startSatisfied) emitShift(s, recipient, 'MISSED_CLOCK_IN', start + FIFTEEN);
      if (due(end + FIFTEEN, now) && records.some(({ a, r, cap }) => a < end && cap > now && r.status === 'ACTIVE')) {
        emitShift(s, recipient, 'ACTIVE_AFTER_SHIFT_END', end + FIFTEEN);
      }
    }
  }
  return events;

  function emitShift(s, recipient, type, ms) {
    const [title, body] = COPY[type];
    emit(type, [s.id], recipient, ms, {
      title, body, link: type === 'NIGHT_ON_CALL_21' ? '/my-shifts' : '/attendance',
      folder: 'general', worker_id: s.worker_id, shift_id: s.id, local_date: s.date,
    });
  }
}