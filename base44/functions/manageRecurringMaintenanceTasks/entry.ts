import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolvePmCaller, pmJson, pmResult, pmError } from '../../shared/preventiveMaintenanceAuth.js';
import { withPmLock } from '../../shared/preventiveMaintenanceLock.js';
import { validateTaskInput, isId, PM_ASSIGNED_WORKERS } from '../../shared/preventiveMaintenancePolicy.js';
import { israelDate } from '../../shared/preventiveMaintenanceDates.js';
import { generateOccurrences } from '../../shared/preventiveMaintenanceGenerate.js';
import { seedInitialTasks } from '../../shared/preventiveMaintenanceSeed.js';

// ADMIN / SUPER_ADMIN only: list, create, edit, activate/deactivate recurring definitions; one-time initial seed.
// Edits bump the version; already generated occurrences keep their snapshots (history is never rewritten).
const getOrNull = (db, id) => db.RecurringMaintenanceTask.get(id).catch((e) => (e?.status === 404 ? null : Promise.reject(e)));

async function saveTask(db, caller, body) {
  const today = israelDate();
  if (body.id) {
    const existing = await getOrNull(db, body.id);
    if (!existing) return { status: 404, error: 'המשימה לא נמצאה' };
    const v = validateTaskInput(body.task, existing);
    if (v.error) return v;
    await db.RecurringMaintenanceTask.update(existing.id, { ...v.data, version: (existing.version || 1) + 1, updated_by_email: caller.email });
    return { id: existing.id };
  }
  const v = validateTaskInput(body.task, null);
  if (v.error) return v;
  const created = await db.RecurringMaintenanceTask.create({
    ...v.data, task_key: `custom_${crypto.randomUUID().slice(0, 8)}`, is_active: true, version: 1,
    tracking_start_date: today, created_by_email: caller.email, updated_by_email: caller.email,
  });
  const gen = await generateOccurrences(db, today, 'ADMIN_SAVE', [created.id]);
  return { id: created.id, generated: gen.created };
}

async function setActive(db, caller, id, active) {
  const task = await getOrNull(db, id);
  if (!task) return { status: 404, error: 'המשימה לא נמצאה' };
  if ((task.is_active !== false) === active) return { id };
  const today = israelDate();
  if (active) {
    // Reactivation tracks from today: no obligations are generated for the inactive gap.
    await db.RecurringMaintenanceTask.update(id, { is_active: true, tracking_start_date: today, deactivated_at: null, deactivated_by_email: null, updated_by_email: caller.email });
    const gen = await generateOccurrences(db, today, 'ADMIN_SAVE', [id]);
    return { id, generated: gen.created };
  }
  await db.RecurringMaintenanceTask.update(id, { is_active: false, deactivated_at: new Date().toISOString(), deactivated_by_email: caller.email, updated_by_email: caller.email });
  return { id };
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolvePmCaller(base44, req);
    if (caller.error) return caller.error;
    if (!caller.access.isManager) return pmJson({ error: 'אין הרשאה לניהול משימות' }, 403);
    const body = await req.json().catch(() => ({}));
    const db = base44.asServiceRole.entities;

    if (body.action === 'list') {
      const tasks = await db.RecurringMaintenanceTask.filter({}, 'display_order', 200);
      return pmJson({ tasks, assignable_workers: Object.entries(PM_ASSIGNED_WORKERS).map(([id, name]) => ({ id, name })) });
    }
    if (body.action === 'save') {
      if (body.id && !isId(body.id)) return pmJson({ error: 'מזהה לא תקין' }, 400);
      return pmResult(await withPmLock(db, () => saveTask(db, caller, body)));
    }
    if (body.action === 'set_active') {
      if (!isId(body.id) || typeof body.active !== 'boolean') return pmJson({ error: 'בקשה לא תקינה' }, 400);
      return pmResult(await withPmLock(db, () => setActive(db, caller, body.id, body.active)));
    }
    if (body.action === 'seed_initial') {
      return pmResult(await withPmLock(db, async () => {
        const today = israelDate();
        const seed = await seedInitialTasks(db, today, caller.email);
        if (seed.error) return seed;
        const gen = await generateOccurrences(db, today, 'ACTIVATION');
        return { ...seed, generated: gen.created };
      }));
    }
    return pmJson({ error: 'פעולה לא מוכרת' }, 400);
  } catch (error) {
    return pmError('manageRecurringMaintenanceTasks', error, 'שגיאה פנימית');
  }
}