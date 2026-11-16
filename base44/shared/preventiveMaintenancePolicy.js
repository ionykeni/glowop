// Pure authorization, state and validation rules for preventive maintenance (no I/O).
// Every decision uses the caller's server-resolved InternalUser role and WorkerProfile, never client input.

export const PM_TEAM_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'];
export const PM_MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
// Individually verified workers allowed into the module for THEIR OWN assigned tasks (not a role-wide grant).
export const PM_ASSIGNED_WORKERS = { '6a5603940bb18427ed7ef90c': 'עומרי' };
export const RECURRENCE_TYPES = ['WEEKLY', 'MONTHLY', 'EVERY_N_DAYS'];
export const CALENDAR_TYPES = ['WEEKLY', 'MONTHLY'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRequestId = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const deny = (status, error) => ({ status, error });

export function pmAccess(role, profile) {
  const isManager = PM_MANAGER_ROLES.includes(role);
  const isTeam = PM_TEAM_ROLES.includes(role);
  const assignedWorkerId = profile && profile.is_active !== false && PM_ASSIGNED_WORKERS[profile.id] ? profile.id : null;
  return { canView: isTeam || !!assignedWorkerId, isManager, isTeam, assignedWorkerId };
}

// Team tasks: OPERATIONS/ADMIN/SUPER_ADMIN. Worker tasks: that verified worker, or ADMIN/SUPER_ADMIN on their behalf.
export function canCompleteTask(access, task) {
  if (!access || !task || task.is_active === false) return false;
  if (task.responsibility_type === 'WORKER') {
    return access.isManager || (!!access.assignedWorkerId && access.assignedWorkerId === task.responsible_worker_id);
  }
  return access.isTeam;
}

export function occurrenceState(occ, today) {
  if (occ.status === 'COMPLETED') return 'COMPLETED';
  return today > occ.period_end ? 'OVERDUE' : 'PENDING';
}

export function intervalState(days, task) {
  if (days == null) return 'NO_RECORD';
  if (days >= (task.interval_days || 30)) return 'DUE';
  if (days >= (task.warning_days || 21)) return 'APPROACHING';
  return 'OK';
}

// Never-cleaned units first, then most days elapsed.
export const sortUnits = (units) => [...units].sort((a, b) => {
  const da = a.days_since == null ? Infinity : a.days_since;
  const db = b.days_since == null ? Infinity : b.days_since;
  return db - da || String(a.label).localeCompare(String(b.label), 'he', { numeric: true });
});

export const responsibleLabel = (src) => (src?.responsibility_type === 'WORKER'
  ? (src.responsible_name_snapshot || PM_ASSIGNED_WORKERS[src.responsible_worker_id] || 'עובד')
  : 'תפעול');

const text = (v, max) => { const t = String(v ?? '').trim(); return t.length > max ? null : t; };

function validateUnits(input, existingUnits = []) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) return deny(400, 'יש להגדיר בין 1 ל-30 יחידות מעקב');
  const prev = Object.fromEntries((existingUnits || []).map((u) => [u.unit_key, u]));
  const seen = new Set();
  const units = [];
  for (const u of input) {
    const key = String(u?.unit_key || '');
    const label = text(u?.label, 40);
    if (!/^[A-Za-z0-9_]{1,24}$/.test(key) || seen.has(key)) return deny(400, 'מזהה יחידה לא תקין או כפול');
    if (!label) return deny(400, 'יש להזין שם לכל יחידה');
    seen.add(key);
    units.push({ unit_key: key, label, neighborhood_id: prev[key]?.neighborhood_id || null });
  }
  return { units };
}

export function validateTaskInput(input, existing) {
  const title = text(input?.title, 120);
  if (!title) return deny(400, 'יש להזין שם משימה (עד 120 תווים)');
  const area = text(input?.area_label, 120);
  const category = text(input?.category, 60);
  if (area === null || category === null) return deny(400, 'אחד השדות ארוך מדי');
  if (existing && input?.recurrence_type && input.recurrence_type !== existing.recurrence_type) {
    return deny(409, 'לא ניתן לשנות את סוג החזרתיות של משימה קיימת');
  }
  const type = existing ? existing.recurrence_type : String(input?.recurrence_type || '');
  if (!RECURRENCE_TYPES.includes(type)) return deny(400, 'סוג חזרתיות לא תקין');
  const responsibility = input?.responsibility_type === 'WORKER' ? 'WORKER' : 'OPERATIONS_TEAM';
  let workerId = null;
  if (responsibility === 'WORKER') {
    workerId = String(input?.responsible_worker_id || '');
    if (!PM_ASSIGNED_WORKERS[workerId]) return deny(400, 'ניתן לשייך רק לעובד שאושר למודול');
  }
  const order = Number(input?.display_order);
  const data = {
    title, area_label: area, category, recurrence_type: type,
    responsibility_type: responsibility, responsible_worker_id: workerId,
    responsible_name_snapshot: workerId ? PM_ASSIGNED_WORKERS[workerId] : null,
    display_order: Number.isFinite(order) ? order : (existing?.display_order ?? 100),
  };
  if (type === 'EVERY_N_DAYS') {
    const interval = Number(input?.interval_days);
    const warning = Number(input?.warning_days);
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) return deny(400, 'מספר ימים לא תקין (1-365)');
    if (!Number.isInteger(warning) || warning < 1 || warning >= interval) return deny(400, 'ימי ההתרעה חייבים להיות קטנים ממרווח הימים');
    const units = validateUnits(input?.units, existing?.units);
    if (units.error) return units;
    Object.assign(data, { interval_days: interval, warning_days: warning, units: units.units });
  }
  return { data };
}