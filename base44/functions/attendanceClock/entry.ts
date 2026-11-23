import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveAttendanceCaller, attendanceLockKey } from '../../shared/attendanceAuth.js';
import { pmJson as json, pmError, pmResult } from '../../shared/preventiveMaintenanceAuth.js';
import { withLeaseLock } from '../../shared/leaseLock.js';
import { isRequestId } from '../../shared/attendancePolicy.js';
import { clockIn, clockOut } from '../../shared/attendanceSession.js';
import { myStatus } from '../../shared/attendanceRead.js';

// שעון נוכחות — the employee's own clock. Worker identity and timestamps are resolved on the server only.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveAttendanceCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;

    if (body.action === 'status') return json(await myStatus(db, caller));
    if (body.action !== 'clock_in' && body.action !== 'clock_out') return json({ error: 'פעולה לא מוכרת' }, 400);
    if (!caller.access.canClock) return json({ error: 'נדרש פרופיל עובד פעיל המקושר למשתמש' }, 403);
    if (!isRequestId(body.request_id)) return json({ error: 'מזהה בקשה חסר או לא תקין' }, 400);

    const run = body.action === 'clock_in'
      ? () => clockIn(db, caller, { requestId: body.request_id, now: new Date() })
      : () => clockOut(db, caller, { now: new Date() });
    return pmResult(await withLeaseLock(db, 'AttendanceLock', attendanceLockKey(caller.profile.id), run));
  } catch (error) {
    return pmError('attendanceClock', error, 'שגיאה פנימית — רעננו את הדף ובדקו אם הפעולה נשמרה');
  }
}