// Clock-in / clock-out / 13-hour automatic closure. Timestamps always come from the server clock.
// Closing is an atomic compare-and-set on status=ACTIVE, so clock-out and the scheduler can never both close a session.
import { localDateOf } from './workScheduleReport.js';
import { autoCloseDue, minutesBetween, presentRecord } from './attendancePolicy.js';

const bad = (status, error) => ({ status, error });

function closeFields(rec, endIso, nowIso, auto) {
  const worked_minutes = minutesBetween(rec.effective_start_at, endIso);
  return auto
    ? { status: 'AUTO_CLOSED', effective_end_at: endIso, needs_review: true, was_auto_closed: true, auto_closed_at: nowIso, closed_by: 'SYSTEM', worked_minutes }
    : { status: 'CLOSED', clock_out_at: endIso, effective_end_at: endIso, closed_by: 'EMPLOYEE', worked_minutes };
}

async function casClose(db, rec, fields) {
  const res = await db.AttendanceRecord.updateMany({ id: rec.id, status: 'ACTIVE', effective_start_at: rec.effective_start_at }, { $set: fields });
  return res?.updated === 1;
}

// Safety cutoff: an ACTIVE session past start + 13h is closed with end = start + 13h and flagged for review.
export async function closeIfExpired(db, rec, now) {
  if (rec.status !== 'ACTIVE' || Date.parse(rec.auto_close_due_at) > now.getTime()) return false;
  return casClose(db, rec, closeFields(rec, rec.auto_close_due_at, now.toISOString(), true));
}

const findActive = (db, workerId) => db.AttendanceRecord.filter({ worker_profile_id: workerId, status: 'ACTIVE' }, 'effective_start_at', 5);

export async function clockIn(db, caller, { requestId, now = new Date() }) {
  const workerId = caller.profile.id;
  const replay = (await db.AttendanceRecord.filter({ clock_in_request_id: requestId }, 'created_date', 1))[0];
  if (replay) return replay.worker_profile_id === workerId ? { record: presentRecord(replay, now.getTime()), replay: true } : bad(409, 'מזהה בקשה כבר בשימוש');
  for (const r of await findActive(db, workerId)) await closeIfExpired(db, r, now);
  const open = (await findActive(db, workerId))[0];
  if (open) return { record: presentRecord(open, now.getTime()), already: true };
  const nowIso = now.toISOString();
  const rec = await db.AttendanceRecord.create({
    worker_profile_id: workerId, internal_user_id: caller.internalUser.id, worker_name_snapshot: caller.profile.full_name || caller.actorName,
    source: 'CLOCK', status: 'ACTIVE', clock_in_at: nowIso, effective_start_at: nowIso, auto_close_due_at: autoCloseDue(nowIso),
    local_date: localDateOf(now.getTime()), needs_review: false, was_auto_closed: false, is_corrected: false, correction_count: 0,
    clock_in_request_id: requestId,
  });
  return { record: presentRecord(rec, now.getTime()), created: true };
}

export async function clockOut(db, caller, { now = new Date() }) {
  const workerId = caller.profile.id;
  const rec = (await findActive(db, workerId))[0];
  if (!rec) {
    const last = (await db.AttendanceRecord.filter({ worker_profile_id: workerId, status: { $in: ['CLOSED', 'AUTO_CLOSED'] } }, '-effective_start_at', 1))[0];
    return last ? { record: presentRecord(last, now.getTime()), already: true } : bad(409, 'אין עבודה פעילה לסיום');
  }
  const nowIso = now.toISOString();
  const expired = Date.parse(rec.auto_close_due_at) <= now.getTime();
  const ok = await casClose(db, rec, expired ? closeFields(rec, rec.auto_close_due_at, nowIso, true) : closeFields(rec, nowIso, nowIso, false));
  const fresh = await db.AttendanceRecord.get(rec.id);
  return { record: presentRecord(fresh, now.getTime()), auto_closed: fresh.status === 'AUTO_CLOSED', already: !ok };
}

// Scheduled recovery: closes every overdue ACTIVE session (any age), safe to run repeatedly.
export async function closeExpiredSessions(db, now = new Date()) {
  const due = await db.AttendanceRecord.filter({ status: 'ACTIVE', auto_close_due_at: { $lte: now.toISOString() } }, 'auto_close_due_at', 200);
  let closed = 0;
  for (let i = 0; i < due.length; i += 5) {
    const results = await Promise.all(due.slice(i, i + 5).map((r) => closeIfExpired(db, r, now)));
    closed += results.filter(Boolean).length;
  }
  return { checked: due.length, closed };
}