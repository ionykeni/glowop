// Applied attendance corrections. Every change to an existing record writes an audit row FIRST (PENDING), then applies the
// change with a compare-and-set on the values the audit row saw, then marks the audit APPLIED (or CONFLICT).
// Retrying with the same key resumes a PENDING correction, so no change is ever applied without its audit row.
// Direct corrections are ADMIN / SUPER_ADMIN only; employees go through attendanceRequests.js (manager approval).
import { localDateOf } from './workScheduleReport.js';
import { parseTimesInput, checkInterval, findOverlap, overlapError, changeType, presentRecord, autoCloseDue, minutesBetween } from './attendancePolicy.js';

const bad = (status, error) => ({ status, error });
const DAY = 86400000;

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

export async function overlapCheck(db, workerId, startIso, endIso, excludeId) {
  const clash = findOverlap(await neighbours(db, workerId, startIso), startIso, endIso, excludeId);
  return clash ? overlapError(clash) : null;
}

// Simple form (date, start, end, optional note) for an existing record (rec) or a new session (rec = null).
export function validateTimes(input, rec, now) {
  const active = rec?.status === 'ACTIVE';
  const p = parseTimesInput(input, { requireEnd: !active });
  if (p.error) return p;
  if (active && p.data.end_at) return bad(400, 'לסיום עבודה פעילה לחצו על "סיום עבודה"');
  return checkInterval(p.data.start_at, p.data.end_at, now.getTime()) || p;
}
export const intervalEnd = (data) => data.end_at || autoCloseDue(data.start_at);

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

async function auditAndCommit(db, caller, rec, change, key, now) {
  const corr = await db.AttendanceCorrection.create({
    attendance_record_id: rec.id, worker_profile_id: rec.worker_profile_id, request_id: key, state: 'PENDING',
    original_start_at: rec.effective_start_at, original_end_at: rec.effective_end_at || null, original_status: rec.status,
    ...change, ...actor(caller, rec.worker_profile_id, now),
  });
  const conflict = await commit(db, rec, corr);
  return conflict || { record: presentRecord(await db.AttendanceRecord.get(rec.id), now.getTime()), correction_id: corr.id };
}

export const findCorrection = async (db, key) => (await db.AttendanceCorrection.filter({ request_id: key }, 'created_date', 1))[0];

// Completes a correction whose audit row already exists (crash recovery). Applies at most once.
export async function finishCorrection(db, corr, now) {
  if (corr.state === 'CONFLICT') return bad(409, 'הרשומה עודכנה בינתיים — רעננו ונסו שוב');
  let rec = await db.AttendanceRecord.get(corr.attendance_record_id);
  if (corr.state === 'PENDING') {
    if (rec.last_correction_id === corr.id) await db.AttendanceCorrection.update(corr.id, { state: 'APPLIED' });
    else { const conflict = await commit(db, rec, corr); if (conflict) return conflict; }
    rec = await db.AttendanceRecord.get(rec.id);
  }
  return { record: presentRecord(rec, now.getTime()), correction_id: corr.id, replay: true };
}

// Appliers (validation and overlap checks are the caller's job). `extra` links an approved request to its audit row.
export function applyEdit(db, caller, rec, data, key, now, extra = {}) {
  const active = rec.status === 'ACTIVE';
  return auditAndCommit(db, caller, rec, {
    change_type: changeType(rec, data), note: data.note || '', ...extra,
    corrected_start_at: data.start_at, corrected_end_at: active ? null : data.end_at, corrected_status: active ? 'ACTIVE' : 'CLOSED',
  }, key, now);
}

export function applyVoid(db, caller, rec, note, key, now, extra = {}) {
  return auditAndCommit(db, caller, rec, {
    change_type: 'VOID', note, corrected_status: 'VOIDED', ...extra,
    corrected_start_at: rec.effective_start_at, corrected_end_at: rec.effective_end_at || null,
  }, key, now);
}

export const findManualRecord = async (db, key) => (await db.AttendanceRecord.filter({ manual_request_id: key }, 'created_date', 1))[0];

export async function applyAdd(db, caller, worker, data, key, now, extra = {}) {
  let rec = await findManualRecord(db, key);
  if (!rec) {
    rec = await db.AttendanceRecord.create({
      worker_profile_id: worker.id, internal_user_id: caller.internalUser.id, worker_name_snapshot: worker.full_name || '',
      source: 'MANUAL', status: 'CLOSED', effective_start_at: data.start_at, effective_end_at: data.end_at,
      local_date: localDateOf(Date.parse(data.start_at)), worked_minutes: minutesBetween(data.start_at, data.end_at),
      needs_review: false, was_auto_closed: false, is_corrected: true, correction_count: 1,
      last_corrected_at: now.toISOString(), last_corrected_by_name: caller.actorName, manual_request_id: key,
    });
  }
  const corr = (await findCorrection(db, key)) || await db.AttendanceCorrection.create({
    attendance_record_id: rec.id, worker_profile_id: worker.id, request_id: key, state: 'APPLIED', change_type: 'CREATE_MANUAL',
    corrected_start_at: rec.effective_start_at, corrected_end_at: rec.effective_end_at, corrected_status: 'CLOSED', note: data.note || '',
    ...extra, ...actor(caller, worker.id, now),
  });
  return { record: presentRecord(rec, now.getTime()), correction_id: corr.id, created: true };
}

const managerOnly = (caller) => (caller.access.isManager ? null : bad(403, 'תיקון ישיר זמין למנהלים בלבד — יש להגיש בקשת תיקון לאישור'));

async function replayPrior(db, caller, requestId, now) {
  const prior = await findCorrection(db, requestId);
  if (!prior) return null;
  return prior.corrected_by_internal_user_id === caller.internalUser.id ? finishCorrection(db, prior, now) : bad(409, 'מזהה בקשה כבר בשימוש');
}

// Manager direct correction: add a forgotten session (no recordId) or correct an existing one. A note is optional.
export async function saveCorrection(db, caller, { recordId, worker, input, requestId, now = new Date() }) {
  const denied = managerOnly(caller);
  if (denied) return denied;
  const prior = await replayPrior(db, caller, requestId, now);
  if (prior) return prior;
  if (!recordId) {
    const v = validateTimes(input, null, now);
    if (v.error) return v;
    if (!(await findManualRecord(db, requestId))) {
      const clash = await overlapCheck(db, worker.id, v.data.start_at, v.data.end_at);
      if (clash) return clash;
    }
    return applyAdd(db, caller, worker, v.data, requestId, now);
  }
  const rec = await db.AttendanceRecord.get(recordId);
  if (rec.status === 'VOIDED') return bad(409, 'הרשומה בוטלה');
  const v = validateTimes(input, rec, now);
  if (v.error) return v;
  const clash = await overlapCheck(db, rec.worker_profile_id, v.data.start_at, intervalEnd(v.data), rec.id);
  return clash || applyEdit(db, caller, rec, v.data, requestId, now);
}

// Manager direct cancel of a mistaken record. Nothing is deleted: the record becomes VOIDED and the audit keeps its values.
export async function voidRecord(db, caller, { recordId, note = '', requestId, now = new Date() }) {
  const denied = managerOnly(caller);
  if (denied) return denied;
  const prior = await replayPrior(db, caller, requestId, now);
  if (prior) return prior;
  const rec = await db.AttendanceRecord.get(recordId);
  if (rec.status === 'VOIDED') return { record: presentRecord(rec, now.getTime()), already: true };
  if (String(note).length > 300) return bad(400, 'ההערה ארוכה מדי (עד 300 תווים)');
  return applyVoid(db, caller, rec, String(note).trim(), requestId, now);
}