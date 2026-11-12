import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveCaller, requireRole } from '../../shared/workforceAuth.js';
import { SCHEDULE_MANAGER_ROLES, SHIFT_ROWS, NIGHT_ON_CALL_SOURCE, validateShiftInput, isSunday, addDays } from '../../shared/workforcePolicy.js';

// All WorkSchedule / WorkShift writes of the "סידור עבודה" page (schedule managers only).
// Same behavior as the former browser-side writes: linked night on-call, weekly copy, publish.
const notFound = (e) => ((e?.status || e?.response?.status) === 404 ? null : Promise.reject(e));
const bad = (error, status = 400) => Response.json({ error }, { status });

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveCaller(base44);
    if (caller.error) return caller.error;
    const denied = requireRole(caller, SCHEDULE_MANAGER_ROLES);
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const by = caller.email;
    const sr = base44.asServiceRole.entities;
    const getShift = (id) => (id ? sr.WorkShift.get(String(id)).catch(notFound) : null);
    const getSchedule = (id) => (id ? sr.WorkSchedule.get(String(id)).catch(notFound) : null);
    const ensureSchedule = async (weekStart) => {
      const existing = await sr.WorkSchedule.filter({ week_start_date: weekStart });
      return existing[0] || await sr.WorkSchedule.create({ week_start_date: weekStart, status: 'DRAFT', created_by: by });
    };
    const linkedNights = (shift) => sr.WorkShift.filter({ work_schedule_id: shift.work_schedule_id, linked_source_shift_id: shift.id, auto_created_from: NIGHT_ON_CALL_SOURCE }, '-created_date', 50);
    const deleteLinkedNights = async (shift) => {
      const linked = await linkedNights(shift);
      await Promise.all(linked.map((s) => sr.WorkShift.delete(s.id).catch(notFound)));
    };
    const log = (detail) => console.log('[manageWorkSchedule]', JSON.stringify({ by, action: body.action, ...detail }));

    if (body.action === 'ensure_schedule') {
      if (!isSunday(body.week_start_date)) return bad('תאריך תחילת שבוע לא תקין');
      const schedule = await ensureSchedule(body.week_start_date);
      return Response.json({ schedule });
    }

    if (body.action === 'save_shift') {
      const existing = body.shift_id ? await getShift(body.shift_id) : null;
      if (body.shift_id && !existing) return bad('המשמרת לא נמצאה', 404);
      let schedule = existing ? await getSchedule(existing.work_schedule_id) : null;
      if (existing && !schedule) return bad('סידור העבודה לא נמצא', 404);
      const weekStart = existing ? schedule.week_start_date : body.week_start_date;
      if (!existing && !isSunday(weekStart)) return bad('תאריך תחילת שבוע לא תקין');

      // Validate everything before any write (a rejected new shift never creates a schedule)
      const input = body.shift || {};
      const v = validateShiftInput(input, weekStart);
      if (v.error) return bad(v.error, v.status);
      let worker = { id: '', full_name: '' };
      if (v.needsWorker) {
        const profile = await sr.WorkerProfile.get(String(input.worker_id)).catch(notFound);
        if (!profile) return bad('העובד לא נמצא');
        if (profile.is_active === false && profile.id !== existing?.worker_id) return bad('העובד אינו פעיל');
        worker = profile;
      }
      const data = { ...v.payload, worker_id: worker.id, worker_name: worker.full_name || '', updated_by: by };

      if (!existing) {
        schedule = await ensureSchedule(weekStart);
        const created = await sr.WorkShift.create({ ...data, work_schedule_id: schedule.id, created_by: by });
        log({ shift: created.id });
        return Response.json({ shift: created });
      }
      const updated = await sr.WorkShift.update(existing.id, data);
      if (existing.row_type === 'OPERATIONS_EVENING') {
        const linked = await linkedNights(existing);
        await Promise.all(linked.map((n) => (data.row_type === 'OPERATIONS_EVENING'
          ? sr.WorkShift.update(n.id, { date: data.date, worker_id: data.worker_id, worker_name: data.worker_name, updated_by: by })
          : sr.WorkShift.delete(n.id).catch(notFound))));
      }
      log({ shift: existing.id });
      return Response.json({ shift: updated });
    }

    if (body.action === 'cancel_shift' || body.action === 'delete_shift') {
      const shift = await getShift(body.shift_id);
      if (!shift) return body.action === 'delete_shift' ? Response.json({ success: true, already_deleted: true }) : bad('המשמרת לא נמצאה', 404);
      if (shift.row_type === 'OPERATIONS_EVENING') await deleteLinkedNights(shift);
      if (body.action === 'cancel_shift') await sr.WorkShift.update(shift.id, { status: 'CANCELLED', updated_by: by });
      else await sr.WorkShift.delete(shift.id).catch(notFound);
      log({ shift: shift.id });
      return Response.json({ success: true });
    }

    if (body.action === 'toggle_night_on_call') {
      const shift = await getShift(body.shift_id);
      if (!shift) return bad('המשמרת לא נמצאה', 404);
      if (shift.row_type !== 'OPERATIONS_EVENING') return bad('כונן לילה מקושר נוצר רק ממשמרת תפעול ערב');
      if (typeof body.enabled !== 'boolean') return bad('ערך לא תקין');
      const linked = await linkedNights(shift);
      if (!body.enabled) {
        await Promise.all(linked.map((s) => sr.WorkShift.delete(s.id).catch(notFound)));
      } else if (!linked.some((s) => s.status === 'PLANNED')) {
        const night = SHIFT_ROWS.NIGHT_ON_CALL;
        await sr.WorkShift.create({
          work_schedule_id: shift.work_schedule_id, date: shift.date, row_type: 'NIGHT_ON_CALL', row_label: night.label, row_order: night.order,
          worker_id: shift.worker_id || '', worker_name: shift.worker_name || '', notes: 'נוצר מתפעול ערב', status: 'PLANNED',
          linked_source_shift_id: shift.id, auto_created_from: NIGHT_ON_CALL_SOURCE, created_by: by,
        });
      }
      log({ shift: shift.id, enabled: body.enabled });
      return Response.json({ success: true });
    }

    if (body.action === 'copy_previous_week') {
      const weekStart = body.week_start_date;
      if (!isSunday(weekStart)) return bad('תאריך תחילת שבוע לא תקין');
      const prev = (await sr.WorkSchedule.filter({ week_start_date: addDays(weekStart, -7) }))[0];
      if (!prev) return Response.json({ status: 'no_previous' });
      const prevShifts = await sr.WorkShift.filter({ work_schedule_id: prev.id, status: 'PLANNED' }, 'date', 500);
      if (!prevShifts.length) return Response.json({ status: 'no_shifts' });
      const target = await ensureSchedule(weekStart);
      await sr.WorkShift.bulkCreate(prevShifts.map((s) => {
        const isCleaning = s.row_type === 'HOUSEKEEPING_MORNING' || s.row_type === 'HOUSEKEEPING_EVENING';
        return {
          work_schedule_id: target.id, date: addDays(s.date, 7), row_type: s.row_type, row_label: s.row_label, row_order: s.row_order,
          worker_id: isCleaning ? '' : (s.worker_id || undefined), worker_name: isCleaning ? '' : (s.worker_name || undefined),
          start_time: isCleaning ? '' : (s.start_time || undefined), end_time: isCleaning ? '' : (s.end_time || undefined),
          worker_count: s.worker_count || undefined, notes: s.notes || undefined, status: 'PLANNED', created_by: by,
        };
      }));
      log({ week: weekStart, count: prevShifts.length });
      return Response.json({ status: 'copied', count: prevShifts.length, schedule_id: target.id });
    }

    if (body.action === 'publish') {
      const schedule = await getSchedule(body.schedule_id);
      if (!schedule) return bad('סידור העבודה לא נמצא', 404);
      const saved = await sr.WorkSchedule.update(schedule.id, { status: 'PUBLISHED', published_at: new Date().toISOString(), updated_by: by });
      log({ schedule: schedule.id });
      return Response.json({ schedule: saved });
    }

    return bad('Unsupported action');
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}