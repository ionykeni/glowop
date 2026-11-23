import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { processAttendanceAlerts, scanAttendanceAlerts } from '../../shared/attendanceAlertProcessor.js';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((err) => ((err.status || err.response?.status) === 401 ? null : Promise.reject(err)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const input = await req.json().catch(() => ({}));
    // Validation exercises the real data queries without creating a lock, events or attempts.
    if (input?.mode === 'validate') {
      const events = await scanAttendanceAlerts(base44.asServiceRole.entities, Date.now());
      const summary = events.map(({ event_type, recipient_user_id, worker_id, shift_id, local_date, due_at }) =>
        ({ event_type, recipient_user_id, worker_id, shift_id, local_date, due_at }));
      return Response.json({ ready: true, candidates: events.length, events: summary, writes: false });
    }
    if (input?.mode !== 'scheduled') return Response.json({ error: 'Scheduled invocation required' }, { status: 400 });
    const result = await processAttendanceAlerts(base44.asServiceRole.entities);
    return Response.json(result.value || result, { status: result.value?.failed ? 503 : 200 });
  } catch (error) {
    console.error('[processAttendanceAlerts]', error?.status || error?.response?.status || error?.message);
    return Response.json({ error: 'Attendance notification scan failed' }, { status: 500 });
  }
}