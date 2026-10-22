import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { guardOperationalClient, GROUP_FIELD } from '../../shared/groupWriteGuard.js';

// Replaces the former direct client writes on operational records. Role rules mirror the UI permissions
// (src/lib/roles.js). Every write runs through the Group write fence.
const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const ALLOCATION = ['SUPER_ADMIN', 'ADMIN', 'HOUSEKEEPING_MANAGER'];
const MARK_TENT_READY = ['SUPER_ADMIN', 'ADMIN', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_STAFF'];
const ACKNOWLEDGE_ALERT = ['SUPER_ADMIN', 'ADMIN', 'KITCHEN', 'HOUSEKEEPING_MANAGER', 'HOUSEKEEPING_STAFF'];
const ENTITY_ROLES = {
  MealReservation: ADMINS, GroupScheduleItem: ADMINS, CoffeeCornerRequest: ADMINS, PrisaRequest: ADMINS,
  SleepingAllocation: ALLOCATION, NeighborhoodReservation: ALLOCATION,
};
const ACTIONS = new Set(['create', 'update', 'delete']);
const PROTECTED = new Set(['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'is_sample']);
const MAX_OPS = 100;
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rolesFor(op, keys) {
  const only = k => op.action === 'update' && keys.length > 0 && keys.every(x => x === k);
  if (op.entity === 'SleepingAllocation' && only('housekeeping_status')) return MARK_TENT_READY;
  if (op.entity === 'MealReservation' && only('pax')) return ACKNOWLEDGE_ALERT;
  return ENTITY_ROLES[op.entity];
}

async function runOp(db, role, op) {
  try {
    if (!op || !ENTITY_ROLES[op.entity] || !ACTIONS.has(op.action)) return { ok: false, error: 'INVALID_OPERATION' };
    const data = Object.fromEntries(Object.entries(op.data && typeof op.data === 'object' ? op.data : {}).filter(([k]) => !PROTECTED.has(k)));
    if (!rolesFor(op, Object.keys(data)).includes(role)) return { ok: false, error: 'אין הרשאה לפעולה זו' };
    const field = GROUP_FIELD[op.entity];
    if (op.action === 'create') {
      if (!data[field]) return { ok: false, error: 'GROUP_REQUIRED' };
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