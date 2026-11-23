import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveAttendanceCaller } from '../../shared/attendanceAuth.js';
import { pmJson as json, pmError } from '../../shared/preventiveMaintenanceAuth.js';
import { myMonth, recordAudit, managerDay, attendanceReport } from '../../shared/attendanceRead.js';

// Attendance reads: the employee's own month and audit trail; manager-only day view and actual-hours reports.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveAttendanceCaller(base44, req);
    if (caller.error) return caller.error;
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;
    let out;
    if (body.action === 'my_month') out = await myMonth(db, caller, body.month);
    else if (body.action === 'record_audit') out = await recordAudit(db, caller, body.record_id);
    else if (body.action === 'manager_day') out = await managerDay(db, caller, body.filters || {});
    else if (body.action === 'report') out = await attendanceReport(db, caller, body.filters || {});
    else return json({ error: 'פעולה לא מוכרת' }, 400);
    return out?.error ? json({ error: out.error }, out.status || 400) : json(out);
  } catch (error) {
    return pmError('getAttendance', error, 'שגיאה פנימית בטעינת נתוני הנוכחות');
  }
}