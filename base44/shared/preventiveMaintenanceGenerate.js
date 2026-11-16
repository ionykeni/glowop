// Duplicate-safe generation of calendar occurrences (WEEKLY / MONTHLY). Must run under withPmLock.
// Starts at each task's tracking_start_date: nothing is generated for periods before activation.
import { periodsBetween } from './preventiveMaintenanceDates.js';
import { CALENDAR_TYPES } from './preventiveMaintenancePolicy.js';

export const MAX_CATCHUP = { WEEKLY: 8, MONTHLY: 3 };
export const occurrenceKey = (taskId, periodStart) => `${taskId}|${periodStart}`;

export function plannedPeriods(task, today) {
  if (task.is_active === false || !CALENDAR_TYPES.includes(task.recurrence_type)) return [];
  const from = task.tracking_start_date || today;
  if (from > today) return [];
  return periodsBetween(task.recurrence_type, from, today, MAX_CATCHUP[task.recurrence_type]);
}

export function buildOccurrence(task, period, nowIso, by) {
  return {
    occurrence_key: occurrenceKey(task.id, period.start),
    task_id: task.id, task_key: task.task_key, task_version: task.version || 1,
    recurrence_type: task.recurrence_type, title_snapshot: task.title, area_snapshot: task.area_label || '',
    responsibility_type: task.responsibility_type, responsible_worker_id: task.responsible_worker_id || null,
    responsible_name_snapshot: task.responsible_name_snapshot || null,
    period_start: period.start, period_end: period.end, status: 'PENDING', correction_count: 0,
    generated_at: nowIso, generated_by: by,
  };
}

export async function generateOccurrences(db, today, by, onlyTaskIds = null) {
  let tasks = await db.RecurringMaintenanceTask.filter({ is_active: true }, 'display_order', 200);
  if (onlyTaskIds) tasks = tasks.filter((t) => onlyTaskIds.includes(t.id));
  const nowIso = new Date().toISOString();
  let created = 0, existing = 0;
  for (const task of tasks) {
    const periods = plannedPeriods(task, today);
    if (!periods.length) continue;
    const keys = periods.map((p) => occurrenceKey(task.id, p.start));
    const have = await db.MaintenanceTaskOccurrence.filter({ occurrence_key: { $in: keys } }, 'created_date', 100);
    const haveKeys = new Set(have.map((o) => o.occurrence_key));
    existing += haveKeys.size;
    const missing = periods.filter((p) => !haveKeys.has(occurrenceKey(task.id, p.start)));
    if (missing.length) {
      await db.MaintenanceTaskOccurrence.bulkCreate(missing.map((p) => buildOccurrence(task, p, nowIso, by)));
      created += missing.length;
    }
  }
  return { created, existing, today };
}