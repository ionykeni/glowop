// בקשות תיקון שעות — employee correction REQUESTS. A request never touches AttendanceRecord until ADMIN / SUPER_ADMIN
// approves it. Callers run every write for one worker under that worker's AttendanceLock; decisions are additionally a
// compare-and-set on the request status, so concurrent managers produce exactly one final decision.
// Approval: revalidate → claim (PENDING→APPROVING) → apply once (audit key derived from the decision) → APPROVED.
import { localDateOf } from './workScheduleReport.js';
import { minutesBetween, checkInterval, autoCloseDue } from './attendancePolicy.js';
import { validateTimes, intervalEnd, overlapCheck, applyEdit, applyAdd, applyVoid, findCorrection, finishCorrection } from './attendanceCorrection.js';

const bad = (status, error) => ({ status, error });
export const OPEN_STATUSES = ['PENDING', 'APPROVING'];
const OUTDATED = 'הרשומה השתנתה מאז הגשת הבקשה — יש לדחות את הבקשה, והעובד יוכל להגיש בקשה חדשה';
const DONE_MSG = { APPROVED: 'הבקשה כבר אושרה', REJECTED: 'הבקשה כבר נדחתה', CANCELLED: 'העובד ביטל את הבקשה', APPROVING: 'הבקשה בתהליך אישור', PENDING: 'הבקשה עדיין ממתינה' };
const get = (db, id) => db.AttendanceCorrectionRequest.get(id);
const getRecord = (db, id) => db.AttendanceRecord.get(id).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));

// True when the target record no longer has the values the employee saw when submitting.
export function isOutdated(r, rec) {
  if (r.request_type === 'ADD') return false;
  if (!rec) return true;
  return rec.status !== r.original_status || rec.effective_start_at !== r.original_start_at || (rec.effective_end_at || null) !== (r.original_end_at || null);
}

const mins = (s, e) => (s && e ? minutesBetween(s, e) : null);

export function presentRequest(r, rec) {
  return {
    id: r.id, request_type: r.request_type, status: r.status, worker_id: r.worker_profile_id, worker_name: r.worker_name_snapshot || '',
    local_date: r.local_date, attendance_record_id: r.attendance_record_id || r.applied_record_id || null,
    original_start_at: r.original_start_at || null, original_end_at: r.original_end_at || null, original_status: r.original_status || null,
    original_minutes: mins(r.original_start_at, r.original_end_at),
    requested_start_at: r.requested_start_at || null, requested_end_at: r.requested_end_at || null,
    requested_minutes: r.request_type === 'VOID' ? 0 : mins(r.requested_start_at, r.requested_end_at),
    note: r.note || '', requested_at: r.requested_at, requested_by_name: r.requested_by_name || '',
    decided_at: r.decided_at || null, decided_by_name: r.decided_by_name || null, decision_note: r.decision_note || '',
    decision_error: r.decision_error || null, outdated: rec !== undefined && OPEN_STATUSES.includes(r.status) && isOutdated(r, rec),
  };
}

const noteOf = (v) => String(v ?? '').trim();

