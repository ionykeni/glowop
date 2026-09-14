export const sleepingToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
export const liveSleeping = r => ['DRAFT', 'CONFIRMED'].includes(r.status);
export const overlapSleeping = (a, b) => a.arrival_date < b.departure_date && b.arrival_date < a.departure_date;
export async function readSleepingRows(entity, query = {}) {
  const out = []; for (let skip = 0;;) { const rows = await entity.filter(query, 'id', 500, skip); out.push(...rows); if (rows.length < 500) return out; skip += rows.length; }
}
export async function assertSleepingAccess(base44, user) {
  if (!user) throw new Error('נדרשת התחברות');
  const email = String(user.email || '').trim().toLowerCase();
  const users = await readSleepingRows(base44.asServiceRole.entities.InternalUser, { active: true });
  if (!users.some(r => String(r.email || '').trim().toLowerCase() === email && ['ADMIN','SUPER_ADMIN','HOUSEKEEPING_MANAGER'].includes(r.role))) throw new Error('אין הרשאה לשינוי שיבוצי לינה');
}
// Compensating writes, not a database transaction. Never claim success after incomplete rollback.
export function sleepingWrites(db) {
  const undo = [];
  return {
    async update(entity, row, data) { undo.push({ entity, id: row.id, data: Object.fromEntries(Object.keys(data).map(k => [k, row[k] ?? null])) }); return await db[entity].update(row.id, data); },
    async create(entity, data) { const row = await db[entity].create(data); undo.push({ entity, id: row.id, remove: true }); return row; },
    async rollback() { const failed = []; for (const op of undo.reverse()) { try { if (op.remove) await db[op.entity].delete(op.id); else await db[op.entity].update(op.id, op.data); } catch { failed.push({ entity: op.entity, id: op.id }); } } return { restored: failed.length === 0, failed }; }
  };
}