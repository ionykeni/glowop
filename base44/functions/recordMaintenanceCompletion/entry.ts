import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolvePmCaller, pmJson, pmResult, pmError } from '../../shared/preventiveMaintenanceAuth.js';
import { withPmLock } from '../../shared/preventiveMaintenanceLock.js';
import { isRequestId, isId } from '../../shared/preventiveMaintenancePolicy.js';
import { completeOccurrence, completeUnit, voidEvent } from '../../shared/preventiveMaintenanceCompletion.js';

// Records a completion (calendar occurrence or interval unit) or an admin correction.
// Actor identity and timestamp are always resolved on the server; writes are serialized by the module lock.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolvePmCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;

    if (body.action === 'complete') {
      if (!isRequestId(body.request_id)) return pmJson({ error: 'מזהה בקשה חסר או לא תקין' }, 400);
      if (isId(body.occurrence_id)) {
        return pmResult(await withPmLock(db, () => completeOccurrence(db, caller, { occurrenceId: body.occurrence_id, requestId: body.request_id })));
      }
      if (isId(body.task_id) && typeof body.unit_key === 'string' && /^[A-Za-z0-9_]{1,24}$/.test(body.unit_key)) {
        return pmResult(await withPmLock(db, () => completeUnit(db, caller, { taskId: body.task_id, unitKey: body.unit_key, requestId: body.request_id })));
      }
      return pmJson({ error: 'חסר יעד לסימון' }, 400);
    }

    if (body.action === 'void') {
      if (!caller.access.isManager) return pmJson({ error: 'רק מנהל יכול לתקן סימון' }, 403);
      const reason = String(body.reason || '').trim();
      if (!isId(body.event_id)) return pmJson({ error: 'חסר מזהה סימון' }, 400);
      if (!reason || reason.length > 300) return pmJson({ error: 'יש להזין סיבת תיקון (עד 300 תווים)' }, 400);
      return pmResult(await withPmLock(db, () => voidEvent(db, caller, { eventId: body.event_id, reason })));
    }

    return pmJson({ error: 'פעולה לא מוכרת' }, 400);
  } catch (error) {
    return pmError('recordMaintenanceCompletion', error, 'שגיאה פנימית — רענן את הדף ובדוק אם הסימון נשמר');
  }
}