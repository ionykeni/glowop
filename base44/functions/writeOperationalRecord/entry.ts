import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { guardOperationalClient, GROUP_FIELD } from '../../shared/groupWriteGuard.js';
import { ENTITY_ROLES, ACTIONS, KITCHEN_PAX_ALERT, rolesFor } from '../../shared/operationalWritePolicy.js';

// Replaces the former direct client writes on operational records. Every write runs through the Group write
// fence (rejects missing, cancelled and cancellation-locked Groups).
const PROTECTED = new Set(['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'is_sample']);
const MAX_OPS = 100;
const DENIED = { ok: false, error: 'אין הרשאה לפעולה זו' };
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Kitchen pax alert: the pax comes from the Group's current total_pax (not from the caller), and only for an
// OPEN KITCHEN/GROUP_PAX_CHANGED alert whose recorded new pax still matches the Group.
async function applyKitchenPaxAlert(db, role, op) {
  if (!KITCHEN_PAX_ALERT.includes(role)) return DENIED;
  const alert = typeof op.alert_id === 'string' && op.alert_id ? (await db.OperationalReviewAlert.filter({ id: op.alert_id }))[0] : null;
  if (!alert || alert.module !== 'KITCHEN' || alert.source !== 'GROUP_PAX_CHANGED' || alert.status !== 'OPEN') return { ok: false, error: 'ALERT_NOT_APPLICABLE' };
  const group = alert.group_id ? (await db.Group.filter({ id: alert.group_id }))[0] : null;
  if (!group) return { ok: false, error: 'GROUP_NOT_FOUND' };
  let next = {};
  try { next = JSON.parse(alert.new_value_json || '{}') || {}; } catch { next = {}; }
  const pax = Number(group.total_pax);
  if (!(pax > 0) || Number(next.total_pax ?? next.pax) !== pax) return { ok: false, error: 'נתוני ההתראה אינם תואמים את מספר האנשים הנוכחי בקבוצה. יש לרענן.' };
  const meals = await db.MealReservation.filter({ group_id: group.id, status: 'ACTIVE' });
  for (const meal of meals) if (meal.pax !== pax) await db.MealReservation.update(meal.id, { pax });
  return { ok: true, record: { meals: meals.length, pax } };
}

async function runOp(db, role, op) {
  try {
    if (op?.action === 'applyKitchenPaxAlert') return await applyKitchenPaxAlert(db, role, op);
    if (!op || !ENTITY_ROLES[op.entity] || !ACTIONS.has(op.action)) return { ok: false, error: 'INVALID_OPERATION' };
    const data = Object.fromEntries(Object.entries(op.data && typeof op.data === 'object' ? op.data : {}).filter(([k]) => !PROTECTED.has(k)));
    if (!rolesFor(op, data).includes(role)) return DENIED;
    const field = GROUP_FIELD[op.entity];
    if (op.action === 'create') {
      if (typeof data[field] !== 'string' || !data[field]) return { ok: false, error: 'GROUP_REQUIRED' };
      return { ok: true, record: await db[op.entity].create(data) };
    }
    if (typeof op.id !== 'string' || !op.id) return { ok: false, error: 'ID_REQUIRED' };
    const row = (await db[op.entity].filter({ id: op.id }))[0];
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    if (op.action === 'delete') { await db[op.entity].delete(op.id); return { ok: true, record: null }; }
    if (field in data && data[field] !== row[field]) return { ok: false, error: 'GROUP_CHANGE_NOT_ALLOWED' };
    return { ok: true, record: await db[op.entity].update(op.id, data) };
  } catch (error) {
    return { ok: false, error: error?.message || 'WRITE_FAILED', code: error?.code || null };
  }
}

export default async function(req) {
  try {
    const base44 = guardOperationalClient(createClientFromRequest(req));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ success: false, error: 'נדרשת התחברות' }, { status: 401 });
    const email = String(user.email || '').trim().toLowerCase();
    const candidates = await base44.asServiceRole.entities.InternalUser.filter({ email: { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
    const internal = candidates.find(r => String(r.email || '').trim().toLowerCase() === email);
    if (!internal || internal.active === false) return Response.json({ success: false, error: 'אין הרשאה לפעולה זו' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const ops = Array.isArray(body.ops) ? body.ops : [];
    if (!ops.length || ops.length > MAX_OPS) return Response.json({ success: false, error: 'INVALID_REQUEST' }, { status: 400 });

    const db = base44.asServiceRole.entities;
    const results = [];
    for (let i = 0; i < ops.length; i += 5) results.push(...await Promise.all(ops.slice(i, i + 5).map(op => runOp(db, internal.role, op))));
    return Response.json({ success: results.every(r => r.ok), results });
  } catch (error) {
    return Response.json({ success: false, error: error?.message || 'WRITE_FAILED' }, { status: 500 });
  }
}