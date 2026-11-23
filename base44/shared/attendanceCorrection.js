// Attendance corrections. Every change to an existing record writes an audit row FIRST (PENDING), then applies the
// change with a compare-and-set on the values the audit row saw, then marks the audit APPLIED (or CONFLICT).
// Retrying with the same request_id resumes a PENDING correction, so no change is ever applied without its audit row.
import { localDateOf } from './workScheduleReport.js';
import { parseTimesInput, checkInterval, findOverlap, overlapError, changeType, presentRecord, autoCloseDue, minutesBetween } from './attendancePolicy.js';

const bad = (status, error) => ({ status, error });
const DAY = 86400000;
const canTouch = (caller, workerId) => caller.access.isManager || (!!caller.profile?.id && caller.profile.id === workerId);

const actor = (caller, workerId, now) => ({
  corrected_by_internal_user_id: caller.internalUser.id, corrected_by_worker_id: caller.profile?.id || null,
  corrected_by_name: caller.actorName, corrected_by_role: caller.role, by_manager: caller.profile?.id !== workerId,
  corrected_at: now.toISOString(),
});

// Same-worker records that could intersect an interval starting at startIso (sessions are at most 24h).
const neighbours = (db, workerId, startIso) => db.AttendanceRecord.filter({
  worker_profile_id: workerId,
  effective_start_at: { $gte: new Date(Date.parse(startIso) - 2 * DAY).toISOString(), $lte: new Date(Date.parse(startIso) + 2 * DAY).toISOString() },
}, 'effective_start_at', 300);

function buildSet(rec, corr) {
  if (corr.change_type === 'VOID') return { status: 'VOIDED', needs_review: false, voided_at: corr.corrected_at, voided_by_name: corr.corrected_by_name };
  const set = {
    status: corr.corrected_status, effective_start_at: corr.corrected_start_at, local_date: localDateOf(Date.parse(corr.corrected_start_at)),
    needs_review: false, is_corrected: true, correction_count: (rec.correction_count || 0) + 1,
    last_corrected_at: corr.corrected_at, last_corrected_by_name: corr.corrected_by_name,
  };
  if (corr.corrected_status === 'ACTIVE') set.auto_close_due_at = autoCloseDue(corr.corrected_start_at);
  else Object.assign(set, { effective_end_at: corr.corrected_end_at, worked_minutes: minutesBetween(corr.corrected_start_at, corr.corrected_end_at) });
  return set;
}

async function commit(db, rec, corr) {
  const res = await db.AttendanceRecord.updateMany(
    { id: rec.id, status: corr.original_status, effective_start_at: corr.original_start_at, effective_end_at: corr.original_end_at || null },
    { $set: { ...buildSet(rec, corr), last_correction_id: corr.id } },
  );
  const ok = res?.updated === 1;
  await db.AttendanceCorrection.update(corr.id, { state: ok ? 'APPLIED' : 'CONFLICT' });
  return ok ? null : bad(409, 'הרשומה עודכנה בינתיים — רעננו ונסו שוב');
}

async function auditAndCommit(db, caller, rec, change, requestId, now) {
  const corr = await db.AttendanceCorrection.create({
    attendance_record_id: rec.id, worker_profile_id: rec.worker_profile_id, request_id: requestId, state: 'PENDING',
    original_start_at: rec.effective_start_at, original_end_at: rec.effective_end_at || null, original_status: rec.status,
    ...change, ...actor(caller, rec.worker_profile_id, now),
  });
  const conflict = await commit(db, rec, corr);
  return conflict || { record: presentRecord(await db.AttendanceRecord.get(rec.id), now.getTime()), correction_id: corr.id };
}

async function resume(db, caller, corr, now) {
  if (corr.corrected_by_internal_user_id !== caller.internalUser.id) return bad(409, 'מזהה בקשה כבר בשימוש');
  if (corr.state === 'CONFLICT') return bad(409, 'הרשומה עודכנה בינתיים — רעננו ונסו שוב');
  let rec = await db.AttendanceRecord.get(corr.attendance_record_id);
  if (corr.state === 'PENDING') {
    if (rec.last_correction_id === corr.id) await db.AttendanceCorrection.update(corr.id, { state: 'APPLIED' });
    else { const conflict = await commit(db, rec, corr); if (conflict) return conflict; }
    rec = await db.AttendanceRecord.get(rec.id);
  }
  return { record: presentRecord(rec, now.getTime()), correction_id: corr.id, replay: true };
}

