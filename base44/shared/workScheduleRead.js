// Read-only views of WorkSchedule / WorkShift for the "סידור עבודה" page, "המשמרות שלי" and the dashboard panel.
// Identity and role are resolved on the server (resolveCaller); client-supplied roles, emails or worker ids are ignored.
// Each view returns only the fields its screen renders (no created_by / updated_by emails, no contact data).
import { resolveCaller, resolveOwnWorkerProfile } from './workforceAuth.js';
import { SCHEDULE_MANAGER_ROLES, isSunday } from './workforcePolicy.js';

// Mirrors PERMISSIONS.VIEW_WORK_SCHEDULE in src/lib/roles.js
export const SCHEDULE_VIEW_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_STAFF', 'MAINTENANCE'];
export const DASHBOARD_SHIFT_ROWS = ['OPERATIONS_MORNING', 'OPERATIONS_EVENING', 'NIGHT_ON_CALL'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body, status = 200) => Response.json(body, { status });
const forbidden = () => json({ error: 'Forbidden' }, 403);

const scheduleView = (s) => (s ? { id: s.id, week_start_date: s.week_start_date, status: s.status, published_at: s.published_at || '' } : null);

// Full grid row (managers). Non-manager viewers get the same row without worker_id.
const gridShift = (s, withWorkerId) => ({
  id: s.id, work_schedule_id: s.work_schedule_id, date: s.date,
  row_type: s.row_type, row_label: s.row_label || '', row_order: s.row_order,
  ...(withWorkerId ? { worker_id: s.worker_id || '' } : {}),
  worker_name: s.worker_name || '', worker_count: s.worker_count,
  linked_source_shift_id: s.linked_source_shift_id || '', auto_created_from: s.auto_created_from || '',
  start_time: s.start_time || '', end_time: s.end_time || '', notes: s.notes || '', color_key: s.color_key || '', status: s.status,
});

const myShift = (s) => ({
  id: s.id, date: s.date, row_type: s.row_type, row_label: s.row_label || '', row_order: s.row_order,
  start_time: s.start_time || '', end_time: s.end_time || '', notes: s.notes || '', auto_created_from: s.auto_created_from || '', status: s.status,
});

export async function handleWorkScheduleRead(base44, body) {
  const caller = await resolveCaller(base44);
  if (caller.error) return caller.error;
  if (caller.role === 'MECHINA_USER') return forbidden();
  const sr = base44.asServiceRole.entities;
  const isManager = SCHEDULE_MANAGER_ROLES.includes(caller.role);

  // Weekly grid: managers see the week's schedule in any status; other viewers only a PUBLISHED one.
  if (body?.action === 'week') {
    if (!SCHEDULE_VIEW_ROLES.includes(caller.role)) return forbidden();
    if (!isSunday(body.week_start_date)) return json({ error: 'תאריך תחילת שבוע לא תקין' }, 400);
    const query = isManager ? { week_start_date: body.week_start_date } : { week_start_date: body.week_start_date, status: 'PUBLISHED' };
    const schedule = (await sr.WorkSchedule.filter(query))[0] || null;
    const shifts = schedule ? await sr.WorkShift.filter({ work_schedule_id: schedule.id }, 'date', 500) : [];
    return json({ schedule: scheduleView(schedule), shifts: shifts.map((s) => gridShift(s, isManager)) });
  }

  // Own week: PUBLISHED schedule only, PLANNED shifts of the caller's own active WorkerProfile (any role, ADMIN included).
  if (body?.action === 'my_week') {
    if (!isSunday(body.week_start_date)) return json({ error: 'תאריך תחילת שבוע לא תקין' }, 400);
    const profile = await resolveOwnWorkerProfile(base44, caller);
    if (!profile) return json({ profile: null, schedule: null, shifts: [] });
    const schedule = (await sr.WorkSchedule.filter({ week_start_date: body.week_start_date, status: 'PUBLISHED' }))[0] || null;
    const shifts = schedule ? await sr.WorkShift.filter({ work_schedule_id: schedule.id, worker_id: profile.id, status: 'PLANNED' }, 'date', 100) : [];
    return json({ profile: { id: profile.id }, schedule: scheduleView(schedule), shifts: shifts.filter((s) => s.status !== 'CANCELLED').map(myShift) });
  }

  // Dashboard "who is on duty": operations rows of one date. Draft weeks are visible to schedule managers only.
  if (body?.action === 'dashboard_day') {
    const date = String(body.date || '');
    if (!DATE_RE.test(date)) return json({ error: 'תאריך לא תקין' }, 400);
    const planned = (await sr.WorkShift.filter({ date, status: 'PLANNED' })).filter((s) => DASHBOARD_SHIFT_ROWS.includes(s.row_type));
    let visible = planned;
    if (!isManager && planned.length) {
      const ids = [...new Set(planned.map((s) => s.work_schedule_id).filter(Boolean))];
      const published = new Set((ids.length ? await sr.WorkSchedule.filter({ id: { $in: ids } }) : []).filter((s) => s.status === 'PUBLISHED').map((s) => s.id));
      visible = planned.filter((s) => published.has(s.work_schedule_id));
    }
    const missing = [...new Set(visible.filter((s) => !s.worker_name && s.worker_id).map((s) => s.worker_id))];
    const names = missing.length ? Object.fromEntries((await sr.WorkerProfile.filter({ id: { $in: missing } })).map((p) => [p.id, p.full_name || ''])) : {};
    return json({ shifts: visible.map((s) => ({ id: s.id, row_type: s.row_type, worker_name: s.worker_name || names[s.worker_id] || '', start_time: s.start_time || '', end_time: s.end_time || '' })) });
  }

  return json({ error: 'Unsupported action' }, 400);
}