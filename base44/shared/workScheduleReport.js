// Planned-shift reporting for the Tiful work schedule (סידור עבודה). Pure logic, no I/O.
// Rules (single source for on-screen report, worker PDF and team PDF):
// - Only WorkShift.status === 'PLANNED' with a worker and a PUBLISHED or DRAFT WorkSchedule are reported.
// - Times are Asia/Jerusalem wall-clock; durations are real elapsed minutes (DST-aware).
// - end <= start means the shift ends the next day (overnight). Equal start/end is invalid.
// - Hours are allocated to the period/day/week by the portion of the shift inside it (no double counting).
// - Overlapping shifts of one worker are kept and listed; their common time is counted once (union).
// - NIGHT_ON_CALL is never part of planned hours: counted separately.
// - Shift counts are attributed to the shift's start date.
export const TZ = 'Asia/Jerusalem';
export const ON_CALL_TYPE = 'NIGHT_ON_CALL';
export const LONG_SHIFT_MINUTES = 12 * 60;
export const MAX_RANGE_DAYS = 186;
const MIN = 60000;
const DAY_NAMES = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

const DTF = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const parts = (ms) => Object.fromEntries(DTF.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const offsetMs = (ms) => { const p = parts(ms); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(ms / MIN) * MIN; };

export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
export const isTime = (v) => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) && Number(v.split(':')[0]) < 24 && Number(v.split(':')[1]) < 60;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
export const dayNameOf = (date) => DAY_NAMES[weekdayOf(date)];
export const weekStartOf = (date) => addDays(date, -weekdayOf(date));
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

// Asia/Jerusalem wall-clock → UTC epoch ms.
export function localToUtcMs(date, time = '00:00') {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let ms = wall - offsetMs(wall);
  ms = wall - offsetMs(ms);
  return ms;
}
export const localDateOf = (ms) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
export const localTimeOf = (ms) => { const p = parts(ms); return `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`; };

export function validateRange(start, end) {
  if (!isDate(start) || !isDate(end)) return 'יש לבחור תאריכי התחלה וסיום תקינים';
  if (end < start) return 'תאריך הסיום מוקדם מתאריך ההתחלה';
  if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) return `ניתן להפיק דוח לטווח של עד ${MAX_RANGE_DAYS} ימים`;
  return null;
}

export function shiftInterval(shift) {
  if (!isTime(shift.start_time) || !isTime(shift.end_time)) return { valid: false, reason: 'MISSING_TIMES' };
  const s = toMin(shift.start_time), e = toMin(shift.end_time);
  if (s === e) return { valid: false, reason: 'ZERO_LENGTH' };
  const endDate = e < s ? addDays(shift.date, 1) : shift.date;
  const startMs = localToUtcMs(shift.date, shift.start_time);
  const endMs = localToUtcMs(endDate, shift.end_time);
  return { valid: true, startMs, endMs, minutes: Math.round((endMs - startMs) / MIN), overnight: endDate !== shift.date };
}