// Employee submission. type: EDIT (recordId + times), ADD (times), VOID (recordId). The note is optional.
export async function submitRequest(db, caller, { type, recordId, input = {}, requestKey, now = new Date() }) {
  if (!caller.access.canClock) return bad(403, 'אין פרופיל עובד פעיל');
  const workerId = caller.profile.id;
  const prior = (await db.AttendanceCorrectionRequest.filter({ request_key: requestKey }, 'created_date', 1))[0];
  if (prior) return prior.requested_by_internal_user_id === caller.internalUser.id ? { request: presentRequest(prior), pending: true, replay: true } : bad(409, 'מזהה בקשה כבר בשימוש');
  let rec = null;
  if (type !== 'ADD') {
    rec = await getRecord(db, recordId);
    if (!rec) return bad(404, 'הרשומה לא נמצאה');
    if (rec.worker_profile_id !== workerId) return bad(403, 'אין הרשאה לבקש תיקון לשעות של עובד אחר');
    if (rec.status === 'VOIDED') return bad(409, 'הרשומה בוטלה');
    const open = await db.AttendanceCorrectionRequest.filter({ attendance_record_id: rec.id, status: { $in: OPEN_STATUSES } }, 'created_date', 1);
    if (open.length) return bad(409, 'כבר קיימת בקשה ממתינה לרשומה זו — אפשר לבטל אותה ולהגיש מחדש');
  }
  let data;
  if (type === 'VOID') {
    const note = noteOf(input.note);
    if (note.length > 300) return bad(400, 'ההערה ארוכה מדי (עד 300 תווים)');
    data = { start_at: null, end_at: null, note };
  } else {
    const v = validateTimes(input, rec, now);
    if (v.error) return v;
    data = v.data;
    const clash = await overlapCheck(db, workerId, data.start_at, intervalEnd(data), rec?.id);
    if (clash) return clash;
    if (type === 'ADD') {
      const open = await db.AttendanceCorrectionRequest.filter({ worker_profile_id: workerId, request_type: 'ADD', status: { $in: OPEN_STATUSES } }, 'requested_start_at', 100);
      if (open.some((o) => data.start_at < o.requested_end_at && data.end_at > o.requested_start_at)) return bad(409, 'כבר קיימת בקשה ממתינה להוספת שעות חופפות');
    }
  }
  const created = await db.AttendanceCorrectionRequest.create({
    request_key: requestKey, request_type: type, status: 'PENDING', attendance_record_id: rec?.id || null,
    worker_profile_id: workerId, worker_name_snapshot: caller.profile.full_name || caller.actorName,
    local_date: data.start_at ? localDateOf(Date.parse(data.start_at)) : rec.local_date,
    original_start_at: rec?.effective_start_at || null, original_end_at: rec?.effective_end_at || null, original_status: rec?.status || null,
    requested_start_at: data.start_at, requested_end_at: data.end_at, note: data.note,
    requested_by_internal_user_id: caller.internalUser.id, requested_by_worker_id: workerId, requested_by_name: caller.actorName,
    requested_at: now.toISOString(),
  });
  return { request: presentRequest(created), pending: true, created: true };
}

// Employee withdraws their own PENDING request (then may resubmit).
export async function cancelRequest(db, caller, { id, now = new Date() }) {
  const r = await get(db, id);
  if (r.requested_by_internal_user_id !== caller.internalUser.id) return bad(403, 'אפשר לבטל רק בקשה שהגשת');
  if (r.status === 'CANCELLED') return { request: presentRequest(r), already: true };
  if (r.status !== 'PENDING') return bad(409, DONE_MSG[r.status]);
  const res = await db.AttendanceCorrectionRequest.updateMany({ id, status: 'PENDING' }, { $set: { status: 'CANCELLED', cancelled_at: now.toISOString() } });
  const fresh = await get(db, id);
  return res?.updated === 1 ? { request: presentRequest(fresh) } : bad(409, DONE_MSG[fresh.status]);
}

const decider = (caller, decisionKey, note, now) => ({
  decision_key: decisionKey, decided_by_internal_user_id: caller.internalUser.id, decided_by_name: caller.actorName,
  decided_at: now.toISOString(), decision_note: noteOf(note), decision_error: null,
});

function guardManager(caller, r, note) {
  if (!caller.access.isManager) return bad(403, 'רק מנהל יכול לאשר או לדחות בקשות');
  if (r.requested_by_internal_user_id === caller.internalUser.id) return bad(403, 'לא ניתן להחליט על בקשה שהגשת בעצמך');
  if (noteOf(note).length > 300) return bad(400, 'ההערה ארוכה מדי (עד 300 תווים)');
  return null;
}

const settled = (r, decisionKey, status) => (r.status === status && r.decision_key === decisionKey ? { request: presentRequest(r), replay: true } : bad(409, DONE_MSG[r.status]));

export async function rejectRequest(db, caller, { id, decisionKey, note = '', now = new Date() }) {
  const r = await get(db, id);
  const denied = guardManager(caller, r, note);
  if (denied) return denied;
  if (r.status !== 'PENDING') return settled(r, decisionKey, 'REJECTED');
  const res = await db.AttendanceCorrectionRequest.updateMany({ id, status: 'PENDING' }, { $set: { status: 'REJECTED', ...decider(caller, decisionKey, note, now) } });
  const fresh = await get(db, id);
  return res?.updated === 1 ? { request: presentRequest(fresh) } : settled(fresh, decisionKey, 'REJECTED');
}

// Revalidated against CURRENT attendance data: unchanged record, valid duration, no overlap.
async function revalidate(db, r, now) {
  const rec = r.request_type === 'ADD' ? null : await getRecord(db, r.attendance_record_id);
  if (isOutdated(r, rec)) return bad(409, OUTDATED);
  if (r.request_type === 'VOID') return null;
  const invalid = checkInterval(r.requested_start_at, r.requested_end_at, now.getTime());
  if (invalid) return invalid;
  return overlapCheck(db, r.worker_profile_id, r.requested_start_at, r.requested_end_at || autoCloseDue(r.requested_start_at), rec?.id);
}

