// Initial preventive-maintenance definitions (activation). Created once per task_key; never overwritten.
export const PM_SEED_SOURCE = 'PM_INITIAL_V1';
const OMRI = '6a5603940bb18427ed7ef90c';
const team = { responsibility_type: 'OPERATIONS_TEAM' };
const omri = { responsibility_type: 'WORKER', responsible_worker_id: OMRI, responsible_name_snapshot: 'עומרי' };

export const INITIAL_TASKS = [
  { task_key: 'weekly_ac_filters_dining', title: 'ניקוי פילטרים מזגנים – חדר אוכל', recurrence_type: 'WEEKLY', category: 'מזגנים', area_label: 'חדר אוכל', display_order: 10, ...team },
  { task_key: 'weekly_ac_filters_ohel_moed', title: 'ניקוי פילטרים מזגנים – אוהל מועד', recurrence_type: 'WEEKLY', category: 'מזגנים', area_label: 'אוהל מועד', display_order: 20, ...team },
  { task_key: 'weekly_ice_machine_softener', title: 'ריכוך מים – מכונת קרח', recurrence_type: 'WEEKLY', category: 'מים', area_label: 'מכונת קרח', display_order: 30, ...omri },
  { task_key: 'weekly_vip_shower_drains', title: 'ניקוי ניקוזי מקלחות – אוהלי VIP (הוצאת שערות)', recurrence_type: 'WEEKLY', category: 'ניקוזים', area_label: 'אוהלי VIP', display_order: 40, ...team },
  { task_key: 'weekly_shared_shower_drains', title: 'ניקוי ניקוזי מקלחות – מקלחות משותפות', recurrence_type: 'WEEKLY', category: 'ניקוזים', area_label: 'מקלחות משותפות', display_order: 50, ...team },
  { task_key: 'monthly_generator_start', title: 'התנעת גנרטור', recurrence_type: 'MONTHLY', category: 'חשמל', area_label: 'גנרטור', display_order: 60, ...omri },
  { task_key: 'interval_tent_ac_filters', title: 'ניקוי פילטרים מזגנים – אוהלים', recurrence_type: 'EVERY_N_DAYS', category: 'מזגנים', area_label: 'שכונות 1–7', display_order: 70, interval_days: 30, warning_days: 21, ...team },
];
const NEIGHBORHOOD_CODES = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'];

// Must run under withPmLock. Fails (without writing) if any of the seven neighborhoods is missing.
export async function seedInitialTasks(db, today, actorEmail) {
  const hoods = await db.Neighborhood.filter({ code: { $in: NEIGHBORHOOD_CODES } }, 'sort_order', 20);
  const byCode = Object.fromEntries(hoods.map((n) => [n.code, n]));
  const missing = NEIGHBORHOOD_CODES.filter((c) => !byCode[c]);
  if (missing.length) return { status: 409, error: `שכונות חסרות במערכת: ${missing.join(', ')}` };
  const units = NEIGHBORHOOD_CODES.map((c) => ({ unit_key: c, label: byCode[c].name || `שכונה ${c.slice(1)}`, neighborhood_id: byCode[c].id }));

  const existing = await db.RecurringMaintenanceTask.filter({ task_key: { $in: INITIAL_TASKS.map((t) => t.task_key) } }, 'created_date', 50);
  const have = new Set(existing.map((t) => t.task_key));
  const toCreate = INITIAL_TASKS.filter((t) => !have.has(t.task_key)).map((t) => ({
    ...t, ...(t.recurrence_type === 'EVERY_N_DAYS' ? { units } : {}),
    is_active: true, version: 1, tracking_start_date: today, seed_source: PM_SEED_SOURCE,
    created_by_email: actorEmail, updated_by_email: actorEmail,
  }));
  if (toCreate.length) await db.RecurringMaintenanceTask.bulkCreate(toCreate);
  return { created_tasks: toCreate.map((t) => t.task_key), existing_tasks: [...have] };
}