function mergeIntervals(list) {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

// Splits [a, b) into Asia/Jerusalem calendar-day portions.
export function splitByLocalDay(a, b) {
  const out = [];
  while (a < b) {
    const date = localDateOf(a);
    const next = Math.min(b, localToUtcMs(addDays(date, 1)));
    out.push({ date, minutes: Math.round((next - a) / MIN) });
    a = next;
  }
  return out;
}

const emptyBucket = () => ({ shift_count: 0, planned_minutes: 0, gross_minutes: 0, overlap_minutes: 0, on_call_count: 0, on_call_minutes: 0 });

function summarizeBucket(items, bucket, periodStart, periodEnd, days, weeks) {
  const sum = emptyBucket();
  const intervals = [];
  for (const it of items) {
    if (it.status !== bucket) continue;
    if (it.is_on_call) {
      if (it.in_period_start) { sum.on_call_count += 1; sum.on_call_minutes += it.minutes; }
      continue;
    }
    if (it.in_period_start) sum.shift_count += 1;
    if (!it._iv) continue;
    const a = Math.max(it._iv.startMs, periodStart), b = Math.min(it._iv.endMs, periodEnd);
    if (b > a) { intervals.push([a, b]); sum.gross_minutes += Math.round((b - a) / MIN); }
  }
  for (const [a, b] of mergeIntervals(intervals)) {
    for (const seg of splitByLocalDay(a, b)) {
      sum.planned_minutes += seg.minutes;
      const day = days[seg.date] || (days[seg.date] = { published_minutes: 0, draft_minutes: 0 });
      day[`${bucket}_minutes`] += seg.minutes;
      const wk = weekStartOf(seg.date);
      const week = weeks[wk] || (weeks[wk] = { week_start: wk, published_minutes: 0, draft_minutes: 0 });
      week[`${bucket}_minutes`] += seg.minutes;
    }
  }
  sum.overlap_minutes = sum.gross_minutes - sum.planned_minutes;
  return sum;
}

function overlapWarnings(worker, items) {
  const timed = items.filter((it) => !it.is_on_call && it._iv).sort((a, b) => a._iv.startMs - b._iv.startMs);
  const out = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j]._iv.startMs < timed[i]._iv.endMs; j++) {
      const minutes = Math.round((Math.min(timed[i]._iv.endMs, timed[j]._iv.endMs) - timed[j]._iv.startMs) / MIN);
      out.push({ type: 'OVERLAP', worker_id: worker.worker_id, worker_name: worker.worker_name, date: timed[i].date, minutes,
        shift_ids: [timed[i].id, timed[j].id],
        message: `חפיפה של ${minutes} דקות: ${timed[i].row_label} ${timed[i].start_time}–${timed[i].end_time} / ${timed[j].row_label} ${timed[j].start_time}–${timed[j].end_time}` });
    }
  }
  return out;
}