async function applyApproved(db, caller, r, now) {
  const key = `APPROVE|${r.decision_key}`;
  const prior = await findCorrection(db, key);
  if (prior) return finishCorrection(db, prior, now);
  const extra = { source_request_id: r.id, requested_by_name: r.requested_by_name || '', requested_at: r.requested_at };
  const data = { start_at: r.requested_start_at, end_at: r.requested_end_at || null, note: r.note || '' };
  if (r.request_type === 'ADD') return applyAdd(db, caller, { id: r.worker_profile_id, full_name: r.worker_name_snapshot }, data, key, now, extra);
  const rec = await getRecord(db, r.attendance_record_id);
  if (isOutdated(r, rec)) return bad(409, OUTDATED);
  return r.request_type === 'VOID' ? applyVoid(db, caller, rec, data.note, key, now, extra) : applyEdit(db, caller, rec, data, key, now, extra);
}

export async function approveRequest(db, caller, { id, decisionKey, note = '', now = new Date() }) {
  let r = await get(db, id);
  const denied = guardManager(caller, r, note);
  if (denied) return denied;
  if (r.status === 'PENDING') {
    const invalid = await revalidate(db, r, now);
    if (invalid) return invalid;
    const res = await db.AttendanceCorrectionRequest.updateMany({ id, status: 'PENDING' }, { $set: { status: 'APPROVING', ...decider(caller, decisionKey, note, now) } });
    r = await get(db, id);
    if (res?.updated !== 1) return settled(r, decisionKey, 'APPROVED');
  } else if (r.status !== 'APPROVING') return settled(r, decisionKey, 'APPROVED');
  // APPROVING: claimed just now, or an interrupted earlier approval being resumed. The audit key makes it apply once.
  const out = await applyApproved(db, caller, r, now);
  if (out.error) {
    await db.AttendanceCorrectionRequest.updateMany({ id, status: 'APPROVING', decision_key: r.decision_key }, {
      $set: { status: 'PENDING', decision_key: null, decided_by_internal_user_id: null, decided_by_name: null, decided_at: null, decision_error: out.error },
    });
    return out;
  }
  await db.AttendanceCorrectionRequest.updateMany({ id, status: 'APPROVING' }, { $set: { status: 'APPROVED', applied_correction_id: out.correction_id, applied_record_id: out.record.id } });
  return { request: presentRequest(await get(db, id)), record: out.record };
}

// ── Reads ──
export async function myRequests(db, caller) {
  if (!caller.access.canClock) return bad(403, 'אין פרופיל עובד פעיל');
  const rows = await db.AttendanceCorrectionRequest.filter({ worker_profile_id: caller.profile.id }, '-requested_at', 50);
  return { requests: rows.map((r) => presentRequest(r)) };
}

// Open requests of one worker keyed by record id (shown as "ממתין לאישור" on that record).
export async function openRequestsByRecord(db, workerId) {
  const rows = await db.AttendanceCorrectionRequest.filter({ worker_profile_id: workerId, status: { $in: OPEN_STATUSES } }, 'requested_at', 100);
  return Object.fromEntries(rows.filter((r) => r.attendance_record_id).map((r) => [r.attendance_record_id, presentRequest(r)]));
}

export const pendingCount = async (db) => (await db.AttendanceCorrectionRequest.filter({ status: { $in: OPEN_STATUSES } }, 'requested_at', 200)).length;

export async function managerRequests(db, caller) {
  if (!caller.access.isManager) return bad(403, 'זמין למנהלים בלבד');
  const [open, recent] = await Promise.all([
    db.AttendanceCorrectionRequest.filter({ status: { $in: OPEN_STATUSES } }, 'requested_at', 200),
    db.AttendanceCorrectionRequest.filter({ status: { $in: ['APPROVED', 'REJECTED'] } }, '-decided_at', 30),
  ]);
  const ids = [...new Set(open.map((r) => r.attendance_record_id).filter(Boolean))];
  const recs = ids.length ? await db.AttendanceRecord.filter({ id: { $in: ids } }, 'effective_start_at', 200) : [];
  const byId = Object.fromEntries(recs.map((x) => [x.id, x]));
  return {
    pending: open.map((r) => presentRequest(r, r.request_type === 'ADD' ? null : byId[r.attendance_record_id] || null)),
    recent: recent.map((r) => presentRequest(r)),
  };
}