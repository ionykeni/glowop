// Read views for the attendance module. Planned shifts are read for context only and never modified.
import { localToUtcMs, localDateOf, localTimeOf, addDays, weekStartOf, isDate } from './workScheduleReport.js';
import { presentRecord, isId } from './attendancePolicy.js';
import { buildAttendanceTotals } from './attendanceReport.js';
import { closeIfExpired } from './attendanceSession.js';

const DAY = 86400000;
const bad = (status, error) => ({ status, error });
const LIMIT = 1000;
const DISCLAIMER = 'שעות בפועל לפי שעון הנוכחות בלבד. שעות שנסגרו אוטומטית מוצגות בנפרד ואינן שעות מאושרות. אין כאן חישובי שכר.';

// Records whose interval may intersect the local dates [startDate, endDate] (a session lasts at most 24h).
async function recordsInRange(db, startDate, endDate, extra, now) {
  const from = localToUtcMs(startDate), to = localToUtcMs(addDays(endDate, 1));
  const rows = await db.AttendanceRecord.filter({ ...extra, effective_start_at: { $gte: new Date(from - DAY).toISOString(), $lt: new Date(to).toISOString() } }, 'effective_start_at', LIMIT);
  const inRange = rows.filter((r) => {
    const end = r.status === 'ACTIVE' ? Math.min(now, Date.parse(r.auto_close_due_at)) : Date.parse(r.effective_end_at || r.effective_start_at);
    return Date.parse(r.effective_start_at) < to && Math.max(end, Date.parse(r.effective_start_at) + 1) > from;
  });
  return { rows: inRange, limited: rows.length >= LIMIT };
}

// Published, PLANNED shifts (context only). Night on-call is not work time in the existing schedule rules.
async function plannedShifts(db, date, workerId) {
  const shifts = (await db.WorkShift.filter({ date, status: 'PLANNED', ...(workerId ? { worker_id: workerId } : {}) }, 'start_time', 300)).filter((s) => s.worker_id);
  const ids = [...new Set(shifts.map((s) => s.work_schedule_id).filter(Boolean))];
  const published = new Set((ids.length ? await db.WorkSchedule.filter({ id: { $in: ids } }) : []).filter((s) => s.status === 'PUBLISHED').map((s) => s.id));
  return shifts.filter((s) => published.has(s.work_schedule_id)).map((s) => ({
    id: s.id, worker_id: s.worker_id, worker_name: s.worker_name || '', row_type: s.row_type, row_label: s.row_label || '', start_time: s.start_time || '', end_time: s.end_time || '',
  }));
}

const callerView = (caller) => ({ name: caller.actorName, is_manager: caller.access.isManager, can_clock: caller.access.canClock });

export async function myStatus(db, caller, now = new Date()) {
  const base = { server_now: now.toISOString(), caller: callerView(caller) };
  if (!caller.access.canClock) return base;
  const workerId = caller.profile.id;
  let active = await db.AttendanceRecord.filter({ worker_profile_id: workerId, status: 'ACTIVE' }, 'effective_start_at', 5);
  const closed = await Promise.all(active.map((r) => closeIfExpired(db, r, now)));
  if (closed.some(Boolean)) active = await db.AttendanceRecord.filter({ worker_profile_id: workerId, status: 'ACTIVE' }, 'effective_start_at', 5);
  const today = localDateOf(now.getTime());
  const [{ rows }, planned] = await Promise.all([recordsInRange(db, today, today, { worker_profile_id: workerId }, now.getTime()), plannedShifts(db, today, workerId)]);
  return {
    ...base, today, active: active[0] ? presentRecord(active[0], now.getTime()) : null,
    today_records: rows.filter((r) => r.status !== 'VOIDED' && r.status !== 'ACTIVE').map((r) => presentRecord(r, now.getTime())).reverse(),
    planned_today: planned,
  };
}

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || '')) || !isDate(`${month}-01`)) return null;
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
}

export async function myMonth(db, caller, month, now = new Date()) {
  if (!caller.access.canClock) return bad(403, 'אין פרופיל עובד פעיל');
  const range = monthRange(month);
  if (!range) return bad(400, 'חודש לא תקין');
  const { rows, limited } = await recordsInRange(db, range.start, range.end, { worker_profile_id: caller.profile.id }, now.getTime());
  const totals = buildAttendanceTotals(rows, range.start, range.end, now.getTime());
  return { month, ...range, records: rows.map((r) => presentRecord(r, now.getTime())).reverse(), totals: totals.workers[0] || null, limited };
}

