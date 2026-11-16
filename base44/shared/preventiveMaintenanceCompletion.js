// Completion + correction core (I/O injected as `db`). Must run under withPmLock.
// Every completion is an event; corrections mark the event VOIDED (original fields untouched) and recompute state.
import { israelDate } from './preventiveMaintenanceDates.js';
import { canCompleteTask } from './preventiveMaintenancePolicy.js';

const deny = (status, error) => ({ status, error });
const getOrNull = (entity, id) => entity.get(id).catch((e) => ((e?.status || e?.response?.status) === 404 ? null : Promise.reject(e)));
export const DOUBLE_SUBMIT_MS = 2 * 60 * 1000;

const actorFields = (caller, now) => ({
  completed_at: now.toISOString(), completed_local_date: israelDate(now),
  completed_by_internal_user_id: caller.internalUser.id, completed_by_worker_id: caller.profile?.id || null,
  completed_by_name: caller.actorName, completed_by_role: caller.role,
});
const onBehalfOf = (task, caller) => (task.responsibility_type === 'WORKER' && caller.profile?.id !== task.responsible_worker_id ? task.responsible_worker_id : null);
const occurrenceCompletion = (ev) => ({
  status: 'COMPLETED', completion_event_id: ev.id, completed_at: ev.completed_at, completed_local_date: ev.completed_local_date,
  completed_by_internal_user_id: ev.completed_by_internal_user_id, completed_by_worker_id: ev.completed_by_worker_id || null,
  completed_by_name: ev.completed_by_name, completed_late: !!ev.completed_late,
});
const CLEARED = { status: 'PENDING', completion_event_id: null, completed_at: null, completed_local_date: null, completed_by_internal_user_id: null, completed_by_worker_id: null, completed_by_name: null, completed_late: null };

async function replayOf(db, caller, requestId) {
  const [ev] = await db.MaintenanceCompletionEvent.filter({ event_key: requestId }, 'created_date', 1);
  if (!ev) return null;
  return ev.completed_by_internal_user_id === caller.internalUser.id ? { event: ev } : { conflict: true };
}

async function loadTask(db, caller, taskId) {
  const task = await getOrNull(db.RecurringMaintenanceTask, taskId);
  if (!task || task.is_active === false) return deny(409, 'המשימה אינה פעילה');
  if (!canCompleteTask(caller.access, task)) return deny(403, 'אין הרשאה לסמן משימה זו');
  return { task };
}

export async function completeOccurrence(db, caller, { occurrenceId, requestId, now = new Date() }) {
  const replay = await replayOf(db, caller, requestId);
  if (replay?.conflict) return deny(409, 'מזהה הבקשה כבר שימש');
  if (replay) return { replay: true, event: replay.event };
  const occ = await getOrNull(db.MaintenanceTaskOccurrence, occurrenceId);
  if (!occ) return deny(404, 'המשימה לא נמצאה');
  const t = await loadTask(db, caller, occ.task_id);
  if (t.error) return t;
  const today = israelDate(now);
  if (occ.period_start > today) return deny(409, 'תקופת המשימה עוד לא התחילה');
  const [valid] = await db.MaintenanceCompletionEvent.filter({ occurrence_id: occ.id, status: 'VALID' }, 'completed_at', 1);
  if (valid) {
    if (occ.status !== 'COMPLETED' || occ.completion_event_id !== valid.id) await db.MaintenanceTaskOccurrence.update(occ.id, occurrenceCompletion(valid));
    return { already: true, event: valid };
  }
  const event = await db.MaintenanceCompletionEvent.create({
    event_key: requestId, task_id: t.task.id, task_key: t.task.task_key, task_title_snapshot: occ.title_snapshot,
    recurrence_type: occ.recurrence_type, occurrence_id: occ.id, period_start: occ.period_start, period_end: occ.period_end,
    ...actorFields(caller, now), on_behalf_of_worker_id: onBehalfOf(t.task, caller), completed_late: today > occ.period_end, status: 'VALID',
  });
  await db.MaintenanceTaskOccurrence.update(occ.id, occurrenceCompletion(event));
  return { event };
}

export async function completeUnit(db, caller, { taskId, unitKey, requestId, now = new Date() }) {
  const replay = await replayOf(db, caller, requestId);
  if (replay?.conflict) return deny(409, 'מזהה הבקשה כבר שימש');
  if (replay) return { replay: true, event: replay.event };
  const t = await loadTask(db, caller, taskId);
  if (t.error) return t;
  if (t.task.recurrence_type !== 'EVERY_N_DAYS') return deny(400, 'משימה זו אינה לפי מרווח ימים');
  const unit = (t.task.units || []).find((u) => u.unit_key === unitKey);
  if (!unit) return deny(404, 'היחידה לא נמצאה');
  const [latest] = await db.MaintenanceCompletionEvent.filter({ task_id: t.task.id, unit_key: unit.unit_key, status: 'VALID' }, '-completed_at', 1);
  if (latest && latest.completed_by_internal_user_id === caller.internalUser.id && now.getTime() - Date.parse(latest.completed_at) < DOUBLE_SUBMIT_MS) {
    return { already: true, event: latest };
  }
  const event = await db.MaintenanceCompletionEvent.create({
    event_key: requestId, task_id: t.task.id, task_key: t.task.task_key, task_title_snapshot: t.task.title, recurrence_type: 'EVERY_N_DAYS',
    unit_key: unit.unit_key, unit_label: unit.label, neighborhood_id: unit.neighborhood_id || null,
    ...actorFields(caller, now), on_behalf_of_worker_id: onBehalfOf(t.task, caller), completed_late: false, status: 'VALID',
  });
  return { event };
}

export async function voidEvent(db, caller, { eventId, reason, now = new Date() }) {
  if (!caller.access.isManager) return deny(403, 'רק מנהל יכול לתקן סימון');
  const ev = await getOrNull(db.MaintenanceCompletionEvent, eventId);
  if (!ev) return deny(404, 'הסימון לא נמצא');
  if (ev.status === 'VOIDED') return { already: true, event: ev };
  const voided = { status: 'VOIDED', voided_at: now.toISOString(), voided_by_internal_user_id: caller.internalUser.id, voided_by_name: caller.actorName, void_reason: reason };
  await db.MaintenanceCompletionEvent.update(ev.id, voided);
  if (ev.occurrence_id) {
    const occ = await getOrNull(db.MaintenanceTaskOccurrence, ev.occurrence_id);
    if (occ) {
      const others = (await db.MaintenanceCompletionEvent.filter({ occurrence_id: occ.id, status: 'VALID' }, 'completed_at', 5)).filter((o) => o.id !== ev.id);
      const state = others[0] ? occurrenceCompletion(others[0]) : CLEARED;
      await db.MaintenanceTaskOccurrence.update(occ.id, { ...state, correction_count: (occ.correction_count || 0) + 1 });
    }
  }
  return { event: { ...ev, ...voided } };
}