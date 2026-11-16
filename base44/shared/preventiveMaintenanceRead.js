// Read-only views for preventive maintenance. Never writes: opening the page creates nothing.
import { israelDate, weekPeriod, monthPeriod, periodOf, daysBetween, isValidDate } from './preventiveMaintenanceDates.js';
import { CALENDAR_TYPES, canCompleteTask, occurrenceState, intervalState, sortUnits, responsibleLabel, isId } from './preventiveMaintenancePolicy.js';
import { occurrenceKey } from './preventiveMaintenanceGenerate.js';

const RANK = { OVERDUE: 0, PENDING: 1, COMPLETED: 2 };

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

function presentOccurrence(o, task, caller, today) {
  return {
    id: o.id, task_id: o.task_id, title: o.title_snapshot, area: o.area_snapshot, recurrence_type: o.recurrence_type,
    responsible_label: responsibleLabel(o), period_start: o.period_start, period_end: o.period_end,
    state: occurrenceState(o, today), completed_at: o.completed_at || null, completed_by_name: o.completed_by_name || null,
    completed_late: !!o.completed_late, completion_event_id: o.completion_event_id || null,
    display_order: task?.display_order ?? 100,
    can_complete: o.status !== 'COMPLETED' && canCompleteTask(caller.access, task),
    can_void: caller.access.isManager && o.status === 'COMPLETED' && !!o.completion_event_id,
  };
}

const sortRows = (rows) => rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.display_order - b.display_order || a.period_start.localeCompare(b.period_start));

async function buildIntervals(db, tasks, caller, today) {
  const out = [];
  for (const t of tasks.filter((x) => x.recurrence_type === 'EVERY_N_DAYS')) {
    const units = t.units || [];
    const latest = await inBatches(units, 6, (u) => db.MaintenanceCompletionEvent.filter({ task_id: t.id, unit_key: u.unit_key, status: 'VALID' }, '-completed_at', 1));
    const canDo = canCompleteTask(caller.access, t);
    out.push({
      task_id: t.id, title: t.title, area: t.area_label, responsible_label: responsibleLabel(t),
      interval_days: t.interval_days || 30, warning_days: t.warning_days || 21, can_complete: canDo,
      units: sortUnits(units.map((u, i) => {
        const ev = latest[i][0];
        const days = ev ? Math.max(0, daysBetween(ev.completed_local_date || israelDate(ev.completed_at), today)) : null;
        return {
          unit_key: u.unit_key, label: u.label, days_since: days, state: intervalState(days, t),
          last_completed_at: ev?.completed_at || null, last_completed_by: ev?.completed_by_name || null,
          last_event_id: ev?.id || null, can_void: caller.access.isManager && !!ev,
        };
      })),
    });
  }
  return out;
}

export async function buildOverview(db, caller, now = new Date()) {
  const today = israelDate(now);
  const week = weekPeriod(today), month = monthPeriod(today);
  const tasks = await db.RecurringMaintenanceTask.filter({ is_active: true }, 'display_order', 200);
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const calIds = tasks.filter((t) => CALENDAR_TYPES.includes(t.recurrence_type)).map((t) => t.id);
  const [pending, current] = calIds.length ? await Promise.all([
    db.MaintenanceTaskOccurrence.filter({ task_id: { $in: calIds }, status: 'PENDING' }, 'period_start', 500),
    db.MaintenanceTaskOccurrence.filter({ task_id: { $in: calIds }, period_start: { $in: [week.start, month.start] } }, 'period_start', 200),
  ]) : [[], []];
  const occs = [...new Map([...pending, ...current].map((o) => [o.id, o])).values()].filter((o) => o.period_start <= today);
  const rows = occs.map((o) => presentOccurrence(o, byId[o.task_id], caller, today));
  const keys = new Set(occs.map((o) => o.occurrence_key));
  const missing = tasks.filter((t) => CALENDAR_TYPES.includes(t.recurrence_type) && (t.tracking_start_date || today) <= today
    && !keys.has(occurrenceKey(t.id, periodOf(t.recurrence_type, today).start))).map((t) => t.title);
  return {
    today, week, month,
    caller: { name: caller.actorName, role: caller.role, is_manager: caller.access.isManager, is_team: caller.access.isTeam, is_assigned_worker: !!caller.access.assignedWorkerId },
    weekly: sortRows(rows.filter((r) => r.recurrence_type === 'WEEKLY')),
    monthly: sortRows(rows.filter((r) => r.recurrence_type === 'MONTHLY')),
    intervals: await buildIntervals(db, tasks, caller, today),
    missing_current: caller.access.isManager ? missing : [],
  };
}

const presentEvent = (e, caller) => ({
  id: e.id, task_id: e.task_id, title: e.task_title_snapshot, unit_label: e.unit_label || null, recurrence_type: e.recurrence_type,
  period_start: e.period_start || null, period_end: e.period_end || null, completed_at: e.completed_at,
  completed_by_name: e.completed_by_name, completed_late: !!e.completed_late, on_behalf: !!e.on_behalf_of_worker_id,
  status: e.status, voided_at: e.voided_at || null, voided_by_name: e.voided_by_name || null, void_reason: e.void_reason || null,
  can_void: caller.access.isManager && e.status === 'VALID',
});

export async function buildHistory(db, caller, f = {}) {
  const q = {};
  if (isId(f.task_id)) q.task_id = f.task_id;
  if (typeof f.unit_key === 'string' && /^[A-Za-z0-9_]{1,24}$/.test(f.unit_key)) q.unit_key = f.unit_key;
  if (isId(f.worker_user_id)) q.completed_by_internal_user_id = f.worker_user_id;
  if (f.status === 'VALID' || f.status === 'VOIDED') q.status = f.status;
  const range = {};
  if (isValidDate(f.from)) range.$gte = f.from;
  if (isValidDate(f.to)) range.$lte = f.to;
  if (Object.keys(range).length) q.completed_local_date = range;
  const [events, recent, tasks] = await Promise.all([
    db.MaintenanceCompletionEvent.filter(q, '-completed_at', 300),
    db.MaintenanceCompletionEvent.filter({}, '-completed_at', 1000),
    db.RecurringMaintenanceTask.filter({}, 'display_order', 200),
  ]);
  const workers = [...new Map(recent.map((e) => [e.completed_by_internal_user_id, e.completed_by_name])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
  return {
    events: events.map((e) => presentEvent(e, caller)), limited: events.length >= 300,
    options: {
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, recurrence_type: t.recurrence_type, units: (t.units || []).map((u) => ({ unit_key: u.unit_key, label: u.label })) })),
      workers,
    },
  };
}