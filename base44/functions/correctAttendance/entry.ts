import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveAttendanceCaller, attendanceLockKey } from '../../shared/attendanceAuth.js';
import { pmJson as json, pmError, pmResult } from '../../shared/preventiveMaintenanceAuth.js';
import { withLeaseLock } from '../../shared/leaseLock.js';
import { isRequestId, isId } from '../../shared/attendancePolicy.js';
import { saveCorrection, voidRecord } from '../../shared/attendanceCorrection.js';
import { submitRequest, cancelRequest, approveRequest, rejectRequest } from '../../shared/attendanceRequests.js';

const getOr404 = (entity, id) => entity.get(id).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));
const DECISIONS = ['cancel_request', 'approve_request', 'reject_request'];

// תיקון שעות. ADMIN / SUPER_ADMIN correct directly (audited). Everyone else can only SUBMIT a request, which changes
// nothing until a manager approves it. Role is resolved server-side; the client cannot choose the path.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveAttendanceCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    if (!['save', 'void', ...DECISIONS].includes(body.action)) return json({ error: 'פעולה לא מוכרת' }, 400);
    if (!isRequestId(body.request_id)) return json({ error: 'מזהה בקשה חסר או לא תקין' }, 400);
    const now = new Date();

    if (DECISIONS.includes(body.action)) {
      if (!isId(body.correction_request_id)) return json({ error: 'מזהה בקשת תיקון לא תקין' }, 400);
      const r = await getOr404(db.AttendanceCorrectionRequest, body.correction_request_id);
      if (!r) return json({ error: 'הבקשה לא נמצאה' }, 404);
      if (body.action !== 'cancel_request' && !caller.access.isManager) return json({ error: 'רק מנהל יכול לאשר או לדחות בקשות' }, 403);
      const args = { id: r.id, decisionKey: body.request_id, note: body.note || '', now };
      const fn = { cancel_request: cancelRequest, approve_request: approveRequest, reject_request: rejectRequest }[body.action];
      return pmResult(await withLeaseLock(db, 'AttendanceLock', attendanceLockKey(r.worker_profile_id), () => fn(db, caller, args)));
    }

    let workerId, worker = null;
    if (body.record_id !== undefined && body.record_id !== null && body.record_id !== '') {
      if (!isId(body.record_id)) return json({ error: 'מזהה רשומה לא תקין' }, 400);
      const rec = await getOr404(db.AttendanceRecord, body.record_id);
      if (!rec) return json({ error: 'הרשומה לא נמצאה' }, 404);
      workerId = rec.worker_profile_id;
    } else if (body.action === 'save') {
      if (caller.access.isManager && isId(body.worker_profile_id)) workerId = body.worker_profile_id;
      else if (caller.access.canClock) workerId = caller.profile.id;
      else return json({ error: 'יש לבחור עובד' }, 400);
      worker = await getOr404(db.WorkerProfile, workerId);
      if (!worker || worker.is_active === false) return json({ error: 'העובד לא נמצא או אינו פעיל' }, 404);
    } else return json({ error: 'חסר מזהה רשומה' }, 400);

    if (!caller.access.isManager && workerId !== caller.profile?.id) return json({ error: 'אין הרשאה לתקן שעות של עובד אחר' }, 403);

    const recordId = body.record_id || null;
    let run;
    if (caller.access.isManager) {
      run = body.action === 'void'
        ? () => voidRecord(db, caller, { recordId, note: body.note || '', requestId: body.request_id, now })
        : () => saveCorrection(db, caller, { recordId, worker, input: body, requestId: body.request_id, now });
    } else {
      const type = body.action === 'void' ? 'VOID' : recordId ? 'EDIT' : 'ADD';
      run = () => submitRequest(db, caller, { type, recordId, input: body, requestKey: body.request_id, now });
    }
    return pmResult(await withLeaseLock(db, 'AttendanceLock', attendanceLockKey(workerId), run));
  } catch (error) {
    return pmError('correctAttendance', error, 'שגיאה פנימית — רעננו את הדף ובדקו אם הפעולה נשמרה');
  }
}