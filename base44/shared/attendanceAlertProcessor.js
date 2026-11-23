import { buildAttendanceAlerts, GRACE, HOUR } from './attendanceAlertRules.js';
import { addDays, localDateOf } from './workScheduleReport.js';
import { withLeaseLock } from './leaseLock.js';
import { dispatchInApp } from './notificationDelivery.js';

const iso = (ms) => new Date(ms).toISOString();
async function all(entity, filter) {
  const items = [];
  let cursor;
  do {
    const page = await entity.filter(filter, { sort: 'id', limit: 200, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (!page.has_more) return items;
    if (!page.next_cursor || page.next_cursor === cursor) throw new Error('Invalid notification scan cursor');
    cursor = page.next_cursor;
  } while (cursor);
  return items;
}

// Built-in User uses the legacy list API rather than the cursor form.
async function appUsers(User) {
  const rows = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const page = await User.list('id', limit, offset, ['id', 'email']);
    if (offset && page.length && page[0].id === rows[0].id) throw new Error('App user pagination did not advance');
    rows.push(...page);
    if (page.length < limit) return rows;
  }
}

export async function scanAttendanceAlerts(db, now) {
    const today = localDateOf(now);
    const firstDate = addDays(localDateOf(now - GRACE), -1);
    const [attendance, shifts] = await Promise.all([
      all(db.AttendanceRecord, { status: { $in: ['ACTIVE', 'CLOSED', 'AUTO_CLOSED'] }, effective_start_at: { $gte: iso(now - 72 * HOUR), $lte: iso(now) } }),
      all(db.WorkShift, { status: 'PLANNED', date: { $gte: firstDate, $lte: today } }),
    ]);
    const workerIds = [...new Set([...shifts.map((s) => s.worker_id), ...attendance.map((r) => r.worker_profile_id)].filter(Boolean))];
    const scheduleIds = [...new Set(shifts.map((s) => s.work_schedule_id).filter(Boolean))];
    const [profiles, schedules, users, internals] = await Promise.all([
      workerIds.length ? all(db.WorkerProfile, { id: { $in: workerIds } }) : [],
      scheduleIds.length ? all(db.WorkSchedule, { id: { $in: scheduleIds }, status: 'PUBLISHED' }) : [],
      workerIds.length ? appUsers(db.User) : [],
      shifts.length ? all(db.InternalUser, { active: true }) : [],
    ]);
    const events = workerIds.length ? buildAttendanceAlerts({ now, attendance, shifts, schedules, profiles, users, internals,
      warn: (email) => console.warn('[attendance notifications] management account missing or ambiguous:', email),
    }) : [];
    return events;
}

export async function processAttendanceAlerts(db, nowFn = Date.now) {
  return withLeaseLock(db, 'AttendanceNotificationLock', 'ATTENDANCE_ALERTS', async () => {
    const now = nowFn();
    const events = await scanAttendanceAlerts(db, now);
    return { candidates: events.length, ...await dispatchInApp(db, events, iso(now)) };
  }, { leaseMs: 6 * 60 * 1000, attempts: 1 });
}