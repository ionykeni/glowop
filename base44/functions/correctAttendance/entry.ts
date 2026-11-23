import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveAttendanceCaller, attendanceLockKey } from '../../shared/attendanceAuth.js';
import { pmJson as json, pmError, pmResult } from '../../shared/preventiveMaintenanceAuth.js';
import { withLeaseLock } from '../../shared/leaseLock.js';
import { isRequestId, isId } from '../../shared/attendancePolicy.js';
import { saveCorrection, voidRecord } from '../../shared/attendanceCorrection.js';

// תיקון שעות — add a forgotten session, correct start/end, resolve an automatic closure, or cancel a mistaken record.
// Employees may only touch their own records; ADMIN / SUPER_ADMIN may touch anyone's. Every change is audited.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveAttendanceCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    if (body.action !== 'save' && body.action !== 'void') return json({ error: 'פעולה לא מוכרת' }, 400);
    if (!isRequestId(body.request_id)) return json({ error: 'מזהה בקשה חסר או לא תקין' }, 400);

    let workerId, worker = null;
    if (body.record_id !== undefined && body.record_id !== null && body.record_id !== '') {
      if (!isId(body.record_id)) return json({ error: 'מזהה רשומה לא תקין' }, 400);
      const rec = await db.AttendanceRecord.get(body.record_id).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
      if (!rec) return json({ error: 'הרשומה לא נמצאה' }, 404);
      workerId = rec.worker_profile_id;
    } else if (body.action === 'save') {
      if (caller.access.isManager && isId(body.worker_profile_id)) workerId = body.worker_profile_id;
      else if (caller.access.canClock) workerId = caller.profile.id;
      else return json({ error: 'יש לבחור עובד' }, 400);
      worker = await db.WorkerProfile.get(workerId).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
      if (!worker || worker.is_active === false) return json({ error: 'העובד לא נמצא או אינו פעיל' }, 404);
    } else return json({ error: 'חסר מזהה רשומה' }, 400);

    if (!caller.access.isManager && workerId !== caller.profile?.id) return json({ error: 'אין הרשאה לתקן שעות של עובד אחר' }, 403);

    const now = new Date();
    const run = body.action === 'void'
      ? () => voidRecord(db, caller, { recordId: body.record_id, note: body.note || '', requestId: body.request_id, now })
      : () => saveCorrection(db, caller, { recordId: body.record_id || null, worker, input: body, requestId: body.request_id, now });
    return pmResult(await withLeaseLock(db, 'AttendanceLock', attendanceLockKey(workerId), run));
  } catch (error) {
    return pmError('correctAttendance', error, 'שגיאה פנימית — רעננו את הדף ובדקו אם התיקון נשמר');
  }
}