// Pure workforce authorization + validation rules (no SDK, no I/O).
// Shared by the workforce backend functions and by tests/workforcePolicy.test.js.
// Every decision here is based on the caller's server-resolved InternalUser row — never on client-supplied role/email/ids.

export const INTERNAL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'QUOTES_MANAGER', 'OPERATIONS', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_STAFF', 'KITCHEN', 'MAINTENANCE', 'VIEWER', 'MECHINA_USER'];
export const USER_MANAGER_ROLES = ['SUPER_ADMIN'];
export const SCHEDULE_MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN'];
// Mirrors the existing UI gate around the Mechina users section in the group page.
export const MECHINA_USER_MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'];
export const WORKER_TEAMS = ['OPERATIONS', 'HOUSEKEEPING', 'MAINTENANCE', 'KITCHEN', 'OTHER'];

export const NIGHT_ON_CALL_SOURCE = 'OPERATIONS_EVENING_TO_NIGHT_ON_CALL';

// Server copy of the fixed schedule rows (label/order are derived here, never taken from the client).
export const SHIFT_ROWS = {
  PLANNED_ACTIVITY: { label: 'פעילות מתוכננת', order: 0, textOnly: true },
  OPERATIONS_MORNING: { label: 'תפעול בוקר', order: 1 },
  HOUSEKEEPING_MORNING: { label: 'ניקיון בוקר', order: 2, countBased: true },
  HOUSEKEEPING_MANAGER: { label: 'אחראי משק בית', order: 3 },
  MAINTENANCE: { label: 'תחזוקה', order: 4 },
  OPERATIONS_EVENING: { label: 'תפעול ערב', order: 5 },
  HOUSEKEEPING_EVENING: { label: 'ניקיון ערב', order: 6, countBased: true },
  NIGHT_ON_CALL: { label: 'כונן לילה', order: 7 },
  SPECIAL_TASKS: { label: 'משימות מיוחדות', order: 8 },
};

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (value) => { const e = normalizeEmail(value); return e.length <= 254 && EMAIL_RE.test(e); };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const deny = (status, error) => ({ error, status });
// Trimmed text, or null when longer than max (rejected instead of silently cut).
export function boundedText(value, max) {
  const text = String(value ?? '').trim();
  return text.length > max ? null : text;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function isSunday(date) {
  if (!DATE_RE.test(String(date || ''))) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date && d.getUTCDay() === 0;
}
export const weekDatesOf = (weekStart) => new Set(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));

// Caller identity: active InternalUser rows with the same normalized email. Conflicting roles fail closed.
export function pickActiveInternalUser(rows, email) {
  const target = normalizeEmail(email);
  if (!target) return { user: null };
  const matches = (rows || []).filter((r) => r.active !== false && normalizeEmail(r.email) === target);
  if (!matches.length) return { user: null };
  if (new Set(matches.map((r) => r.role)).size > 1) return { user: null, conflict: true };
  return { user: matches[0] };
}

const activeSuperAdminEmails = (users) => new Set(users.filter((u) => u.active !== false && u.role === 'SUPER_ADMIN').map((u) => normalizeEmail(u.email)));

export function planInternalUserSave({ caller, users, userId, input }) {
  if (!USER_MANAGER_ROLES.includes(caller?.role)) return deny(403, 'Forbidden');
  const role = String(input?.role || '');
  if (!INTERNAL_ROLES.includes(role)) return deny(400, 'תפקיד לא תקין');
  const name = boundedText(input?.name, 120);
  const phone = boundedText(input?.phone, 40);
  const notes = boundedText(input?.notes, 1000);
  if (name === null || phone === null || notes === null) return deny(400, 'אחד השדות ארוך מדי');
  const callerEmail = normalizeEmail(caller.email);

  if (userId) {
    const target = users.find((u) => u.id === userId);
    if (!target) return deny(404, 'המשתמש לא נמצא');
    const targetEmail = normalizeEmail(target.email);
    if (targetEmail === callerEmail && role !== target.role) return deny(403, 'לא ניתן לשנות את התפקיד של עצמך');
    if (role !== target.role) {
      const conflict = users.some((u) => u.id !== target.id && u.active !== false && normalizeEmail(u.email) === targetEmail && u.role !== role);
      if (conflict && target.active !== false) return deny(409, 'קיימת רשומה פעילה נוספת לאימייל זה עם תפקיד אחר');
    }
    const supers = activeSuperAdminEmails(users);
    if (target.active !== false && target.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN' && supers.size <= 1 && supers.has(targetEmail)) {
      return deny(409, 'לא ניתן להסיר את הסופר מנהל הפעיל האחרון');
    }
    // Email is immutable on edit (identity key).
    return { action: 'update', id: target.id, before: { role: target.role }, data: { name, role, phone, notes } };
  }

  const email = normalizeEmail(input?.email);
  if (!isValidEmail(email)) return deny(400, 'אימייל לא תקין');
  if (users.some((u) => normalizeEmail(u.email) === email)) return deny(409, 'משתמש עם אימייל זה כבר קיים');
  return { action: 'create', data: { email, name, role, phone, notes, active: true } };
}

