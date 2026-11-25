import { MANAGER_ROLES } from './attendancePolicy.js';
import { requireRole, resolveCaller } from './workforceAuth.js';
import { iso, payrollRange } from './payrollHoursCalendar.js';
import { buildPayrollHoursReport } from './payrollHoursReport.js';

class PayrollScopeError extends Error {}
async function readRows(entity, query, limit) {
  const rows = new Map();
  const seen = new Set();
  let cursor;
  do {
    const page = await entity.filter(query, { sort: 'id', limit: 200, ...(cursor ? { cursor } : {}) });
    for (const row of page.items) rows.set(row.id, row);
    if (!page.has_more) return [...rows.values()];
    if (rows.size >= limit) throw new PayrollScopeError('הדוח חורג ממגבלת התצוגה; יש לבחור עובד אחד. לא הופק דוח חלקי.');
    if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error('Invalid payroll report cursor');
    cursor = page.next_cursor;
    seen.add(cursor);
  } while (cursor);
}

export async function servePayrollHours(base44, req, now = new Date()) {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  if (!req.headers.get('Authorization')) return Response.json({ error: 'נדרשת התחברות' }, { status: 401 });
  const caller = await resolveCaller(base44);
  if (caller.error) return caller.error;
  if (requireRole(caller, MANAGER_ROLES)) return Response.json({ error: 'דוח שעות לשכר זמין למנהלים בלבד' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const db = base44.asServiceRole.entities;
  try {
    if (body?.action === 'directory') {
      const workers = (await readRows(db.WorkerProfile, {}, 4000)).map((p) => ({ id: p.id, full_name: p.full_name || 'עובד ללא שם' }));
      workers.sort((a, b) => a.full_name.localeCompare(b.full_name, 'he'));
      return Response.json({ workers }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const month = body?.month, workerId = body?.worker_id;
    const range = payrollRange(month);
    const validWorker = workerId == null || (typeof workerId === 'string' && /^[0-9a-f]{24}$/i.test(workerId));
    if (!range || !validWorker) return Response.json({ error: 'יש לבחור חודש ועובד תקינים' }, { status: 400 });
    const scope = workerId ? { worker_profile_id: workerId } : {};
    const lo = iso(range.lower), hi = iso(range.upper);
    const [records, requests, arrangements, profiles] = await Promise.all([
      readRows(db.AttendanceRecord, { ...scope, status: { $ne: 'VOIDED' }, $or: [
        { effective_start_at: { $gte: lo, $lt: hi } },
        { effective_start_at: { $lt: lo }, effective_end_at: { $gt: lo } },
        { status: 'ACTIVE', effective_start_at: { $lt: lo }, auto_close_due_at: { $gt: lo } },
        { local_date: { $gte: range.from, $lte: range.through } },
      ] }, 4000),
      // Open requests can move a record from a date outside the report into it or vice versa.
      readRows(db.AttendanceCorrectionRequest, { ...scope, status: { $in: ['PENDING', 'APPROVING'] } }, 2000),
      readRows(db.PayrollHoursArrangement, { ...scope, effective_from: { $lte: range.through }, effective_through: { $gte: range.from } }, 2000),
      readRows(db.WorkerProfile, workerId ? { id: workerId } : {}, 2000),
    ]);
    const report = buildPayrollHoursReport({ records, requests, arrangements, profiles, workerId, range, now: now.getTime() });
    if (workerId && !report.workers.length) return Response.json({ error: 'העובד לא נמצא' }, { status: 404 });
    return Response.json({ ...report, month, worker_id: workerId || null, generated_at: now.toISOString(), payroll_ready: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof PayrollScopeError) return Response.json({ error: error.message }, { status: 422 });
    throw error;
  }
}