async function addManual(db, caller, { worker, input, requestId, now }) {
  if (!canTouch(caller, worker.id)) return bad(403, 'אין הרשאה לרשום שעות לעובד אחר');
  const p = parseTimesInput(input, { requireEnd: true });
  if (p.error) return p;
  const invalid = checkInterval(p.data.start_at, p.data.end_at, now.getTime());
  if (invalid) return invalid;
  let rec = (await db.AttendanceRecord.filter({ manual_request_id: requestId }, 'created_date', 1))[0];
  if (!rec) {
    const clash = findOverlap(await neighbours(db, worker.id, p.data.start_at), p.data.start_at, p.data.end_at);
    if (clash) return overlapError(clash);
    rec = await db.AttendanceRecord.create({
      worker_profile_id: worker.id, internal_user_id: caller.internalUser.id, worker_name_snapshot: worker.full_name || '',
      source: 'MANUAL', status: 'CLOSED', effective_start_at: p.data.start_at, effective_end_at: p.data.end_at,
      local_date: localDateOf(Date.parse(p.data.start_at)), worked_minutes: minutesBetween(p.data.start_at, p.data.end_at),
      needs_review: false, was_auto_closed: false, is_corrected: true, correction_count: 1,
      last_corrected_at: now.toISOString(), last_corrected_by_name: caller.actorName, manual_request_id: requestId,
    });
  }
  const corr = await db.AttendanceCorrection.create({
    attendance_record_id: rec.id, worker_profile_id: worker.id, request_id: requestId, state: 'APPLIED', change_type: 'CREATE_MANUAL',
    corrected_start_at: rec.effective_start_at, corrected_end_at: rec.effective_end_at, corrected_status: 'CLOSED', note: p.data.note,
    ...actor(caller, worker.id, now),
  });
  return { record: presentRecord(rec, now.getTime()), correction_id: corr.id, created: true };
}

async function editRecord(db, caller, { recordId, input, requestId, now }) {
  const rec = await db.AttendanceRecord.get(recordId);
  if (!canTouch(caller, rec.worker_profile_id)) return bad(403, 'אין הרשאה לתקן שעות של עובד אחר');
  if (rec.status === 'VOIDED') return bad(409, 'הרשומה בוטלה');
  const active = rec.status === 'ACTIVE';
  const p = parseTimesInput(input, { requireEnd: !active });
  if (p.error) return p;
  if (active && p.data.end_at) return bad(400, 'לסיום עבודה פעילה לחצו על "סיום עבודה"');
  const invalid = checkInterval(p.data.start_at, p.data.end_at, now.getTime());
  if (invalid) return invalid;
  const end = p.data.end_at || autoCloseDue(p.data.start_at);
  const clash = findOverlap(await neighbours(db, rec.worker_profile_id, p.data.start_at), p.data.start_at, end, rec.id);
  if (clash) return overlapError(clash);
  return auditAndCommit(db, caller, rec, {
    change_type: changeType(rec, p.data), note: p.data.note,
    corrected_start_at: p.data.start_at, corrected_end_at: active ? null : p.data.end_at, corrected_status: active ? 'ACTIVE' : 'CLOSED',
  }, requestId, now);
}

// Add a forgotten session (no recordId) or correct an existing one. A note is optional.
export async function saveCorrection(db, caller, { recordId, worker, input, requestId, now = new Date() }) {
  const prior = (await db.AttendanceCorrection.filter({ request_id: requestId }, 'created_date', 1))[0];
  if (prior) return resume(db, caller, prior, now);
  return recordId ? editRecord(db, caller, { recordId, input, requestId, now }) : addManual(db, caller, { worker, input, requestId, now });
}

// Cancels a mistaken record. Nothing is deleted: the record becomes VOIDED and the audit keeps its original values.
export async function voidRecord(db, caller, { recordId, note = '', requestId, now = new Date() }) {
  const prior = (await db.AttendanceCorrection.filter({ request_id: requestId }, 'created_date', 1))[0];
  if (prior) return resume(db, caller, prior, now);
  const rec = await db.AttendanceRecord.get(recordId);
  if (!canTouch(caller, rec.worker_profile_id)) return bad(403, 'אין הרשאה לבטל שעות של עובד אחר');
  if (rec.status === 'VOIDED') return { record: presentRecord(rec, now.getTime()), already: true };
  if (String(note).length > 300) return bad(400, 'ההערה ארוכה מדי (עד 300 תווים)');
  return auditAndCommit(db, caller, rec, {
    change_type: 'VOID', note: String(note).trim(), corrected_status: 'VOIDED',
    corrected_start_at: rec.effective_start_at, corrected_end_at: rec.effective_end_at || null,
  }, requestId, now);
}