export function planInternalUserActive({ caller, users, userId, active }) {
  if (!USER_MANAGER_ROLES.includes(caller?.role)) return deny(403, 'Forbidden');
  if (typeof active !== 'boolean') return deny(400, 'ערך לא תקין');
  const target = users.find((u) => u.id === userId);
  if (!target) return deny(404, 'המשתמש לא נמצא');
  const targetEmail = normalizeEmail(target.email);
  if (targetEmail === normalizeEmail(caller.email)) return deny(403, 'לא ניתן לשנות את הסטטוס של עצמך');
  if (!active) {
    const supers = activeSuperAdminEmails(users);
    if (target.role === 'SUPER_ADMIN' && supers.size <= 1 && supers.has(targetEmail)) return deny(409, 'לא ניתן להשבית את הסופר מנהל הפעיל האחרון');
  } else if (users.some((u) => u.id !== target.id && u.active !== false && normalizeEmail(u.email) === targetEmail && u.role !== target.role)) {
    return deny(409, 'קיימת רשומה פעילה נוספת לאימייל זה עם תפקיד אחר');
  }
  return { action: 'update', id: target.id, data: { active } };
}

// Mechina flow may only create/reactivate MECHINA_USER rows. It never changes any other role.
export function planMechinaUser({ caller, users, email: rawEmail, name: rawName }) {
  if (!MECHINA_USER_MANAGER_ROLES.includes(caller?.role)) return deny(403, 'Forbidden');
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return deny(400, 'אימייל לא תקין');
  if (email === normalizeEmail(caller.email)) return deny(403, 'לא ניתן לשייך את המשתמש שלך למכינה');
  const name = boundedText(rawName, 120);
  if (name === null) return deny(400, 'השם ארוך מדי');
  const rows = users.filter((u) => normalizeEmail(u.email) === email);
  if (rows.some((r) => r.role !== 'MECHINA_USER')) return deny(409, 'לאימייל זה קיים משתמש מערכת עם תפקיד אחר. שינוי תפקיד מתבצע רק בניהול משתמשים.');
  const existing = rows.find((r) => r.active !== false) || rows[0] || null;
  if (existing) return { action: 'update', id: existing.id, data: { name: name || existing.name || '', role: 'MECHINA_USER', active: true } };
  return { action: 'create', data: { email, name, role: 'MECHINA_USER', active: true } };
}

export const isWorkerLinkedTo = (worker, internalUser) => !!worker && !!internalUser && (
  (!!worker.internal_user_id && worker.internal_user_id === internalUser.id) ||
  (!!normalizeEmail(worker.internal_user_email) && normalizeEmail(worker.internal_user_email) === normalizeEmail(internalUser.email))
);

// A manager may never create, change or remove the link between a WorkerProfile and their own system user.
export function checkWorkerIdentityChange({ caller, existingWorker, linkedUser }) {
  const newLinkId = linkedUser?.id || '';
  const linkChanged = !existingWorker || (existingWorker.internal_user_id || '') !== newLinkId;
  if (!linkChanged) return null;
  if (isWorkerLinkedTo(existingWorker, caller)) return deny(403, 'לא ניתן לשנות את קישור פרופיל העובד של עצמך');
  if (linkedUser && normalizeEmail(linkedUser.email) === normalizeEmail(caller.email)) return deny(403, 'לא ניתן לקשר את המשתמש שלך לפרופיל עובד. יש לבקש ממנהל אחר.');
  return null;
}

// Validates a shift payload against its schedule week. Worker identity (id/name) is resolved by the caller from WorkerProfile.
export function validateShiftInput(input, weekStart) {
  const rowType = String(input?.row_type || '');
  const row = SHIFT_ROWS[rowType];
  if (!row) return deny(400, 'סוג משמרת לא תקין');
  const date = String(input?.date || '');
  if (!weekDatesOf(weekStart).has(date)) return deny(400, 'התאריך אינו בשבוע של הסידור');
  const notes = boundedText(input?.notes, 1000);
  if (notes === null) return deny(400, 'ההערות ארוכות מדי');
  const status = input?.status === 'CANCELLED' ? 'CANCELLED' : 'PLANNED';
  const base = { date, row_type: rowType, row_label: row.label, row_order: row.order, notes, status };
  if (row.textOnly) {
    if (!notes) return deny(400, 'יש להזין טקסט לפעילות המתוכננת');
    return { payload: { ...base, start_time: '', end_time: '' }, needsWorker: false };
  }
  const start = String(input?.start_time || '');
  const end = String(input?.end_time || '');
  if (row.countBased) {
    const count = Number(input?.worker_count);
    if (!Number.isInteger(count) || count < 1 || count > 50) return deny(400, 'כמות מנקות אינה תקינה');
    if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) return deny(400, 'שעה לא תקינה');
    return { payload: { ...base, start_time: start, end_time: end, worker_count: count }, needsWorker: false };
  }
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return deny(400, 'יש להזין שעות התחלה וסיום תקינות');
  if (!String(input?.worker_id || '')) return deny(400, 'יש לבחור עובד');
  return { payload: { ...base, start_time: start, end_time: end }, needsWorker: true };
}