export async function recordAudit(db, caller, recordId, now = new Date()) {
  if (!isId(recordId)) return bad(400, 'חסר מזהה רשומה');
  const rec = await db.AttendanceRecord.get(recordId).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
  if (!rec) return bad(404, 'הרשומה לא נמצאה');
  if (!caller.access.isManager && rec.worker_profile_id !== caller.profile?.id) return bad(403, 'אין הרשאה');
  const rows = await db.AttendanceCorrection.filter({ attendance_record_id: rec.id }, 'corrected_at', 200);
  return {
    record: presentRecord(rec, now.getTime()),
    original: { clock_in_at: rec.clock_in_at || null, clock_out_at: rec.clock_out_at || null, auto_closed_at: rec.auto_closed_at || null, source: rec.source || 'CLOCK' },
    corrections: rows.filter((c) => caller.access.isManager || c.state === 'APPLIED').map((c) => ({
      id: c.id, change_type: c.change_type, state: c.state, corrected_at: c.corrected_at, corrected_by_name: c.corrected_by_name, by_manager: !!c.by_manager,
      original_start_at: c.original_start_at || null, original_end_at: c.original_end_at || null, original_status: c.original_status || null,
      corrected_start_at: c.corrected_start_at || null, corrected_end_at: c.corrected_end_at || null, corrected_status: c.corrected_status || null, note: c.note || '',
    })),
  };
}

const activeWorkers = async (db) => (await db.WorkerProfile.filter({ is_active: true }, 'full_name', 500)).map((w) => ({ id: w.id, full_name: w.full_name || '' }));

export async function managerDay(db, caller, { date, worker_id } = {}, now = new Date()) {
  if (!caller.access.isManager) return bad(403, 'זמין למנהלים בלבד');
  const today = localDateOf(now.getTime());
  const day = isDate(date) ? date : today;
  const filter = isId(worker_id) ? { worker_profile_id: worker_id } : {};
  const [{ rows, limited }, planned, workers] = await Promise.all([recordsInRange(db, day, day, filter, now.getTime()), plannedShifts(db, day, filter.worker_profile_id), activeWorkers(db)]);
  const records = rows.map((r) => presentRecord(r, now.getTime()));
  const present = new Set(rows.filter((r) => r.status !== 'VOIDED').map((r) => r.worker_profile_id));
  const nowTime = localTimeOf(now.getTime());
  const missing = day > today ? [] : planned.filter((s) => s.row_type !== 'NIGHT_ON_CALL' && !present.has(s.worker_id) && (day < today || !s.start_time || s.start_time <= nowTime));
  const totals = buildAttendanceTotals(rows, day, day, now.getTime());
  const by = (k) => records.filter((r) => r.display_status === k);
  return {
    date: day, today, limited, workers, totals: totals.workers, team: totals.team,
    sections: { active: by('ACTIVE'), needs_review: by('NEEDS_REVIEW'), corrected: by('CORRECTED'), finished: by('NORMAL'), voided: by('VOIDED') },
    missing,
  };
}

export async function attendanceReport(db, caller, { period, start, worker_id } = {}, now = new Date()) {
  if (!caller.access.isManager) return bad(403, 'זמין למנהלים בלבד');
  let range;
  if (period === 'week') {
    if (!isDate(start) || weekStartOf(start) !== start) return bad(400, 'תחילת שבוע חייבת להיות יום ראשון');
    range = { start, end: addDays(start, 6) };
  } else if (period === 'month') {
    range = monthRange(String(start || '').slice(0, 7));
    if (!range || start !== range.start) return bad(400, 'חודש לא תקין');
  } else return bad(400, 'סוג תקופה לא תקין');
  const filter = isId(worker_id) ? { worker_profile_id: worker_id } : {};
  const [{ rows, limited }, workers] = await Promise.all([recordsInRange(db, range.start, range.end, filter, now.getTime()), activeWorkers(db)]);
  const totals = buildAttendanceTotals(rows, range.start, range.end, now.getTime());
  return { period, ...range, basis: 'ACTUAL_ATTENDANCE', disclaimer: DISCLAIMER, ...totals, workers_list: workers, limited, timezone: 'Asia/Jerusalem' };
}