export function buildScheduleReport({ start, end, shifts, schedules, workers, generatedAt = new Date().toISOString() }) {
  const periodStart = localToUtcMs(start), periodEnd = localToUtcMs(addDays(end, 1));
  const schedById = Object.fromEntries(schedules.map((s) => [s.id, s]));
  const workerById = Object.fromEntries(workers.map((w) => [w.id, w]));
  const excluded = { cancelled: 0, unassigned: 0, missing_schedule: 0, archived_schedule: 0 };
  const warnings = [];
  const rows = {};

  for (const s of shifts) {
    if (s.status !== 'PLANNED') { excluded.cancelled += 1; continue; }
    const iv = shiftInterval(s);
    const inPeriodStart = s.date >= start && s.date <= end;
    const intersects = iv.valid && iv.startMs < periodEnd && iv.endMs > periodStart;
    if (!inPeriodStart && !intersects) continue;
    if (!s.worker_id) { if (inPeriodStart) excluded.unassigned += 1; continue; }
    const sch = schedById[s.work_schedule_id];
    if (!sch) { excluded.missing_schedule += 1; continue; }
    if (sch.status !== 'PUBLISHED' && sch.status !== 'DRAFT') { excluded.archived_schedule += 1; continue; }

    const profile = workerById[s.worker_id];
    const row = rows[s.worker_id] || (rows[s.worker_id] = {
      worker_id: s.worker_id, worker_name: profile?.full_name || s.worker_name || 'עובד ללא שם',
      team: profile?.default_team || 'OTHER', worker_missing: !profile, items: [],
    });
    const isOnCall = s.row_type === ON_CALL_TYPE;
    const periodMinutes = iv.valid ? Math.round((Math.min(iv.endMs, periodEnd) - Math.max(iv.startMs, periodStart)) / MIN) : 0;
    const item = {
      id: s.id, date: s.date, weekday: dayNameOf(s.date), row_type: s.row_type, row_label: s.row_label || s.row_type,
      start_time: s.start_time || '', end_time: s.end_time || '', notes: s.notes || '',
      status: sch.status === 'PUBLISHED' ? 'published' : 'draft', is_on_call: isOnCall,
      minutes: iv.valid ? iv.minutes : 0, period_minutes: Math.max(0, periodMinutes), overnight: !!iv.overnight,
      in_period_start: inPeriodStart, starts_before_period: !inPeriodStart,
      continues_after_period: iv.valid && iv.endMs > periodEnd, invalid_times: !iv.valid && !isOnCall,
      _iv: iv.valid ? iv : null,
    };
    row.items.push(item);
    if (item.invalid_times) warnings.push({ type: 'INVALID_TIMES', worker_id: row.worker_id, worker_name: row.worker_name, date: s.date, shift_ids: [s.id], message: `שעות חסרות או לא תקינות: ${item.row_label} (${item.start_time || '—'}–${item.end_time || '—'})` });
    if (iv.valid && !isOnCall && iv.minutes > LONG_SHIFT_MINUTES) warnings.push({ type: 'LONG_SHIFT', worker_id: row.worker_id, worker_name: row.worker_name, date: s.date, minutes: iv.minutes, shift_ids: [s.id], message: `משמרת ארוכה במיוחד (${fmtMinutes(iv.minutes)} שעות): ${item.row_label} ${item.start_time}–${item.end_time}` });
  }

  const workerRows = Object.values(rows).map((row) => {
    const days = {}, weeks = {};
    const published = summarizeBucket(row.items, 'published', periodStart, periodEnd, days, weeks);
    const draft = summarizeBucket(row.items, 'draft', periodStart, periodEnd, days, weeks);
    if (row.worker_missing) warnings.push({ type: 'MISSING_WORKER', worker_id: row.worker_id, worker_name: row.worker_name, message: `המשמרות משויכות לפרופיל עובד שאינו קיים עוד (${row.worker_name})` });
    warnings.push(...overlapWarnings(row, row.items));
    const items = row.items.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time)).map(({ _iv, ...rest }) => rest);
    const dates = [...new Set([...Object.keys(days), ...items.map((it) => it.date)])].sort();
    return {
      worker_id: row.worker_id, worker_name: row.worker_name, team: row.team, worker_missing: row.worker_missing,
      published, draft,
      days: dates.map((date) => ({ date, weekday: dayNameOf(date), published_minutes: days[date]?.published_minutes || 0, draft_minutes: days[date]?.draft_minutes || 0, items: items.filter((it) => it.date === date) })),
      weeks: Object.values(weeks).sort((a, b) => a.week_start.localeCompare(b.week_start)),
      items,
    };
  }).sort((a, b) => a.worker_name.localeCompare(b.worker_name, 'he'));

  const team = { published: emptyBucket(), draft: emptyBucket() };
  for (const w of workerRows) for (const b of ['published', 'draft']) for (const k of Object.keys(team[b])) team[b][k] += w[b][k];

  const weekStatus = [];
  for (let wk = weekStartOf(start); wk <= end; wk = addDays(wk, 7)) {
    const matches = schedules.filter((s) => s.week_start_date === wk);
    if (matches.length > 1) warnings.push({ type: 'DUPLICATE_SCHEDULE', week_start: wk, message: `נמצאו ${matches.length} סידורים לאותו שבוע (${wk})` });
    const status = matches.some((s) => s.status === 'PUBLISHED') ? 'PUBLISHED' : matches.some((s) => s.status === 'DRAFT') ? 'DRAFT' : matches.length ? matches[0].status : 'MISSING';
    const ids = new Set(matches.map((s) => s.id));
    const assigned = shifts.filter((s) => ids.has(s.work_schedule_id) && s.worker_id && s.status === 'PLANNED' && s.date >= start && s.date <= end).length;
    weekStatus.push({ week_start: wk, week_end: addDays(wk, 6), status, assigned_shift_count: assigned });
  }

  return {
    period: { start, end, days: daysBetween(start, end) + 1, timezone: TZ },
    generated_at: generatedAt,
    basis: 'PLANNED_SHIFTS',
    disclaimer: 'שעות מתוכננות לפי סידור העבודה בלבד. אינן שעות עבודה בפועל, אינן דוח נוכחות ואינן מהוות בסיס לשכר.',
    weeks: weekStatus,
    unpublished_weeks: weekStatus.filter((w) => w.status !== 'PUBLISHED'),
    team,
    workers: workerRows,
    warnings,
    excluded,
  };
}

export function filterReportToWorker(report, workerId) {
  const workers = report.workers.filter((w) => w.worker_id === workerId);
  const team = { published: emptyBucket(), draft: emptyBucket() };
  for (const w of workers) for (const b of ['published', 'draft']) for (const k of Object.keys(team[b])) team[b][k] += w[b][k];
  return { ...report, workers, team, warnings: report.warnings.filter((x) => !x.worker_id || x.worker_id === workerId) };
}

export function fmtMinutes(min) {
  const m = Math.round(min || 0);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
export const fmtDate = (date) => { const [y, m, d] = date.split('-'); return `${d}/${m}/${y}`; };